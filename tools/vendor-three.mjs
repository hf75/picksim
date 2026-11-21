// Copies three.js core + the addons PickSim uses (with their relative dependencies)
// from an unpacked npm package into ./vendor/three.  Usage:
//   node tools/vendor-three.mjs <path-to-unpacked-three-package>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = process.argv[2];
if (!pkg) { console.error('Pfad zum entpackten three-Paket fehlt'); process.exit(1); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'vendor', 'three');

const ENTRIES = [
  'loaders/GLTFLoader.js',
  'loaders/HDRLoader.js',
  'libs/meshopt_decoder.module.js',
  'webxr/XRControllerModelFactory.js',
  'webxr/XRHandModelFactory.js',
  'postprocessing/EffectComposer.js',
  'postprocessing/RenderPass.js',
  'postprocessing/OutputPass.js',
  'postprocessing/UnrealBloomPass.js',
  'postprocessing/GTAOPass.js',
  'postprocessing/SMAAPass.js',
  'postprocessing/ShaderPass.js',
  'utils/BufferGeometryUtils.js',
  'utils/SkeletonUtils.js',
  'geometries/RoundedBoxGeometry.js',
  'environments/RoomEnvironment.js',
];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'addons'), { recursive: true });
for (const f of ['three.module.js', 'three.core.js']) {
  fs.copyFileSync(path.join(pkg, 'build', f), path.join(out, f));
}
fs.copyFileSync(path.join(pkg, 'LICENSE'), path.join(out, 'LICENSE'));

const jsm = path.join(pkg, 'examples', 'jsm');
const seen = new Set();
const queue = [...ENTRIES];
while (queue.length) {
  const rel = queue.shift().replace(/\\/g, '/');
  if (seen.has(rel)) continue;
  seen.add(rel);
  const src = path.join(jsm, rel);
  const code = fs.readFileSync(src, 'utf8');
  const dst = path.join(out, 'addons', rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, code);
  const re = /(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\s*['"](\.{1,2}\/[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(code))) {
    const spec = m[1] || m[2];
    const dep = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
    queue.push(dep);
  }
}
console.log(`three core + ${seen.size} Addon-Dateien nach ${out} kopiert:`);
console.log([...seen].sort().join('\n'));
