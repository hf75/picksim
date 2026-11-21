"""PickSim asset pipeline, step 2: OpenUSD -> raw GLB (Blender 5.2, background mode).

  blender -b --factory-startup --python convert_blender.py -- --cache DIR --out DIR [--only a,b] [--survey]

* imports the render purpose of each asset (no guides/proxies/collision, no cameras/lights)
* converts MDL-only materials (OmniPBR / OmniGlass, used by the Warehouse-01 assets) via a USD import hook
* joins all static meshes into one body mesh, keeps configured movable parts as separate child nodes
* normalises: meters, glTF Y-up, origin at bottom centre of the bounding box, single root node named <id>
* writes <out>/<id>.glb plus <out>/<id>.json (stats for the optimiser / manifest)
Material hints for the optimiser are written as glTF material extras (keys prefixed "ps_").
"""
import bpy, sys, os, re, json, math, time, traceback, glob
import numpy as np
from mathutils import Vector, Matrix
from pxr import Usd, UsdShade, Sdf

HERE = os.path.dirname(os.path.abspath(__file__))

# ----------------------------------------------------------------------------------------------
# arguments
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def arg(name, default=None):
    if name in argv:
        i = argv.index(name)
        return argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith("--") else True
    return default

CACHE = arg("--cache") or os.environ.get("PICKSIM_ASSET_CACHE") or os.path.join(os.environ.get("TEMP", "."), "picksim-asset-cache")
OUT = arg("--out") or os.path.join(CACHE, "_raw_glb")
ONLY = set(x for x in (arg("--only") or "").split(",") if x)
SURVEY = bool(arg("--survey", False))
LIST = arg("--list") or os.path.join(HERE, "assets.json")
os.makedirs(OUT, exist_ok=True)

CFG = json.load(open(LIST, encoding="utf-8"))

# meshes never wanted in a render model
DEFAULT_DROP = r"(collision|collider|_coll?_|_col$|convex|proxy|_hull|physics|guide)"

# ----------------------------------------------------------------------------------------------
# MDL (OmniPBR) material conversion
OMNIPBR_DEFAULTS = dict(
    diffuse_color_constant=(0.2, 0.2, 0.2), albedo_desaturation=0.0, albedo_add=0.0, albedo_brightness=1.0,
    diffuse_tint=(1.0, 1.0, 1.0), reflection_roughness_constant=0.5, reflection_roughness_texture_influence=0.0,
    metallic_constant=0.0, metallic_texture_influence=0.0, enable_ORM_texture=False, enable_emission=False,
    emissive_color=(1.0, 0.1, 0.1), emissive_intensity=40.0, enable_opacity=False, opacity_constant=1.0,
    enable_opacity_texture=False, opacity_mode="mono_average", opacity_threshold=0.0, bump_factor=1.0,
    texture_scale=(1.0, 1.0), texture_translate=(0.0, 0.0), texture_rotate=0.0, project_uvw=False,
)
MATERIAL_LOG = {}


def _split_top(s):
    parts, depth, cur, q = [], 0, [], False
    for ch in s:
        if ch == '"':
            q = not q
        if not q:
            if ch in "([":
                depth += 1
            elif ch in ")]":
                depth -= 1
            elif ch == "," and depth == 0:
                parts.append("".join(cur))
                cur = []
                continue
        cur.append(ch)
    if "".join(cur).strip():
        parts.append("".join(cur))
    return [x.strip() for x in parts]


def _mdl_value(v, mdl_dir):
    v = v.strip()
    m = re.match(r'texture_2d\(\s*"([^"]*)"', v)
    if m:
        p = m.group(1)
        if not p:
            return None
        return os.path.normpath(os.path.join(mdl_dir, p.lstrip("/"))) if not os.path.isabs(p) else p
    m = re.match(r"(?:float[234]?|color)\((.*)\)$", v, re.S)
    if m:
        try:
            nums = [float(x.strip().rstrip("f")) for x in _split_top(m.group(1))]
        except ValueError:
            return v
        if v.startswith("color") and len(nums) == 1:
            nums = nums * 3
        return tuple(nums) if len(nums) > 1 else nums[0]
    if v in ("true", "false"):
        return v == "true"
    try:
        return float(v.rstrip("f"))
    except ValueError:
        return v.split("::")[-1]


