// Baut die PC-Fassung von PickSim als claude.ai-Artifact:
//  - Startseite als Fragment (der Artifact-Dienst ergänzt <html>/<head>/<body> selbst)
//  - Schriften über Google Fonts (andere Schriftquellen blockiert die Sicherheitsrichtlinie)
//  - Modelle ohne meshopt-Kompression (falls WebAssembly im Artifact-Rahmen nicht erlaubt ist),
//    als gzip-Base64-Text verpackt (siehe unten)
//  - ohne Server-, Start- und Entwicklungsdateien
//   node tools/build-artifact.mjs <ausgabeOrdner> <ordnerMitDekodiertenModellen>
// Die dekodierten Modelle (GLB + manifest.json) erzeugt tools/decode-meshopt.mjs.
// Lokal testen: node tools/serve.mjs --root=<ausgabeOrdner> --artifact
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'dist-artifact'));
if (!process.argv[3]) { console.error('Aufruf: node tools/build-artifact.mjs <ausgabeOrdner> <ordnerMitDekodiertenModellen>'); process.exit(1); }
const MODELS = path.resolve(process.argv[3]);

fs.rmSync(OUT, { recursive: true, force: true });
const copyDir = (src, dst) => {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
};
copyDir(path.join(ROOT, 'src'), path.join(OUT, 'src'));
copyDir(path.join(ROOT, 'vendor'), path.join(OUT, 'vendor'));
copyDir(path.join(ROOT, 'assets', 'textures'), path.join(OUT, 'assets', 'textures'));
fs.copyFileSync(path.join(ROOT, 'assets', 'CREDITS.md'), path.join(OUT, 'assets', 'CREDITS.md'));

// Modelle: claude.ai liefert keine .glb-Dateien aus. Jede GLB wird deshalb gzip-komprimiert und als
// Base64-Text gespeichert (<datei>.glb.gz.txt); src/core/assets.js entpackt sie im Browser.
const manifest = JSON.parse(fs.readFileSync(path.join(MODELS, 'manifest.json'), 'utf8'));
fs.mkdirSync(path.join(OUT, 'assets', 'models'), { recursive: true });
for (const [id, info] of Object.entries(manifest)) {
  const file = info.file || id + '.glb';
  const glb = fs.readFileSync(path.join(MODELS, file));
  if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} ist keine GLB-Datei`);
  info.file = file + '.gz.txt';
  fs.writeFileSync(path.join(OUT, 'assets', 'models', info.file), zlib.gzipSync(glb, { level: 9 }).toString('base64'));
}
fs.writeFileSync(path.join(OUT, 'assets', 'models', 'manifest.json'), JSON.stringify(manifest));

// Stylesheet ohne lokale @font-face-Regeln (Schriften kommen von Google Fonts)
const css = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8').split('\n').filter(l => !l.startsWith('@font-face')).join('\n');
fs.writeFileSync(path.join(OUT, 'src', 'styles.css'), css);

// Startseite: Markup des <body> aus index.html übernehmen
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
const page = `<title>PickSim Lagersimulator</title>
<meta name="description" content="3D-Simulation der Kommissionierung in vier Lagertypen für die Ausbildung im E-Commerce.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="src/styles.css">
<script type="importmap">
{ "imports": { "three": "./vendor/three/three.module.js", "three/addons/": "./vendor/three/addons/" } }
</script>
${body.trim()}
`;
fs.writeFileSync(path.join(OUT, 'index.html'), page);

// Dateiliste für die Veröffentlichung
const list = [];
const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else list.push(path.relative(OUT, p).replace(/\\/g, '/')); } };
walk(OUT);
const files = list.filter(f => f !== 'index.html' && f !== 'files.json').sort();
// Dateitypen, die sich nicht sicher aus der Endung ableiten lassen, ausdrücklich angeben
const typeOf = p => !path.posix.extname(p) ? 'text/plain' : null;
fs.writeFileSync(path.join(OUT, 'files.json'), JSON.stringify(files.map(p => typeOf(p) ? { path: p, contentType: typeOf(p) } : { path: p })));
const bytes = files.reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0) + fs.statSync(path.join(OUT, 'index.html')).size;
console.log(`Artifact-Fassung in ${OUT}: ${files.length + 1} Dateien, ${(bytes / 1e6).toFixed(1)} MB`);
