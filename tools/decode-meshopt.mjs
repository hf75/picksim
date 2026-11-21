// Erzeugt Kopien der GLB-Modelle ohne EXT_meshopt_compression (kein WebAssembly zum Laden nötig).
// Gebraucht für die Artifact-Fassung, deren Sicherheitsrichtlinie WebAssembly evtl. nicht erlaubt.
// Quantisierung (KHR_mesh_quantization) bleibt erhalten – die kann three.js ohne WebAssembly lesen.
//   node tools/decode-meshopt.mjs <eingabeOrdner> <ausgabeOrdner>
// Benötigt @gltf-transform/core, @gltf-transform/extensions und meshoptimizer (z. B. per npm in einem Werkzeugordner).
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [inDir, outDir] = process.argv.slice(2);
if (!inDir || !outDir) { console.error('Aufruf: node decode-meshopt.mjs <ein> <aus>'); process.exit(1); }
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
fs.mkdirSync(outDir, { recursive: true });
let before = 0, after = 0;
for (const f of fs.readdirSync(inDir)) {
  const src = path.join(inDir, f), dst = path.join(outDir, f);
  if (!f.endsWith('.glb')) { fs.copyFileSync(src, dst); continue; }
  const doc = await io.read(src);
  for (const ext of doc.getRoot().listExtensionsUsed()) if (ext.extensionName === 'EXT_meshopt_compression') ext.dispose();
  await io.write(dst, doc);
  before += fs.statSync(src).size; after += fs.statSync(dst).size;
}
console.log(`GLB vorher ${(before / 1e6).toFixed(1)} MB, nachher ${(after / 1e6).toFixed(1)} MB`);