def parse_mdl(path, subid):
    txt = open(path, encoding="utf-8", errors="ignore").read()
    txt = re.sub(r"//[^\n]*", "", txt)
    d = os.path.dirname(path)
    for m in re.finditer(r"export\s+material\s+(\w+)\s*\(\s*\*?\s*\)\s*(?:\[\[.*?\]\])?\s*=\s*([\w:]+)\s*\((.*?)\)\s*;", txt, re.S):
        if subid and m.group(1) != subid:
            continue
        params = {}
        for a in _split_top(m.group(3)):
            if ":" not in a or a.startswith("::"):
                continue
            k, v = a.split(":", 1)
            params[k.strip()] = _mdl_value(v, d)
        return m.group(2).split("::")[-1], params
    return None, {}


def omni_params(usd_material):
    out = usd_material.GetSurfaceOutput("mdl")
    srcs = out.GetConnectedSources()[0] if out else []
    if not srcs:
        return None, {}
    shader = UsdShade.Shader(srcs[0].source.GetPrim())
    asset = shader.GetSourceAsset("mdl")
    subid = shader.GetSourceAssetSubIdentifier("mdl")
    base, params = None, {}
    mdl_file = asset.resolvedPath if asset else ""
    if mdl_file and os.path.exists(mdl_file):
        base, params = parse_mdl(mdl_file, subid)
    if not base:
        base = os.path.splitext(os.path.basename(asset.path if asset else "OmniPBR"))[0] or "OmniPBR"
    layer_dir = os.path.dirname(shader.GetPrim().GetPrimStack()[0].layer.realPath) if shader.GetPrim().GetPrimStack() else ""
    for inp in shader.GetInputs():
        v = inp.Get()
        if v is None:
            continue
        if isinstance(v, Sdf.AssetPath):
            p = v.resolvedPath
            if not p and v.path:
                cand = os.path.normpath(os.path.join(layer_dir, v.path))
                p = cand if _exists(cand) else ""  # also UDIM paths (<UDIM> is never "resolved")
            v = p or None
        elif hasattr(v, "__len__") and not isinstance(v, str):
            v = tuple(float(x) for x in v)
        params[inp.GetBaseName()] = v
    return base, params


def _exists(path):
    if path and "<UDIM>" in path:
        return bool(glob.glob(path.replace("<UDIM>", "[0-9][0-9][0-9][0-9]")))
    return bool(path) and os.path.exists(path)


def _img(path, noncolor):
    if "<UDIM>" in path:
        # UDIM set referenced by an MDL/OmniPBR material: load as tiled image (atlas_udims packs it later)
        tiles = sorted(glob.glob(path.replace("<UDIM>", "[0-9][0-9][0-9][0-9]")))
        img = bpy.data.images.load(tiles[0], check_existing=True)
        img.source = "TILED"
        img.filepath = path
        have = {t.number for t in img.tiles}
        for tp in tiles:
            n = int(re.search(r"(\d{4})(?=\.[^.]+$)", tp).group(1))
            if n not in have:
                img.tiles.new(tile_number=n)
                have.add(n)
    else:
        img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = "Non-Color" if noncolor else "sRGB"
    return img


