// Kleiner Webserver ohne Abhängigkeiten für PickSim.
//   node tools/serve.mjs            → http://localhost:8080 (Desktop-Browser)
//   node tools/serve.mjs --https    → zusätzlich https://<PC-IP>:8443 (für die Meta Quest 3 im WLAN)
// Für HTTPS wird beim ersten Start ein selbstsigniertes Zertifikat mit OpenSSL erzeugt
// (OpenSSL ist z. B. in "Git for Windows" enthalten). Die Quest zeigt dann einmalig eine Warnung,
// die man mit „Erweitert → Weiter zu …“ bestätigt.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
// --root=<Ordner> liefert einen anderen Ordner aus (z. B. die Artifact-Fassung aus tools/build-artifact.mjs).
// --artifact ahmt den Artifact-Rahmen nach: HTML-Fragmente bekommen ein Grundgerüst, und eine strenge
// Sicherheitsrichtlinie sperrt WebAssembly sowie fremde Skript- und Schriftquellen.
const rootArg = args.find(a => a.startsWith('--root='));
const ROOT = path.resolve(rootArg ? rootArg.slice(7) : path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const ARTIFACT = args.includes('--artifact');
// --strict-case verhält sich wie ein Linux-Webserver (z. B. GitHub Pages): Pfade müssen in Groß-/Kleinschreibung
// exakt passen. Fehlende Dateien werden im Fenster protokolliert.
const STRICT_CASE = args.includes('--strict-case');
const REAL_ROOT = STRICT_CASE ? fs.realpathSync.native(ROOT) : ROOT;
const ARTIFACT_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
  "img-src 'self' data:; connect-src 'self'";
const PORT = Number(process.env.PORT || 8080);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443);
const wantHttps = args.includes('--https');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ktx2': 'image/ktx2',
  '.hdr': 'application/octet-stream', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
};

// Nur für Entwicklung: --shots=<Ordner> erlaubt das Speichern von Screenshots per POST /__shot?name=x.jpg
const shotsArg = args.find(a => a.startsWith('--shots='));
const SHOTS = shotsArg ? shotsArg.slice(8) : null;

function handler(req, res) {
  if (SHOTS && req.method === 'POST' && req.url.startsWith('/__shot')) {
    const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'shot.jpg').replace(/[^\w.-]/g, '_');
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const s = Buffer.concat(chunks).toString();
      const b64 = s.slice(s.indexOf(',') + 1);
      fs.mkdirSync(SHOTS, { recursive: true });
      fs.writeFileSync(path.join(SHOTS, name), Buffer.from(b64, 'base64'));
      res.writeHead(200); res.end('ok');
    });
    return;
  }
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.stat(file, (err, st) => {
      const caseOk = !STRICT_CASE || err || fs.realpathSync.native(file).slice(REAL_ROOT.length) === file.slice(ROOT.length);
      if (err || !st.isFile() || !caseOk) {
        if (STRICT_CASE) console.log(`404 ${caseOk ? 'fehlt' : 'Groß-/Kleinschreibung'}: ${p}`);
        res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Nicht gefunden');
      }
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const head = { 'Content-Type': type, 'Cache-Control': 'no-cache', 'Cross-Origin-Opener-Policy': 'same-origin' };
      if (ARTIFACT) head['Content-Security-Policy'] = ARTIFACT_CSP;
      if (ARTIFACT && type.startsWith('text/html')) {
        let html = fs.readFileSync(file, 'utf8');
        if (!/^\s*<!doctype/i.test(html)) html = '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>' + html + '</body></html>';
        res.writeHead(200, head); return res.end(html);
      }
      head['Content-Length'] = st.size;
      res.writeHead(200, head);
      fs.createReadStream(file).pipe(res);
    });
  } catch (e) { res.writeHead(500); res.end(String(e)); }
}

function lanIPs() {
  return Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
}

http.createServer(handler).listen(PORT, () => {
  console.log(`\n  PickSim läuft:  http://localhost:${PORT}\n`);
});

if (wantHttps) {
  const dir = path.join(ROOT, 'tools', '.cert');
  const key = path.join(dir, 'key.pem'), crt = path.join(dir, 'cert.pem');
  if (!fs.existsSync(key) || !fs.existsSync(crt)) {
    fs.mkdirSync(dir, { recursive: true });
    const candidates = ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe'];
    const san = ['DNS:localhost', 'IP:127.0.0.1', ...lanIPs().map(ip => 'IP:' + ip)].join(',');
    let ok = false;
    for (const bin of candidates) {
      try {
        execFileSync(bin, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '825', '-subj', '/CN=PickSim', '-addext', 'subjectAltName=' + san], { stdio: 'ignore' });
        ok = true; break;
      } catch (e) { /* nächster Kandidat */ }
    }
    if (!ok) { console.log('  HTTPS nicht möglich: OpenSSL nicht gefunden (z. B. Git for Windows installieren).'); }
  }
  if (fs.existsSync(key) && fs.existsSync(crt)) {
    https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(crt) }, handler).listen(HTTPS_PORT, () => {
      console.log('  Für die Meta Quest 3 (gleiches WLAN) im Quest-Browser öffnen:');
      for (const ip of lanIPs()) console.log(`     https://${ip}:${HTTPS_PORT}`);
      console.log('  (Zertifikatswarnung einmalig bestätigen: „Erweitert“ → „Weiter“)\n');
    });
  }
}
