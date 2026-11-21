"""Download the raw OpenUSD sources for PickSim from Hugging Face into a local cache.

Run with Blender's bundled Python (it ships the `pxr` USD module, needed to resolve
external references of the Warehouse-01 assets):

  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\5.2\\python\\bin\\python.exe" -I fetch_assets.py
      [--cache DIR] [--only id1,id2] [--jobs 8]

Cache directory: --cache, else env PICKSIM_ASSET_CACHE, else %TEMP%\\picksim-asset-cache.
Layout: <cache>/<repo with / replaced by __>/<path in repo>
"""
import argparse, json, os, re, sys, time, threading, urllib.parse, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
UA = {"User-Agent": "picksim-asset-fetch/1.0"}
BLENDER_DIR = os.environ.get("BLENDER_DIR", r"C:\Program Files\Blender Foundation\Blender 5.2")


def default_cache():
    return os.environ.get("PICKSIM_ASSET_CACHE") or os.path.join(os.environ.get("TEMP", "."), "picksim-asset-cache")


def load_pxr():
    """Import pxr; when running inside Blender's python.exe the DLLs live in blender.shared."""
    try:
        from pxr import Sdf, UsdUtils  # noqa
        return Sdf, UsdUtils
    except ImportError:
        pass
    shared = os.path.join(BLENDER_DIR, "blender.shared")
    if os.path.isdir(shared):
        os.add_dll_directory(shared)
    for cand in os.listdir(BLENDER_DIR) if os.path.isdir(BLENDER_DIR) else []:
        sp = os.path.join(BLENDER_DIR, cand, "python", "lib", "site-packages")
        if os.path.isdir(sp) and sp not in sys.path:
            sys.path.append(sp)
    from pxr import Sdf, UsdUtils  # noqa
    return Sdf, UsdUtils


def http_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8")), r.headers.get("Link")


def hf_tree(repo, path):
    url = f"https://huggingface.co/api/datasets/{repo}/tree/main/{urllib.parse.quote(path)}?recursive=true"
    out = []
    while url:
        data, link = http_json(url)
        out.extend(data)
        url = None
        if link:
            m = re.search(r'<([^>]+)>;\s*rel="next"', link)
            if m:
                url = m.group(1)
    return [e for e in out if e.get("type") == "file"]