def build_omni_material(mat, base, p):
    """Principled BSDF that the glTF exporter understands; extras carry what glTF needs beyond that."""
    q = dict(OMNIPBR_DEFAULTS)
    q.update({k: v for k, v in p.items() if v is not None})
    mat.use_nodes = True
    nt = mat.node_tree
    N, L = nt.nodes, nt.links
    N.clear()
    out = N.new("ShaderNodeOutputMaterial")
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    L.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    ext = {}

    if base and base.lower().startswith("omniglass"):
        col = q.get("glass_color", (1, 1, 1))
        col = col if isinstance(col, tuple) else (col, col, col)
        bsdf.inputs["Base Color"].default_value = (*col[:3], 1.0)
        bsdf.inputs["Roughness"].default_value = float(q.get("frosting_roughness", 0.05) or 0.05)
        bsdf.inputs["Metallic"].default_value = 0.0
        ext.update(ps_alpha="BLEND", ps_opacity=0.3, ps_kind="glass")
        mat["ps"] = json.dumps(ext)
        return

    vec = None
    sc = q.get("texture_scale", (1, 1))
    sc = sc if isinstance(sc, tuple) else (sc, sc)
    tr = q.get("texture_translate", (0, 0))
    tr = tr if isinstance(tr, tuple) else (tr, tr)
    rot = float(q.get("texture_rotate", 0) or 0)
    if q.get("project_uvw"):
        # triplanar projection in object space: emulated later by box-projected UVs (see box_project)
        ext["ps_project"] = [float(sc[0]), float(sc[1])]
    elif tuple(sc) != (1.0, 1.0) or tuple(tr) != (0.0, 0.0) or rot:
        uv = N.new("ShaderNodeTexCoord")
        mp = N.new("ShaderNodeMapping")
        mp.vector_type = "POINT"
        mp.inputs["Scale"].default_value = (sc[0], sc[1], 1.0)
        mp.inputs["Location"].default_value = (tr[0], tr[1], 0.0)
        mp.inputs["Rotation"].default_value = (0.0, 0.0, math.radians(rot))
        L.new(uv.outputs["UV"], mp.inputs["Vector"])
        vec = mp.outputs["Vector"]

    def tex(path, noncolor):
        n = N.new("ShaderNodeTexImage")
        n.image = _img(path, noncolor)
        if vec is not None:
            L.new(vec, n.inputs["Vector"])
        return n

    # base colour
    tint = q.get("diffuse_tint", (1, 1, 1))
    tint = tint if isinstance(tint, tuple) else (tint, tint, tint)
    adj = (float(q["albedo_desaturation"]), float(q["albedo_add"]), float(q["albedo_brightness"]))
    dtex = q.get("diffuse_texture")
    if _exists(dtex):
        t = tex(dtex, False)
        L.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        if adj != (0.0, 0.0, 1.0):
            ext["ps_albedo_adjust"] = adj
        if tuple(tint[:3]) != (1.0, 1.0, 1.0):
            ext["ps_tint"] = tuple(tint[:3])
    else:
        c = q.get("diffuse_color_constant", (0.2, 0.2, 0.2))
        c = c if isinstance(c, tuple) else (c, c, c)
        c = np.array(c[:3], dtype=float)
        lum = float(c @ np.array([0.2126, 0.7152, 0.0722]))
        c = c * (1 - adj[0]) + lum * adj[0]
        c = np.clip(c * adj[2] + adj[1], 0, 1) * np.array(tint[:3])
        # MDL colours are linear
        bsdf.inputs["Base Color"].default_value = (*c.tolist(), 1.0)

    # roughness / metallic
    orm = q.get("ORM_texture") if q.get("enable_ORM_texture") else None
    rough_tex = orm or q.get("reflectionroughness_texture")
    metal_tex = orm or q.get("metallic_texture")
    use_r = bool(_exists(rough_tex) and float(q["reflection_roughness_texture_influence"]) >= 0.5)
    use_m = bool(_exists(metal_tex) and float(q["metallic_texture_influence"]) >= 0.5)
    bsdf.inputs["Roughness"].default_value = float(q["reflection_roughness_constant"])
    bsdf.inputs["Metallic"].default_value = float(q["metallic_constant"])
    if orm and (use_r or use_m):
        t = tex(orm, True)
        sep = N.new("ShaderNodeSeparateColor")
        L.new(t.outputs["Color"], sep.inputs["Color"])
        if use_r:
            L.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        if use_m:
            L.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
        if use_r and not use_m:
            ext["ps_metallic"] = float(q["metallic_constant"])
        if use_m and not use_r:
            ext["ps_roughness"] = float(q["reflection_roughness_constant"])
    else:
        if use_r:
            L.new(tex(rough_tex, True).outputs["Color"], bsdf.inputs["Roughness"])
        if use_m:
            L.new(tex(metal_tex, True).outputs["Color"], bsdf.inputs["Metallic"])
    if orm and _exists(orm):
        ext["ps_orm"] = True

    # normal map
    ntex = q.get("normalmap_texture")
    if _exists(ntex) and float(q["bump_factor"]) > 0:
        t = tex(ntex, True)
        nm = N.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = float(q["bump_factor"])
        L.new(t.outputs["Color"], nm.inputs["Color"])
        L.new(nm.outputs["Normal"], bsdf.inputs["Normal"])

    # emission
    if q.get("enable_emission"):
        ec = q.get("emissive_color", (1, 1, 1))
        ec = ec if isinstance(ec, tuple) else (ec, ec, ec)
        etex = q.get("emissive_color_texture")
        if _exists(etex):
            t = tex(etex, False)
            L.new(t.outputs["Color"], bsdf.inputs["Emission Color"])
        else:
            bsdf.inputs["Emission Color"].default_value = (*ec[:3], 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.0

    # opacity
    if q.get("enable_opacity"):
        otex = q.get("opacity_texture")
        thr = float(q.get("opacity_threshold", 0) or 0)
        if q.get("enable_opacity_texture") and _exists(otex):
            ext["ps_opacity_tex"] = otex
            ext["ps_opacity_mode"] = str(q.get("opacity_mode", "mono_average"))
        else:
            ext["ps_opacity"] = float(q.get("opacity_constant", 1.0))
        ext["ps_alpha"] = "MASK" if thr > 0 else "BLEND"
        if thr > 0:
            ext["ps_alpha_cutoff"] = thr
    mat["ps"] = json.dumps(ext)


class PickSimUSDHook(bpy.types.USDHook):
    bl_idname = "picksim_usd_hook"
    bl_label = "PickSim USD hook"

    @staticmethod
    def on_import(import_context):
        try:
            for path, ids in import_context.get_prim_map().items():
                for i in ids:
                    if isinstance(i, bpy.types.Object):
                        PRIM_OF[i.name] = str(path)
        except Exception:
            traceback.print_exc()

    @staticmethod
    def material_import_poll(import_context, usd_material):
        out = usd_material.GetSurfaceOutput()
        if out and out.HasConnectedSource():
            return False  # UsdPreviewSurface present -> Blender's own converter
        mo = usd_material.GetSurfaceOutput("mdl")
        return bool(mo and mo.HasConnectedSource())

    @staticmethod
    def on_material_import(import_context, bl_material, usd_material):
        try:
            base, params = omni_params(usd_material)
            build_omni_material(bl_material, base, params)
            MATERIAL_LOG[bl_material.name] = {"base": base, **{k: (v if isinstance(v, (int, float, str, bool, tuple)) or v is None else str(v)) for k, v in params.items()}}
            return True
        except Exception:
            traceback.print_exc()
            return False


PRIM_OF = {}
bpy.utils.register_class(PickSimUSDHook)

# ----------------------------------------------------------------------------------------------
# helpers

def clear_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.node_groups, bpy.data.cameras,
                 bpy.data.lights, bpy.data.curves):
        for d in list(coll):
            coll.remove(d)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
    PRIM_OF.clear()
    MATERIAL_LOG.clear()


