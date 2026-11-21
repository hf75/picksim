// PickSim asset pipeline: checks every GLB in assets/models
//   node verify.mjs [--models DIR] [--modules DIR]
// Reports glTF-validator errors, root node name, normalisation (bottom centre), required extensions,
// largest texture, ORM->occlusion and budget overruns. Exit code 1 if a hard error is found.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const TEMP = process.env.TEMP || '/tmp';
const MODULES = arg('--modules', process.env.PICKSIM_NODE_MODULES || path.join(TEMP, 'picksim-node-tools', 'node_modules'));
const MODELS = arg('--models', path.resolve(HERE, '..', '..', 'assets', 'models'));
const CFG = JSON.parse(fs.readFileSync(path.join(HERE, 'assets.json'), 'utf8'));

async function load(pkg) {
  const dir = path.join(MODULES, ...pkg.split('/'));
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const ex = pj.exports && (pj.exports['.'] || pj.exports);
  const pick = (e) => typeof e === 'string' ? e : e && (pick(e.import) || pick(e.default));
  return import(pathToFileURL(path.join(dir, (ex && pick(ex)) || pj.main || 'index.js')).href);
}
const { NodeIO } = await load('@gltf-transform/core');
const { ALL_EXTENSIONS } = await load('@gltf-transform/extensions');
const { getBounds } = await load('@gltf-transform/functions');
const { MeshoptDecoder } = await load('meshoptimizer');
const sharp = (await load('sharp')).default;
const validator = (await load('gltf-validator')).default;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

let total = 0, hard = 0;
for (const a of CFG.assets) {
  const f = path.join(MODELS, `${a.id}.glb`);
  if (!fs.existsSync(f)) { console.log(`${a.id}: FEHLT`); hard++; continue; }
  const buf = fs.readFileSync(f);
  total += buf.length;
  const rep = await validator.validateBytes(new Uint8Array(buf), { maxIssues: 100 });
  const errs = [...new Set(rep.issues.messages.filter((m) => m.severity === 0).map((m) => m.code))];
  const doc = await io.readBinary(new Uint8Array(buf));
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  const tops = scene.listChildren();
  const b = getBounds(scene);
  const ext = root.listExtensionsUsed().map((e) => e.extensionName);
  let maxTex = 0;
  for (const t of root.listTextures()) {
    const m = await sharp(Buffer.from(t.getImage())).metadata();
    maxTex = Math.max(maxTex, m.width, m.height);
  }
  let tris = 0;
  for (const n of root.listNodes()) for (const p of n.getMesh()?.listPrimitives() ?? []) tris += (p.getIndices()?.getCount() ?? 0) / 3;
  const cls = CFG.classes[a.class];
  const issues = [];
  if (errs.length) { issues.push('VALIDATOR ' + errs.join(',')); hard++; }
  if (tops.length !== 1 || tops[0].getName() !== a.id) { issues.push(`Wurzel: ${tops.map((t) => t.getName()).join('|')}`); hard++; }
  const tr = tops[0]?.getTranslation() ?? [0, 0, 0], sc = tops[0]?.getScale() ?? [1, 1, 1];
  if (tr.some((v) => Math.abs(v) > 1e-6) || sc.some((v) => Math.abs(v - 1) > 1e-6)) { issues.push('Wurzel nicht neutral'); hard++; }
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
  if (Math.abs(b.min[1]) > 0.002 || Math.abs(cx) > 0.002 || Math.abs(cz) > 0.002) { issues.push(`Ursprung: minY ${b.min[1].toFixed(4)} Mitte ${cx.toFixed(4)}/${cz.toFixed(4)}`); hard++; }
  for (const e of ['EXT_meshopt_compression', 'KHR_mesh_quantization']) if (!ext.includes(e)) issues.push('fehlt ' + e);
  if (root.listCameras().length || ext.includes('KHR_lights_punctual')) { issues.push('Kamera/Licht'); hard++; }
  const noOcc = root.listMaterials().filter((m) => /orm/i.test(m.getMetallicRoughnessTexture()?.getName() ?? '') && !m.getOcclusionTexture()).length;
  if (noOcc) issues.push(`${noOcc} ORM ohne occlusionTexture`);
  if (tris > (a.maxTris ?? cls.maxTris)) issues.push(`Budget ${a.maxTris ?? cls.maxTris} Dreiecke überschritten`);
  if (maxTex > (a.maxTex ?? cls.maxTex)) issues.push(`Textur ${maxTex} px > ${a.maxTex ?? cls.maxTex}`);
  console.log(`${a.id.padEnd(22)} ${String(Math.round(tris)).padStart(6)} Dr. ${String(Math.round(buf.length / 1024)).padStart(5)} KB  Tex<=${String(maxTex).padStart(4)}  ${issues.join(' | ') || 'ok'}`);
}
console.log(`Summe: ${(total / 1048576).toFixed(1)} MB`);
process.exit(hard ? 1 : 0);