class Fetcher:
    def __init__(self, cache, jobs):
        self.cache = cache
        self.pool = ThreadPoolExecutor(max_workers=jobs)
        self.lock = threading.Lock()
        self.bytes = 0
        self.missing = set()

    def local(self, repo, path):
        return os.path.join(self.cache, repo.replace("/", "__"), *path.split("/"))

    def download(self, repo, path, size=None):
        dest = self.local(repo, path)
        if os.path.exists(dest) and (size is None or os.path.getsize(dest) == size):
            return dest
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        url = f"https://huggingface.co/datasets/{repo}/resolve/main/{urllib.parse.quote(path)}"
        for attempt in range(4):
            try:
                req = urllib.request.Request(url, headers=UA)
                with urllib.request.urlopen(req, timeout=600) as r, open(dest + ".part", "wb") as f:
                    while True:
                        chunk = r.read(1 << 20)
                        if not chunk:
                            break
                        f.write(chunk)
                os.replace(dest + ".part", dest)
                with self.lock:
                    self.bytes += os.path.getsize(dest)
                return dest
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    with self.lock:
                        self.missing.add(f"{repo}:{path}")
                    return None
                time.sleep(2 + attempt * 3)
            except Exception:
                time.sleep(2 + attempt * 3)
        raise RuntimeError(f"download failed: {url}")

    def download_many(self, repo, entries):
        futs = [self.pool.submit(self.download, repo, e["path"], e.get("size")) for e in entries]
        return [f.result() for f in futs]

    def fetch_folder(self, repo, folder, skip=("/.thumbs/", "/source_assets/")):
        files = [e for e in hf_tree(repo, folder) if not any(s in "/" + e["path"] for s in skip)]
        self.download_many(repo, files)
        return files

    # --- dependency resolution for layers that reference files elsewhere in the repo -----------
    def resolve_deps(self, repo, root_rel):
        Sdf, UsdUtils = load_pxr()
        repo_dir = os.path.abspath(os.path.join(self.cache, repo.replace("/", "__")))
        todo, seen, folders = [root_rel], set(), set()
        while todo:
            rel = todo.pop()
            if rel in seen:
                continue
            seen.add(rel)
            # a file inside another asset folder (Props/<category>/<name>/...): take the whole folder, so that
            # UDIM tiles and textures referenced only from MDL files come along
            parts = rel.split("/")
            if len(parts) > 3 and parts[0] == "Props" and "/".join(parts[:3]) not in folders:
                folders.add("/".join(parts[:3]))
                try:
                    self.fetch_folder(repo, "/".join(parts[:3]))
                except Exception as e:
                    print("  ! folder", "/".join(parts[:3]), e)
            local = self.local(repo, rel)
            if not os.path.exists(local):
                if self.download(repo, rel) is None:
                    continue
            base = os.path.dirname(rel)
            refs = []
            if rel.lower().endswith((".usd", ".usda", ".usdc")):
                try:
                    sub, ref, pay = UsdUtils.ExtractExternalReferences(local)
                    refs = list(sub) + list(ref) + list(pay)
                except Exception as e:
                    print("  ! cannot parse", rel, e)
            elif rel.lower().endswith(".mdl"):
                txt = open(local, encoding="utf-8", errors="ignore").read()
                refs = re.findall(r'"([^"]+\.(?:png|jpg|jpeg|exr|hdr|tga|tif|tiff))"', txt, re.I)
            for p in refs:
                p = p.replace("\\", "/")
                if not p or "://" in p or p.startswith("/") or re.match(r"^[A-Za-z]:", p):
                    continue
                if "<UDIM>" in p:
                    continue
                if not p.startswith((".", "/")) and rel.lower().endswith((".usd", ".usda", ".usdc")) \
                        and p.lower().endswith(".mdl") and "/" not in p:
                    # search-path MDL such as OmniPBR.mdl -> core library, not part of the repo
                    p = "./" + p
                joined = os.path.normpath(os.path.join(repo_dir, base, p))
                if not joined.startswith(repo_dir):
                    continue
                nrel = os.path.relpath(joined, repo_dir).replace("\\", "/")
                if nrel not in seen:
                    todo.append(nrel)
        return seen


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=default_cache())
    ap.add_argument("--only", default="")
    ap.add_argument("--jobs", type=int, default=8)
    ap.add_argument("--list", default=os.path.join(HERE, "assets.json"))
    a = ap.parse_args()
    cfg = json.load(open(a.list, encoding="utf-8"))
    only = set(x for x in a.only.split(",") if x)
    fx = Fetcher(a.cache, a.jobs)
    report = {}
    for asset in cfg["assets"]:
        if only and asset["id"] not in only:
            continue
        repo = cfg["repos"][asset["src"]]
        t0 = time.time()
        b0 = fx.bytes
        try:
            fx.fetch_folder(repo, asset["path"])
            if asset["src"] == "WH":
                name = asset["path"].rstrip("/").split("/")[-1]
                deps = fx.resolve_deps(repo, f"{asset['path']}/{name}.usd")
                report[asset["id"]] = sorted(deps)
            print(f"{asset['id']:22s} ok  {(fx.bytes - b0) / 1e6:7.1f} MB  {time.time() - t0:5.1f}s", flush=True)
        except Exception as e:
            print(f"{asset['id']:22s} FAILED {e}", flush=True)
    if fx.missing:
        print("not found on HF (usually core MDL libraries, harmless):")
        for m in sorted(fx.missing):
            print("   ", m)
    dep_file = os.path.join(a.cache, "wh_dependencies.json")
    old = json.load(open(dep_file, encoding="utf-8")) if os.path.exists(dep_file) else {}
    old.update(report)
    with open(dep_file, "w", encoding="utf-8") as f:
        json.dump(old, f, indent=1)
    print(f"total downloaded: {fx.bytes / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