def root_usd(asset):
    repo = CFG["repos"][asset["src"]]
    base = os.path.join(CACHE, repo.replace("/", "__"), *asset["path"].split("/"))
    if asset["src"] == "SR":
        meta = os.path.join(base, ".metadata", "com.nvidia.simready.root_usds.json")
        if os.path.exists(meta):
            e = json.load(open(meta, encoding="utf-8"))["entries"][0]
            return os.path.join(base, *e.split("/"))
        return os.path.join(base, "simready_usd", f"sm_{asset['path']}_01.usd")
    name = asset["path"].rstrip("/").split("/")[-1]
    return os.path.join(base, name + ".usd")


def flatten_for_import(path, aid):
    """Warehouse-01 compositions reference their parts as instanceable prims; Blender then skips the USD
    material hook for them. De-instance in the session layer and import a flattened copy instead."""
    stage = Usd.Stage.Open(path)
    stage.SetEditTarget(stage.GetSessionLayer())
    n = 0
    for _ in range(4):
        inst = [p for p in stage.Traverse() if p.IsInstanceable()]
        if not inst:
            break
        for p in inst:
            p.SetInstanceable(False)
        n += len(inst)
    if not n:
        return path
    flat = os.path.join(OUT, "_flat", aid + ".usdc")
    os.makedirs(os.path.dirname(flat), exist_ok=True)
    stage.Export(flat)
    return flat


def import_usd(path):
    props = bpy.ops.wm.usd_import.get_rna_type().properties.keys()
    kw = dict(filepath=path, import_guide=False, import_proxy=False, import_render=True, import_usd_preview=True,
              import_cameras=False, import_lights=False, support_scene_instancing=False, read_mesh_colors=False,
              read_mesh_attributes=False, import_textures_mode="IMPORT_NONE", property_import_mode="NONE",
              create_world_material=False, import_shapes=False, import_curves=False, import_points=False,
              import_volumes=False, import_skeletons=False, import_blendshapes=False, import_visible_only=True,
              import_subdivision=False, set_material_blend=True, mtl_purpose="MTL_FULL",
              mtl_name_collision_mode="MAKE_UNIQUE", import_all_materials=False)
    kw = {k: v for k, v in kw.items() if k == "filepath" or k in props}
    return bpy.ops.wm.usd_import(**kw)


def tri_count(ob):
    me = ob.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def world_bbox(objs):
    mn = np.array([np.inf] * 3)
    mx = -mn
    for ob in objs:
        me = ob.data
        n = len(me.vertices)
        if not n:
            continue
        co = np.empty(n * 3, np.float64)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        M = np.array(ob.matrix_world)
        w = co @ M[:3, :3].T + M[:3, 3]
        mn = np.minimum(mn, w.min(0))
        mx = np.maximum(mx, w.max(0))
    return mn, mx


def material_images(mat):
    out = []
    if mat and mat.use_nodes:
        for n in mat.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image:
                out.append((os.path.basename(n.image.filepath), tuple(n.image.size)))
    return out


def open_edge_ratio(objs):
    """Per material: share of edges that border only one face (open/thin geometry -> doubleSided)."""
    stats = {}
    for ob in objs:
        me = ob.data
        if not len(me.polygons):
            continue
        nl = len(me.loops)
        loop_edge = np.empty(nl, np.int64)
        me.loops.foreach_get("edge_index", loop_edge)
        pmat = np.empty(len(me.polygons), np.int64)
        me.polygons.foreach_get("material_index", pmat)
        ptot = np.empty(len(me.polygons), np.int64)
        me.polygons.foreach_get("loop_total", ptot)
        loop_poly = np.repeat(np.arange(len(me.polygons)), ptot)
        edge_use = np.bincount(loop_edge, minlength=len(me.edges))
        for mi in np.unique(pmat):
            sel = pmat[loop_poly] == mi
            e = loop_edge[sel]
            if not len(e):
                continue
            slot = ob.material_slots[mi].material if mi < len(ob.material_slots) else None
            name = slot.name if slot else "_none_"
            s = stats.setdefault(name, [0, 0])
            s[0] += int((edge_use[e] == 1).sum())
            s[1] += int(len(e))
    return {k: (v[0] / v[1] if v[1] else 0.0) for k, v in stats.items()}


def box_project(ob):
    """Faces whose material asks for OmniPBR project_uvw get box-projected UVs (object space, stage units)."""
    me = ob.data
    if not me.uv_layers or not len(me.polygons):
        return
    scales = {}
    for i, s in enumerate(ob.material_slots):
        if s.material and "ps" in s.material:
            ps = json.loads(s.material["ps"])
            if "ps_project" in ps:
                scales[i] = ps["ps_project"]
    if not scales:
        return
    npoly = len(me.polygons)
    pm = np.empty(npoly, np.int64)
    me.polygons.foreach_get("material_index", pm)
    nrm = np.empty(npoly * 3, np.float32)
    me.polygons.foreach_get("normal", nrm)
    axis = np.abs(nrm.reshape(-1, 3)).argmax(1)
    tot = np.empty(npoly, np.int64)
    me.polygons.foreach_get("loop_total", tot)
    loop_face = np.repeat(np.arange(npoly), tot)
    lv = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get("vertex_index", lv)
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)[lv]
    ax = axis[loop_face]
    u = np.where(ax == 0, co[:, 1], co[:, 0])
    v = np.where(ax == 2, co[:, 1], co[:, 2])
    uvl = me.uv_layers.active or me.uv_layers[0]
    uv = np.empty(len(me.loops) * 2, np.float32)
    uvl.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    for mi, (sx, sy) in scales.items():
        sel = pm[loop_face] == mi
        uv[sel, 0] = u[sel] * sx
        uv[sel, 1] = v[sel] * sy
    uvl.data.foreach_set("uv", uv.ravel())


def renormal(ob, angle_deg):
    me = ob.data
    if "custom_normal" in me.attributes:
        me.attributes.remove(me.attributes["custom_normal"])
    try:
        with bpy.context.temp_override(active_object=ob, object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
    except Exception:
        pass
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(angle_deg))


def _tile_path(img, number):
    p = bpy.path.abspath(img.filepath)
    return p.replace("<UDIM>", str(number))


def atlas_udims(aid, meshes, atlas_max=2048):
    """glTF has no UDIMs: pack all UDIM tiles of every tiled image into one atlas per map and remap the UVs
    of the faces that use them (faces of non-UDIM materials keep their UVs)."""
    tiled = [im for im in bpy.data.images if im.source == "TILED" and im.users]
    if not tiled:
        return None
    numbers = sorted({t.number for im in tiled for t in im.tiles})
    n = len(numbers)
    cols = math.ceil(math.sqrt(n))
    rows = math.ceil(n / cols)
    cell = atlas_max // max(cols, rows)
    W, H = cell * cols, cell * rows
    g = max(4, cell // 64)  # gutter against mip bleeding
    pos = {num: (i % cols, i // cols) for i, num in enumerate(numbers)}
    outdir = os.path.join(OUT, "_atlas", aid)
    os.makedirs(outdir, exist_ok=True)

    repl = {}
    for im in tiled:
        noncolor = im.colorspace_settings.name != "sRGB"
        kind = im.name.lower()
        fill = (0.5, 0.5, 1.0, 1.0) if "nor" in kind else ((1.0, 0.5, 0.0, 1.0) if "orm" in kind else (0.5, 0.5, 0.5, 1.0))
        arr = np.empty((H, W, 4), np.float32)
        arr[:] = fill
        for t in im.tiles:
            tp = _tile_path(im, t.number)
            if not os.path.exists(tp):
                continue
            ti = bpy.data.images.load(tp)
            ti.colorspace_settings.name = "Non-Color"
            ti.scale(cell - 2 * g, cell - 2 * g)
            w, h = ti.size
            px = np.empty(w * h * 4, np.float32)
            ti.pixels.foreach_get(px)
            px = np.pad(px.reshape(h, w, 4), ((g, g), (g, g), (0, 0)), mode="edge")
            c, r = pos[t.number]
            arr[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell] = px
            bpy.data.images.remove(ti)
        base = re.sub(r"[.<>]*UDIM[.<>]*", "", os.path.splitext(os.path.basename(im.filepath))[0]).rstrip("._")
        fname = os.path.join(outdir, f"{base}_atlas.png")
        a = bpy.data.images.new(base + "_atlas", W, H, alpha=True)
        a.colorspace_settings.name = "Non-Color"
        a.pixels.foreach_set(arr.ravel())
        a.filepath_raw = fname
        a.file_format = "PNG"
        a.save()
        bpy.data.images.remove(a)
        na = bpy.data.images.load(fname)
        na.name = base + "_atlas"
        na.colorspace_settings.name = "Non-Color" if noncolor else "sRGB"
        na.alpha_mode = "CHANNEL_PACKED" if noncolor else "STRAIGHT"
        repl[im] = na

    tiled_mats = set()
    for m in bpy.data.materials:
        if m.node_tree:
            for nd in m.node_tree.nodes:
                if nd.type == "TEX_IMAGE" and nd.image in repl:
                    nd.image = repl[nd.image]
                    tiled_mats.add(m.name)

    for ob in meshes:
        me = ob.data
        if not me.uv_layers or not len(me.polygons):
            continue
        slots = [s.material.name if s.material else "" for s in ob.material_slots]
        use = np.array([s in tiled_mats for s in slots] or [False], bool)
        pm = np.empty(len(me.polygons), np.int64)
        me.polygons.foreach_get("material_index", pm)
        pm = np.clip(pm, 0, len(use) - 1)
        face_use = use[pm]
        if not face_use.any():
            continue
        tot = np.empty(len(me.polygons), np.int64)
        me.polygons.foreach_get("loop_total", tot)
        loop_face = np.repeat(np.arange(len(me.polygons)), tot)
        for uvl in me.uv_layers:
            uv = np.empty(len(me.loops) * 2, np.float32)
            uvl.data.foreach_get("uv", uv)
            uv = uv.reshape(-1, 2)
            cu = np.bincount(loop_face, uv[:, 0], len(me.polygons)) / tot
            cv = np.bincount(loop_face, uv[:, 1], len(me.polygons)) / tot
            tu, tv = np.floor(cu).astype(int), np.floor(cv).astype(int)
            num = 1001 + tu + 10 * tv
            colrow = np.array([pos.get(int(x), (-1, -1)) for x in num])
            ok = face_use & (colrow[:, 0] >= 0)
            lf = ok[loop_face]
            fu = uv[:, 0] - tu[loop_face]
            fv = uv[:, 1] - tv[loop_face]
            cc, rr = colrow[loop_face, 0], colrow[loop_face, 1]
            nu = (cc * cell + g + fu * (cell - 2 * g)) / W
            nv = (rr * cell + g + fv * (cell - 2 * g)) / H
            uv[lf, 0] = nu[lf]
            uv[lf, 1] = nv[lf]
            uvl.data.foreach_set("uv", uv.ravel())
    for im in list(repl):
        bpy.data.images.remove(im)
    return {"tiles": n, "grid": [cols, rows], "cell": cell, "size": [W, H]}


def select_only(objs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    if active is None and objs:
        active = objs[0]
    bpy.context.view_layer.objects.active = active


def join(objs, name):
    objs = [o for o in objs if o.type == "MESH"]
    if not objs:
        return None
    target = objs[0]
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=target, selected_editable_objects=objs, selected_objects=objs,
                                       object=target):
            bpy.ops.object.join()
    target.name = name
    target.data.name = name
    return target


# ----------------------------------------------------------------------------------------------

def convert(asset):
    aid = asset["id"]
    t0 = time.time()
    clear_scene()
    src = root_usd(asset)
    if not os.path.exists(src):
        raise FileNotFoundError(src)
    import_usd(flatten_for_import(src, aid) if asset["src"] == "WH" else src)
    info = {"id": aid, "source": src, "dropped": [], "objects": []}

    # 0) materials built inside the USD hook crash the glTF exporter (Blender 5.2) -> replace by copies
    repl = {m: m.copy() for m in [m for m in bpy.data.materials if "ps" in m]}  # snapshot: copies must not be copied again
    for ob in bpy.data.objects:
        if ob.type == "MESH":
            for s in ob.material_slots:
                if s.material in repl:
                    s.material = repl[s.material]
    for m, c in repl.items():
        nm = m.name
        bpy.data.materials.remove(m)
        c.name = nm
        if nm in MATERIAL_LOG:
            MATERIAL_LOG[c.name] = MATERIAL_LOG[nm]

    # 0b) materials linked to the object (instanced USD prims) would be lost when joining -> move them to the mesh
    for ob in bpy.data.objects:
        if ob.type != "MESH" or not any(s.link == "OBJECT" for s in ob.material_slots):
            continue
        if ob.data.users > 1:
            ob.data = ob.data.copy()
        for i, s in enumerate(ob.material_slots):
            if s.link == "OBJECT":
                m = s.material
                s.link = "DATA"
                ob.data.materials[i] = m

    # 1) keep only meshes (empties are dissolved below)
    for ob in list(bpy.data.objects):
        if ob.type not in ("MESH", "EMPTY"):
            bpy.data.objects.remove(ob, do_unlink=True)
    drop_re = re.compile(DEFAULT_DROP + ("|" + asset["drop"] if asset.get("drop") else ""), re.I)
    for ob in list(bpy.data.objects):
        if ob.type != "MESH":
            continue
        path = PRIM_OF.get(ob.name, ob.name)
        if drop_re.search(path) or ob.hide_render or not len(ob.data.polygons):
            info["dropped"].append(path)
            bpy.data.objects.remove(ob, do_unlink=True)

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    for ob in meshes:
        info["objects"].append({"name": ob.name, "path": PRIM_OF.get(ob.name, ""), "tris": tri_count(ob),
                                "mats": [m.name for m in ob.data.materials if m]})
    info["tris_in"] = sum(o["tris"] for o in info["objects"])
    mn, mx = world_bbox(meshes)
    info["size_in"] = (mx - mn).round(4).tolist()
    info["materials"] = {m.name: {"images": material_images(m), "omni": MATERIAL_LOG.get(m.name)} for m in bpy.data.materials if m.users}
    if SURVEY:
        return info

    # 2) flatten hierarchy (keep world transforms), drop empties
    for ob in meshes:
        if ob.data.users > 1:
            ob.data = ob.data.copy()
    # 2a) OmniPBR "project_uvw" (object-space triplanar) -> box-projected UVs, before transforms are baked
    for ob in meshes:
        box_project(ob)
    for ob in meshes:
        mw = ob.matrix_world.copy()
        ob.parent = None
        ob.matrix_world = mw
    for ob in list(bpy.data.objects):
        if ob.type == "EMPTY":
            bpy.data.objects.remove(ob, do_unlink=True)

    # 2b) UDIM tiles -> atlas
    info["udim"] = atlas_udims(aid, meshes)

    # 3) movable parts: objects whose USD prim path matches asset["keep"] stay separate child nodes
    keep_re = re.compile(asset["keep"]) if asset.get("keep") else None
    parts, body = [], []
    for ob in meshes:
        path = PRIM_OF.get(ob.name, ob.name)
        (parts if keep_re and keep_re.search(path) else body).append(ob)

    # bake full transforms into body meshes; parts keep location/rotation as pivot, scale is applied
    if body:
        select_only(body)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True, isolate_users=True)
    if asset.get("renormal"):
        # authored normals that split nearly every vertex block the simplifier: smooth by angle instead
        for ob in body:
            renormal(ob, float(asset["renormal"]))
    all_parts = []
    if parts:
        select_only(parts)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True, isolate_users=True)
        used = set()
        for ob in sorted(parts, key=lambda o: PRIM_OF.get(o.name, o.name)):
            path = PRIM_OF.get(ob.name, ob.name)
            m = re.search(r"/([^/]+?)_obj_\d+", path)
            nm = m.group(1) if m else ob.name
            nm = re.sub(r"_[a-z]\d{2}$", "", re.sub(r"^sm_", "", nm))
            base, i = nm, 2
            while nm in used:
                nm = f"{base}_{i}"
                i += 1
            used.add(nm)
            all_parts.append(join([ob], nm))

    # 4) normalise: bottom centre to origin (Blender Z-up: x/y centred, min z = 0)
    objs = body + all_parts
    mn, mx = world_bbox(objs)
    off = Vector(((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, mn[2]))
    for ob in body:
        ob.data.transform(Matrix.Translation(-off))
    for ob in all_parts:
        ob.location = ob.location - off
    bpy.context.view_layer.update()

    # 5) join body, build hierarchy (root = body mesh named <id>)
    root = join(body, aid) if body else None
    if root is None:
        root = bpy.data.objects.new(aid, None)
        bpy.context.scene.collection.objects.link(root)
    bpy.context.view_layer.update()
    for ob in all_parts:
        mw = ob.matrix_world.copy()
        ob.parent = root
        ob.matrix_parent_inverse = Matrix.Identity(4)
        ob.matrix_world = mw
    bpy.context.view_layer.update()

    # 6) material hints: open-edge ratio per material, remove unused slots
    ratio = open_edge_ratio([o for o in [root] + all_parts if o.type == "MESH"])
    for m in bpy.data.materials:
        if m.users:
            ps = json.loads(m.get("ps", "{}"))
            ps["ps_open"] = round(ratio.get(m.name, 0.0), 4)
            m["ps"] = json.dumps(ps)
    for ob in [root] + all_parts:
        if ob.type == "MESH":
            select_only([ob])
            bpy.ops.object.material_slot_remove_unused()

    mn, mx = world_bbox([o for o in [root] + all_parts if o.type == "MESH"])
    info["size"] = (mx - mn).round(4).tolist()
    info["parts"] = [o.name for o in all_parts]
    info["tris_out"] = sum(tri_count(o) for o in [root] + all_parts if o.type == "MESH")

    # 7) export
    out = os.path.join(OUT, aid + ".glb")
    gp = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    ekw = dict(filepath=out, export_format="GLB", export_yup=True, export_apply=True, use_selection=False,
               export_cameras=False, export_lights=False, export_extras=True, export_animations=False,
               export_skins=False, export_morph=False, export_attributes=False, export_vertex_color="NONE",
               export_tangents=False, export_image_format="AUTO", export_materials="EXPORT",
               export_gpu_instances=False, export_texcoords=True, export_normals=True,
               export_shared_accessors=False, export_original_specular=False)
    ekw = {k: v for k, v in ekw.items() if k == "filepath" or k in gp}
    bpy.ops.export_scene.gltf(**ekw)
    info["seconds"] = round(time.time() - t0, 1)
    info["raw_bytes"] = os.path.getsize(out)
    return info


def main():
    results = {}
    for asset in CFG["assets"]:
        if ONLY and asset["id"] not in ONLY:
            continue
        try:
            info = convert(asset)
            results[asset["id"]] = info
            if not SURVEY:
                with open(os.path.join(OUT, asset["id"] + ".json"), "w", encoding="utf-8") as f:
                    json.dump(info, f, indent=1)
            print(f"@@ {asset['id']:22s} ok tris_in={info['tris_in']} size={info.get('size', info.get('size_in'))} "
                  f"parts={info.get('parts')} {info.get('seconds', '')}s", flush=True)
        except Exception as e:
            traceback.print_exc()
            results[asset["id"]] = {"error": str(e)}
            print(f"@@ {asset['id']:22s} FAILED {e}", flush=True)
    if SURVEY:
        sp = arg("--survey-out") or os.path.join(OUT, "survey.json")
        with open(sp, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=1, default=str)
        print("survey written", sp)


main()
