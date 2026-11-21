// LAGER 01 – Eisenwaren Krämer
// Fachbodenregallager · Mann-zur-Ware · Pick-by-Paper · Festplatzsystem · einstufige, auftragsweise Kommissionierung
import * as THREE from 'three';
import { buildHall, setupLighting, captureEnvironment, bakeFloorAO, dust, floorLines, boxGeo, mergeToMesh } from '../core/env.js';
import { shelfRow, Atlas, AtlasInstances, ModelInstances, atlasInstancedMaterial, binGeometry, simpleCart, signMesh, windowMesh, labelStrips } from '../core/builders.js';
import { locationLabel, makeCanvas, drawEAN, makeEAN, signCanvas, FONT, MONO, wrapText, shade, drawIcon } from '../core/canvas.js';
import { Interaction, fitObject, roundRect } from '../core/interaction.js';
import { fmtTime, fmtNum } from '../sim/mission.js';
import { groundCenter } from '../core/assets.js';

const RNG = s => () => (s = (s * 16807) % 2147483647) / 2147483647;

// ------------------------------------------------------------------ Hallen-Layout
const HALL = { w: 12, d: 16, h: 4.2 };
const SECTIONS = 10, SECTION_W = 0.75, DEPTH = 0.46, SHELF_H = 2.12;
const LEVELS_Y = [0.1, 0.5, 0.9, 1.3, 1.7];
const ROW_Z = -3.85;                    // Mitte der Regalzeilen (Fach 01 vorne bei z≈-0.5)
const REGALE = [
  { id: 'A', x: -5.6, ry: Math.PI / 2 },     // Front zeigt nach +X (Gang 1)
  { id: 'B', x: -3.49, ry: -Math.PI / 2 },   // Front zeigt nach -X (Gang 1)
  { id: 'C', x: -3.01, ry: Math.PI / 2 },    // Front zeigt nach +X (Gang 2)
  { id: 'D', x: -0.9, ry: -Math.PI / 2 },    // Front zeigt nach -X (Gang 2)
];
const SPOTS = {
  printer: new THREE.Vector3(5.2, 0, 1.45),     // Bürotisch an der Ostwand (x wird an die Tischtiefe angepasst)
  packing: new THREE.Vector3(2.6, 0, 6.95),     // Packtisch vorne
  cart: new THREE.Vector3(0.75, 0, 2.2),
  spawn: { x: 2.6, z: 4.6, yaw: 0.35 },
};

// ------------------------------------------------------------------ Artikelstamm
const PACK = {
  screw: [0.085, 0.115, 0.038], dowel: [0.08, 0.105, 0.034], nut: [0.07, 0.09, 0.032], nail: [0.09, 0.12, 0.05],
  tie: [0.085, 0.2, 0.022], tape: [0.105, 0.105, 0.052], sand: [0.115, 0.15, 0.016], batt: [0.065, 0.105, 0.022],
  cart: [0.062, 0.24, 0.062], glue: [0.075, 0.13, 0.045], tool: [0.1, 0.26, 0.045], toolL: [0.12, 0.36, 0.05], glove: [0.12, 0.24, 0.035],
};
const CATS = {
  screw: { color: '#c79a1e', brand: 'Schraubwerk', icon: 'screw', bin: 0x2f6db5 },
  machine: { color: '#5f6b78', brand: 'Ferro', icon: 'screw', bin: 0x2f6db5 },
  dowel: { color: '#c2412d', brand: 'Fixomat', icon: 'bolt', bin: 0xb8322a },
  nut: { color: '#3a7d4f', brand: 'Ferro', icon: 'star', bin: 0xe0b020 },
  nail: { color: '#7a5a3a', brand: 'Nordhaus', icon: 'bolt', bin: 0x3a7d4f },
  tie: { color: '#1f2933', brand: 'Kabelfix', icon: 'box', bin: 0x6c737c },
  tape: { color: '#2b6cb0', brand: 'Tesso', icon: 'drop', bin: 0x6c737c },
  sand: { color: '#a0522d', brand: 'Schleifstar', icon: 'leaf', bin: 0x6c737c },
  batt: { color: '#1a1a1a', brand: 'Voltana', icon: 'bolt', bin: 0x6c737c },
  chem: { color: '#0f766e', brand: 'Bau-Profi', icon: 'drop', bin: 0x6c737c },
  tool: { color: '#b91c1c', brand: 'Krämer Profi', icon: 'star', bin: 0x2f6db5 },
  ppe: { color: '#ca8a04', brand: 'Safety+', icon: 'heart', bin: 0x2f6db5 },
};

function makeCatalog() {
  const rnd = RNG(1962);
  const skus = [];
  let art = 10000;
  const add = (regal, cat, name, pack, size, extra = {}) => {
    art += 3 + Math.floor(rnd() * 9);
    const s = { art: String(art), ean: makeEAN('4006', art), regal, cat, name, pack, size: PACK[size], sizeKey: size, stock: 5 + Math.floor(rnd() * 8), display: 'packs', ...extra };
    skus.push(s);
    return s;
  };
  // Regal A: Schrauben (50)
  const holz = ['3,0×16', '3,0×20', '3,0×25', '3,0×30', '3,5×20', '3,5×25', '3,5×30', '3,5×35', '3,5×40', '4,0×20', '4,0×25', '4,0×30', '4,0×35', '4,0×40', '4,0×45', '4,0×50', '4,0×60', '4,5×40', '4,5×45', '4,5×50', '4,5×60', '5,0×40', '5,0×50', '5,0×60', '5,0×70', '5,0×80', '6,0×60', '6,0×80', '6,0×100', '6,0×120'];
  holz.forEach(s => add('A', 'screw', `Holzschraube ${s} mm`, s.startsWith('6') ? '50 St.' : '100 St.', 'screw'));
  ['M4×16', 'M4×25', 'M5×20', 'M5×30', 'M6×16', 'M6×20', 'M6×30', 'M6×40', 'M8×20', 'M8×30', 'M8×40', 'M8×50', 'M10×30', 'M10×40', 'M10×60', 'M12×50', 'M12×80', 'M6×60', 'M8×80', 'M10×80']
    .forEach(s => add('A', 'machine', `Sechskantschraube ${s}`, '25 St.', 'screw'));
  // Regal B: Dübel, Muttern, Scheiben, Nägel, Kabelbinder (50)
  ['5', '6', '8', '10', '12', '14'].forEach(s => add('B', 'dowel', `Spreizdübel ${s} mm`, '50 St.', 'dowel'));
  ['6', '8', '10'].forEach(s => add('B', 'dowel', `Universaldübel ${s} mm`, '25 St.', 'dowel'));
  ['8', '10', '12'].forEach(s => add('B', 'dowel', `Hohlraumdübel M${s / 2 + 1}`, '10 St.', 'dowel'));
  ['M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12', 'M16'].forEach(s => add('B', 'nut', `Sechskantmutter ${s}`, '100 St.', 'nut'));
  ['M5', 'M6', 'M8', 'M10'].forEach(s => add('B', 'nut', `Sicherungsmutter ${s}`, '50 St.', 'nut'));
  ['3,2', '4,3', '5,3', '6,4', '8,4', '10,5', '13'].forEach(s => add('B', 'nut', `Unterlegscheibe ${s} mm`, '100 St.', 'nut'));
  ['1,4×25', '1,8×35', '2,0×40', '2,2×50', '2,8×60', '3,1×80', '3,4×90', '3,8×100'].forEach(s => add('B', 'nail', `Drahtstift ${s}`, '500 g', 'nail'));
  ['100×2,5 schwarz', '140×3,6 schwarz', '200×3,6 schwarz', '200×4,8 natur', '300×4,8 schwarz', '370×7,6 schwarz', '200×3,6 weiß', '140×3,6 natur', '290×3,6 schwarz', '160×4,8 schwarz', '450×7,6 schwarz']
    .forEach(s => add('B', 'tie', `Kabelbinder ${s}`, '100 St.', 'tie'));
  // Regal C: Werkzeug & Arbeitsschutz (50)
  const T = (name, model, size, packSize = 'tool') => add('C', 'tool', name, '1 St.', packSize, { display: 'tools', model, stock: 3 + Math.floor(rnd() * 4) });
  ['300 g', '500 g', '800 g', '1000 g'].forEach(s => T(`Schlosserhammer ${s}`, 'p_hammer', s, 'toolL'));
  ['40 mm', '55 mm', '70 mm'].forEach(s => T(`Gummihammer ${s}`, 'p_mallet', s, 'toolL'));
  ['160 mm', '180 mm', '200 mm'].forEach(s => T(`Kombizange ${s}`, 'p_pliers', s));
  ['6"', '8"', '10"', '12"'].forEach(s => T(`Rollgabelschlüssel ${s}`, 'p_wrench', s));
  ['PH0', 'PH1', 'PH2', 'PH3', 'PZ1', 'PZ2', 'Schlitz 4', 'Schlitz 5,5', 'Schlitz 6,5', 'Torx T20'].forEach(s => T(`Schraubendreher ${s}`, 'p_screwdriver', s));
  ['1/4"', '3/8"', '1/2"'].forEach(s => T(`Umschaltknarre ${s}`, 'p_ratchet', s));
  ['Standard', 'Profi'].forEach(s => T(`Klappmesser ${s}`, 'p_knife', s));
  ['5–25 Nm', '40–200 Nm'].forEach(s => T(`Drehmomentschlüssel ${s}`, 'p_torque_wrench', s, 'toolL'));
  ['Gr. 8', 'Gr. 9', 'Gr. 10', 'Gr. 11'].forEach(s => add('C', 'ppe', `Arbeitshandschuh Leder ${s}`, '1 Paar', 'glove', { display: 'tools', model: 'p_gloves', stock: 4 + Math.floor(rnd() * 5) }));
  ['weiß', 'gelb', 'blau'].forEach(s => add('C', 'ppe', `Schutzhelm ${s}`, '1 St.', 'toolL', { display: 'tools', model: 'p_helmet', stock: 2 + Math.floor(rnd() * 3) }));
  ['klein', 'groß'].forEach(s => add('C', 'tool', `Werkzeugkoffer leer ${s}`, '1 St.', 'toolL', { display: 'tools', model: 'p_toolcase', stock: 2 + Math.floor(rnd() * 3) }));
  T('Seitenschneider 160 mm', 'p_pliers', '', 'tool');
  T('Gripzange 250 mm', 'p_pliers', '', 'tool');
  ['Satz 6-tlg.', 'Satz 12-tlg.', 'Bit-Box 32-tlg.', 'Inbus-Satz 9-tlg.', 'Feilen-Set 5-tlg.', 'Meißel-Set 3-tlg.', 'Zangen-Set 3-tlg.', 'Körner-Set'].forEach(s => add('C', 'tool', `Werkzeug ${s}`, '1 Set', 'toolL', { display: 'packs' }));
  ['Steckdosenleiste 5-fach', 'Verlängerung 5 m', 'Glühlampe E27 60 W', 'LED-Lampe E27 9 W', 'LED-Lampe E14 5 W', 'Halogenlampe H7 12 V', 'Sicherung 16 A', 'Lüsterklemme 12-pol.', 'Schutzbrille klar', 'Gehörschutzstöpsel']
    .forEach(s => add('D', 'batt', s, s.includes('Stöpsel') ? '10 Paar' : '1 St.', s.includes('Leiste') || s.includes('Verl') ? 'cart' : 'glue'));
  ['K40', 'K60', 'K80', 'K100', 'K120', 'K150', 'K180', 'K240'].forEach(s => add('D', 'sand', `Schleifpapier ${s}`, '5 Bogen', 'sand'));
  ['Gewebeband silber 50 m', 'Gewebeband schwarz 25 m', 'Malerkrepp 19 mm', 'Malerkrepp 30 mm', 'Malerkrepp 50 mm', 'Isolierband rot', 'Isolierband blau', 'Isolierband schwarz', 'Doppelklebeband 5 m', 'Packband braun 66 m']
    .forEach(s => add('D', 'tape', s, '1 Rolle', 'tape'));
  ['Mignon AA', 'Micro AAA', 'Baby C', 'Mono D', 'Block 9 V', 'Knopfzelle CR2032'].forEach(s => add('D', 'batt', `Batterie ${s}`, s.includes('Knopf') ? '2 St.' : '4 St.', 'batt'));
  ['Silikon transparent', 'Silikon weiß', 'Acryl weiß', 'Bauschaum 750 ml', 'Montagekleber', 'Holzleim D3', 'Kriechöl Spray', 'Sprühkleber', 'Rostlöser', 'Teflonspray', 'Fugenmörtel grau', 'Spachtelmasse 1 kg', 'Silikonentferner', 'Fensterkitt', 'Dichtband 9 mm', 'Sekundenkleber']
    .forEach(s => add('D', 'chem', s, '1 St.', s.includes('Spray') || s.includes('Kriech') || s.includes('Rost') ? 'cart' : (s.includes('leim') || s.includes('Kleber') || s.includes('kitt') ? 'glue' : 'cart')));
  // auf exakt 50 je Regal auffüllen/kürzen
  const by = r => skus.filter(s => s.regal === r);
  for (const r of ['A', 'B', 'C', 'D']) {
    let list = by(r);
    while (list.length < 50) { const base = list[list.length - 1]; add(r, base.cat, base.name.replace(/\d+[,]?\d*/, m => String(Number(m.replace(',', '.')) + 1).replace('.', ',')), base.pack, base.sizeKey, { display: base.display, model: base.model }); list = by(r); }
    if (list.length > 50) list.slice(50).forEach(s => skus.splice(skus.indexOf(s), 1));
  }
  return skus;
}

// ------------------------------------------------------------------ Grafiken
function hardwarePack(s) {
  const c = makeCanvas(256, 352), g = c.getContext('2d');
  const cat = CATS[s.cat];
  g.fillStyle = '#f3efe6'; g.fillRect(0, 0, 256, 352);
  g.fillStyle = cat.color; g.fillRect(0, 0, 256, 92);
  g.fillStyle = shade(cat.color, -0.3); g.fillRect(0, 88, 256, 8);
  g.fillStyle = '#fff'; g.font = `900 30px ${FONT}`; g.textBaseline = 'top'; g.textAlign = 'left';
  g.fillText(cat.brand.toUpperCase(), 14, 14, 228);
  g.font = `600 17px ${FONT}`; g.fillText('Qualität seit 1962', 14, 54);
  g.fillStyle = '#16181b'; g.font = `800 27px ${FONT}`;
  const y = wrapText(g, s.name.replace(/ mm$/, ''), 14, 108, 228, 31);
  g.font = `600 22px ${FONT}`; g.fillStyle = '#4b5563'; g.fillText(s.pack, 14, y + 6);
  drawIcon(g, cat.icon, 198, 236, 30, cat.color);
  g.fillStyle = '#fff'; g.fillRect(14, 272, 160, 72);
  drawEAN(g, s.ean, 16, 276, 156, 64);
  g.fillStyle = '#16181b'; g.font = `500 14px ${MONO}`; g.fillText('Art. ' + s.art, 180, 324);
  return c;
}

function boxGeometryFrontUV() {
  // Einheitsbox: Vorderseite (+Z) zeigt den ganzen Zellinhalt, die übrigen Seiten nur einen Farbstreifen
  const g = new THREE.BoxGeometry(1, 1, 1);
  const uv = g.attributes.uv;
  for (let face = 0; face < 6; face++) {
    if (face === 4) continue;
    for (let i = 0; i < 4; i++) {
      const k = face * 4 + i;
      // rechter Rand des farbigen Kopfbereichs (ohne Schrift)
      uv.setXY(k, 0.955 + (uv.getX(k) * 0.035), 0.79 + uv.getY(k) * 0.17);
    }
  }
  // Rückseite (-Z, face 5): Barcode-Bereich
  for (let i = 0; i < 4; i++) { const k = 5 * 4 + i; uv.setXY(k, 0.06 + (i % 2) * 0.62, 0.05 + (i < 2 ? 0.2 : 0)); }
  return g;
}

// ------------------------------------------------------------------ Level
export default {
  async build(ctx, { onProgress } = {}) {
    const { engine, mat, assets, ui, audio, player, interaction, root, input } = ctx;
    const hand = interaction.hand;

    // ---------- Modelle laden
    const modelIds = ['p_hammer', 'p_mallet', 'p_pliers', 'p_wrench', 'p_screwdriver', 'p_ratchet', 'p_knife', 'p_torque_wrench', 'p_gloves', 'p_helmet', 'p_toolcase',
      'packing_table', 'work_table', 'monitor_office', 'ladder_step', 'hand_truck', 'extinguisher', 'trash_bin', 'first_aid', 'pallet', 'pallet_load_a', 'pallet_load_b', 'box_a', 'box_b', 'box_c', 'box_open', 'tote_blue', 'cart_angle_bins', 'sign_wet', 'lockers', 'label_printer'];
    await assets.preload(modelIds, (p, id) => onProgress && onProgress(p * 0.5, 'Modell: ' + id));

    // ---------- Halle
    const floorMat = mat.pbr('floor_old', { repeat: [HALL.w / 2.5, HALL.d / 2.5], ao: false, fallbackColor: 0x6b5a48, roughness: 1, metalness: 1, tag: 'l1floor' });
    const wallMat = mat.pbr('wall_brick_old', { repeat: [1, 1], fallbackColor: 0x8a4a35, metalness: 0, tag: 'l1wall' });
    const lowerMat = mat.pbr('wall_plaster', { repeat: [1, 1], color: 0x9aa59a, fallbackColor: 0x8f9a8f, metalness: 0 });
    const ceilMat = mat.pbr('wood_planks', { repeat: [HALL.w / 2, HALL.d / 2], color: 0xc2b097, fallbackColor: 0x7a6a5a, metalness: 0 });
    const hall = buildHall(ctx, {
      ...HALL, style: 'old', floor: floorMat, wall: wallMat, wallTile: 2.2, ceiling: ceilMat, wallLower: lowerMat, wallLowerH: 1.05,
      trussSpacing: 2.6, doors: [{ side: 's', at: 4.6, w: 2.4, h: 2.6 }],
    });

    // Fenster (Nord & Ost) – ohne Lichtkegel/Dunst
    const winGlow = 0.95;   // Außenansicht gut erkennbar, keine überstrahlte Fläche
    for (const x of [-4.4, -2.0, 1.6, 4.2]) {
      const wnd = windowMesh(ctx, { w: 1.5, h: 1.0, glow: winGlow, cols: 4, rows: 2 });
      wnd.position.set(x, 3.05, -HALL.d / 2 + 0.16);
      root.add(wnd);
    }
    for (const z of [-4.5, 3.0]) {
      const wnd = windowMesh(ctx, { w: 1.6, h: 1.2, glow: winGlow, cols: 4, rows: 2 });
      wnd.position.set(HALL.w / 2 - 0.16, 2.6, z); wnd.rotation.y = -Math.PI / 2;
      root.add(wnd);
    }
    // Tor (Holz-Schiebetor) an der Südwand
    const doorC = makeCanvas(512, 512), dg = doorC.getContext('2d');
    dg.fillStyle = '#5b3d27'; dg.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 512; i += 42) { dg.fillStyle = i % 84 ? '#654430' : '#563a26'; dg.fillRect(i, 0, 40, 512); }
    dg.strokeStyle = '#3a2618'; dg.lineWidth = 14; dg.beginPath(); dg.moveTo(0, 0); dg.lineTo(512, 512); dg.moveTo(512, 0); dg.lineTo(0, 512); dg.stroke();
    dg.strokeRect(7, 7, 498, 498);
    const door = signMesh(ctx, doorC, 2.4, 2.6);
    door.position.set(4.6, 1.3, HALL.d / 2 - 0.17); door.rotation.y = Math.PI;
    root.add(door);

    // ---------- Katalog & Atlanten
    const skus = makeCatalog();
    const packAtlas = new Atlas(ctx, { size: 2048, cellW: 112, cellH: 154 });
    const labelAtlas = new Atlas(ctx, { size: 2048, cellW: 256, cellH: 64 });
    for (const s of skus) if (s.display === 'packs' || s.display === 'tools') s.uv = packAtlas.add(hardwarePack(s));
    onProgress && onProgress(0.6, 'Regale einräumen …');

    // ---------- Regale
    const locations = [];
    const locByCode = new Map();
    const footprints = [];
    const binGeo = binGeometry(0.21, 0.125, 0.34);
    const binMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0 });
    ctx.track(binGeo); ctx.track(binMat);
    const binInst = new THREE.InstancedMesh(binGeo, binMat, 700);
    binInst.count = 0; binInst.castShadow = true; binInst.receiveShadow = true;
    const unitGeo = boxGeometryFrontUV(); ctx.track(unitGeo);
    const unitMat = atlasInstancedMaterial(packAtlas.texture, { roughness: 0.7 }); ctx.track(unitMat);
    const units = new AtlasInstances(unitGeo, unitMat, 2600);
    const sampleGroup = new THREE.Group(); sampleGroup.name = 'tool-samples';
    const samplePools = new Map();
    const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();

    let skuIdx = 0;
    const rowGroups = [];
    for (const R of REGALE) {
      const row = shelfRow(ctx, { x: R.x, z: ROW_Z, ry: R.ry, sections: SECTIONS, sectionW: SECTION_W, depth: DEPTH, height: SHELF_H, levels: LEVELS_Y, style: 'old', back: true });
      rowGroups.push(row);
      footprints.push({ ...row.footprint, s: 0.55, blur: 0.22 });
      const regalSkus = skus.filter(s => s.regal === R.id);
      // Sortierung: ähnliche Artikel nebeneinander (Fach für Fach, Ebene für Ebene)
      const labels = [];
      let k = 0;
      for (let fach = 1; fach <= SECTIONS; fach++) {
        for (let ebene = 1; ebene <= LEVELS_Y.length; ebene++) {
          const sectionIdx = R.ry > 0 ? fach : SECTIONS - fach + 1;   // Fach 01 immer vorne
          const slot = row.slots.find(s => s.section === sectionIdx && s.level === ebene);
          const sku = regalSkus[k++];
          if (!sku) continue;
          const code = `${R.id}-${String(fach).padStart(2, '0')}-${ebene}`;
          const loc = { code, regal: R.id, fach, ebene, slot, sku, stock: sku.stock, unitIdx: [], group: row.group };
          sku.loc = loc;
          locations.push(loc); locByCode.set(code, loc);
          labels.push({ local: slot.local, depth: DEPTH, uv: labelAtlas.add(locationLabel(code, { style: 'old', sub: `${sku.art}  ${sku.name}`.slice(0, 34), w: 512, h: 128 })), ww: 0.2, hh: 0.05 });
          skuIdx++;
        }
      }
      // Fachnummern-Schilder oben an jedem Fach
      for (let fach = 1; fach <= SECTIONS; fach++) {
        const sectionIdx = R.ry > 0 ? fach : SECTIONS - fach + 1;
        const slot = row.slots.find(s => s.section === sectionIdx && s.level === 1);
        const local = new THREE.Vector3(slot.local.x, SHELF_H - 0.035, 0);
        labels.push({ local, depth: DEPTH, uv: labelAtlas.add(fachPlate(`${R.id}-${String(fach).padStart(2, '0')}`)), ww: 0.2, hh: 0.05 });
      }
      labelStrips(ctx, row.group, labels, labelAtlas.texture, { yOff: -0.03, inset: 0.004 });
      // Stirnseiten-Schild mit Regalbuchstabe (zeigt zum Hauptgang)
      const end = signMesh(ctx, signCanvas(R.id, { bg: '#e9dcc0', fg: '#2a2017', w: 256, h: 256, font: MONO, radius: 10 }), 0.34, 0.34);
      end.position.set(R.x, 1.62, ROW_Z + (SECTIONS * SECTION_W) / 2 + 0.012);
      root.add(end);
    }
    // Inhalte der Lagerplätze
    const binLocal = [-0.245, 0, 0.245];
    for (const loc of locations) {
      const { slot, sku } = loc;
      const base = new THREE.Matrix4().makeRotationY(slot.ry).setPosition(slot.world);
      loc.base = base;
      const [pw, ph, pt] = sku.size;
      if (sku.display === 'packs') {
        const per = Math.max(1, Math.min(7, Math.floor(0.3 / (pt + 0.007))));
        const big = ph > 0.17;     // hohe Artikel: ohne Kästen direkt aufs Fachbrett
        const lanes = big ? Math.max(1, Math.floor(0.68 / (pw + 0.02))) : 3;
        if (!big) {
          for (const bx of binLocal) {
            tmpM.copy(base).multiply(new THREE.Matrix4().makeTranslation(bx, 0.005, 0.03));
            binInst.setMatrixAt(binInst.count, tmpM);
            binInst.setColorAt(binInst.count, new THREE.Color(CATS[sku.cat].bin));
            binInst.count++;
          }
        }
        const visible = Math.min(loc.stock, lanes * per);
        for (let i = 0; i < visible; i++) {
          const lane = i % lanes, d = Math.floor(i / lanes);
          const lx = big ? (lane - (lanes - 1) / 2) * (pw + 0.02) : binLocal[lane];
          const lz = big ? 0.17 - d * (pt + 0.01) : 0.16 - d * (pt + 0.007);
          tmpM.copy(base).multiply(new THREE.Matrix4().compose(tmpP.set(lx, ph / 2 + (big ? 0.002 : 0.01), lz), tmpQ.setFromEuler(new THREE.Euler(-0.05, 0, 0)), tmpS.set(pw, ph, pt)));
          loc.unitIdx.push(units.add(tmpM, sku.uv));
        }
        loc.lanes = lanes; loc.per = per; loc.big = big;
      } else {
        // Werkzeug: Kartons stehend + ein Ausstellungsstück liegend
        const [bw, bh, bt] = sku.size;
        const lanes = Math.max(1, Math.floor(0.42 / (bw + 0.015)));
        const visible = Math.min(loc.stock, lanes * 3);
        for (let i = 0; i < visible; i++) {
          const lane = i % lanes, d = Math.floor(i / lanes);
          const lx = -0.33 + lane * (bw + 0.015) + bw / 2;
          tmpM.copy(base).multiply(new THREE.Matrix4().compose(tmpP.set(lx, Math.min(bh, slot.clear - 0.02) / 2 + 0.002, 0.16 - d * (bt + 0.012)), tmpQ.identity(), tmpS.set(bw, Math.min(bh, slot.clear - 0.02), bt)));
          loc.unitIdx.push(units.add(tmpM, sku.uv));
        }
        // Ausstellungsstück
        const tpl = assets.templates.get(sku.model);
        if (tpl) {
          if (!samplePools.has(sku.model)) {
            const t2 = tpl.clone(true);
            layFlat(t2, 0.3);
            const holder = new THREE.Group(); holder.add(t2); groundCenter(t2);
            samplePools.set(sku.model, { pool: new ModelInstances(holder, 40), size: new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3()) });
          }
          const sp = samplePools.get(sku.model);
          if (sp.size.y < slot.clear) sp.pool.add(tmpM.copy(base).multiply(new THREE.Matrix4().makeTranslation(0.2, 0.004, 0.02).multiply(new THREE.Matrix4().makeRotationY(0.3))));
        }
      }
    }
    binInst.instanceMatrix.needsUpdate = true;
    if (binInst.instanceColor) binInst.instanceColor.needsUpdate = true;
    binInst.computeBoundingSphere();
    root.add(binInst);
    units.finish();
    root.add(units.mesh);
    for (const { pool } of samplePools.values()) { pool.finish(); sampleGroup.add(pool.group); }
    root.add(sampleGroup);
    // Ausstellungsstücke kosten viele Dreiecke → nur am PC mit hoher Grafik, ohne Schattenwurf
    sampleGroup.traverse(o => { if (o.isMesh) o.castShadow = false; });
    const onXR = () => { sampleGroup.visible = !engine.isXR && (engine.quality.key === 'high' || engine.quality.key === 'ultra'); };
    onXR();
    engine.addEventListener('xrstart', onXR); engine.addEventListener('xrend', onXR); engine.addEventListener('quality', onXR);

    // Trefferboxen der Lagerplätze
    for (const loc of locations) {
      const h = Math.min(loc.slot.clear - 0.02, 0.3);
      const hb = Interaction.hitBox(SECTION_W - 0.04, h, DEPTH - 0.02);
      hb.position.copy(loc.slot.local).add(new THREE.Vector3(0, h / 2 + 0.005, 0));
      loc.group.add(hb);
      loc.target = interaction.add({
        object: hb, kind: 'bin',
        label: () => `${loc.code} · ${loc.sku.name}`,
        sub: () => hand.empty ? `Art.-Nr. ${loc.sku.art} · ${loc.sku.pack}${player.attached ? ' · Klick: 1 Stück in den Wagen' : ''}` : (hand.sku === loc.sku.art ? `In der Hand: ${hand.count} – Rechtsklick legt zurück` : 'Hand voll – erst in den Wagen legen'),
        onPrimary: () => takeFrom(loc),
        onSecondary: () => putBack(loc),
      });
      // Regalrückseite blockiert Strahlen von hinten
    }
    for (const row of rowGroups) {
      const blocker = Interaction.hitBox(SECTIONS * SECTION_W, SHELF_H, 0.02);
      blocker.position.set(0, SHELF_H / 2, -DEPTH / 2 + 0.01);
      row.group.add(blocker);
      interaction.addBlocker(blocker);
    }

    // Gang-Schilder (hängend über dem Gangeingang)
    const aisles = [
      { x: -4.545, title: 'Gang 1', sub: '◀ A  Schrauben   ·   Dübel, Muttern  B ▶' },
      { x: -1.955, title: 'Gang 2', sub: '◀ C  Werkzeug   ·   Kleben, Elektro  D ▶' },
    ];
    for (const a of aisles) {
      const sc = signCanvas(a.title, { sub: a.sub, bg: '#2f3b33', fg: '#f2e6c9', w: 768, h: 256 });
      const s = signMesh(ctx, sc, 1.35, 0.45);
      s.position.set(a.x, 2.75, -0.05);
      root.add(s);
      for (const dx of [-0.6, 0.6]) {
        const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, HALL.h - 2.95, 4), mat.basic(0x333333, 0.6, 0.8));
        chain.position.set(a.x + dx, (HALL.h + 2.95) / 2, -0.05); root.add(chain);
      }
    }

    // ---------- Büro: Tisch, Drucker, Radio, Monitor (Tisch bündig an der Ostwand, Geräte mit Abstand nebeneinander)
    const deskSize = assets.size('work_table');           // Länge (x) liegt nach dem Drehen entlang z, Tiefe (z) entlang x
    const deskTop = deskSize.y;
    const D = SPOTS.printer;
    D.x = HALL.w / 2 - 0.15 - deskSize.z / 2 - 0.03;      // Hinterkante 3 cm vor der Wand
    const desk = assets.get('work_table', { fallbackSize: [1.6, 0.9, 0.8], color: 0x8a8f96 });
    desk.position.copy(D); desk.rotation.y = -Math.PI / 2;
    root.add(desk);
    player.addBoxCentered(D.x, D.z, deskSize.z, deskSize.x, 0, 'desk');
    footprints.push({ x: D.x, z: D.z, w: deskSize.z, d: deskSize.x, s: 0.4, blur: 0.25 });
    const deskBack = D.x + deskSize.z / 2;                // Tischkante an der Wand
    const deskLen = deskSize.x;                           // nutzbare Länge entlang z
    const deskTopAt = (x, z) => surfaceY(desk, x, z, 1.6) ?? deskTop;   // Geräte exakt auf die Tischplatte
    // Nadeldrucker: links (−z), Papierstapel nach hinten zur Wand
    const printer = makeDotMatrixPrinter(ctx);
    { const px = deskBack - 0.52, pz = D.z - deskLen / 2 + 0.36; printer.position.set(px, deskTopAt(px, pz), pz); }
    printer.rotation.y = -Math.PI / 2;
    root.add(printer);
    // Radio: Mitte hinten
    { const rx = deskBack - 0.16, rz = D.z - deskLen / 2 + 0.9; SPOTS.radio = new THREE.Vector3(rx, deskTopAt(rx, rz), rz); }
    // Monitor: rechts (+z)
    const monitor = assets.get('monitor_office', { fallbackSize: [0.55, 0.45, 0.2] });
    { const mx = deskBack - 0.28, mz = D.z + deskLen / 2 - 0.42; monitor.position.set(mx, deskTopAt(mx, mz), mz); }
    monitor.rotation.y = -Math.PI / 2 - 0.2;
    root.add(monitor);
    // Wanduhr & Kalender (Kalender neben dem Fenster, nicht darunter)
    root.add(makeClock(ctx, new THREE.Vector3(HALL.w / 2 - 0.17, 2.55, D.z), -Math.PI / 2));
    const cal = signMesh(ctx, calendarCanvas(), 0.42, 0.6);
    cal.position.set(HALL.w / 2 - 0.16, 1.7, D.z + 0.45); cal.rotation.y = -Math.PI / 2; root.add(cal);

    // ---------- Lagerplan-Tafel
    const plan = signMesh(ctx, planCanvas(), 1.5, 1.05);
    const planStand = new THREE.Group();
    plan.position.set(0, 1.55, 0.03); planStand.add(plan);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.15, 0.04), mat.basic(0x4a3a2a, 0.8, 0)); board.position.set(0, 1.55, 0); planStand.add(board);
    for (const x of [-0.7, 0.7]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.1, 0.05), mat.basic(0x3a2a1a, 0.8, 0)); leg.position.set(x, 1.05, -0.03); planStand.add(leg); }
    planStand.position.set(0.85, 0, 0.75); planStand.rotation.y = 0.35;
    planStand.traverse(o => { if (o.isMesh) o.castShadow = true; });
    root.add(planStand);
    player.addBoxCentered(0.85, 0.75, 1.5, 0.3, 0, 'plan');

    // ---------- Packtisch
    const pack = assets.get('packing_table', { fallbackSize: [1.8, 1.6, 0.9] });
    pack.position.copy(SPOTS.packing); pack.rotation.y = Math.PI;
    root.add(pack);
    const packSize = assets.size('packing_table');
    player.addBoxCentered(SPOTS.packing.x, SPOTS.packing.z, packSize.x, packSize.z, 0, 'packing');
    footprints.push({ x: SPOTS.packing.x, z: SPOTS.packing.z, w: packSize.x, d: packSize.z, s: 0.45, blur: 0.3 });
    pack.updateMatrixWorld(true);
    const packTopAt = (x, z) => surfaceY(pack, x, z, 1.2) ?? Math.min(0.93, packSize.y);
    const bell = makeBell(ctx);
    { const bx = SPOTS.packing.x - packSize.x * 0.3, bz = SPOTS.packing.z - packSize.z * 0.25; bell.position.set(bx, packTopAt(bx, bz), bz); }
    root.add(bell);
    const kontrolleSign = signMesh(ctx, signCanvas('Kontrolle & Versand', { bg: '#2f3b33', fg: '#f2e6c9', w: 768, h: 160 }), 1.4, 0.29);
    kontrolleSign.position.set(SPOTS.packing.x, 2.35, HALL.d / 2 - 0.17); kontrolleSign.rotation.y = Math.PI; root.add(kontrolleSign);

    // ---------- Wareneingang / Deko  [id, x, z, Drehung, y (Stapelhöhe; 0 = Boden)]
    // Kartons stehen ordentlich auf der Leerpalette (Höhe 0,21 m), Karton C obenauf – nichts steckt ineinander
    const deco = [
      ['pallet_load_a', 4.9, -6.9, 0], ['pallet_load_b', 4.85, -5.3, 0], ['pallet', 2.9, -7.1, 0],
      ['box_a', 2.66, -7.1, 0, 0.21], ['box_b', 3.27, -7.1, 0, 0.21], ['box_c', 2.66, -7.1, 0.12, 0.72],
      ['hand_truck', 1.6, -7.45, 0.3], ['ladder_step', -5.45, 0.55, 0], ['trash_bin', 5.45, 7.35, -Math.PI / 2], ['lockers', 5.55, 5.6, Math.PI],
      ['box_open', 4.3, 7.25, 0.1],
    ];
    const noShadow = new Set(['box_open', 'trash_bin', 'lockers', 'hand_truck', 'ladder_step']);
    for (const [id, x, z, ry, y = 0] of deco) {
      if (!assets.templates.get(id)) continue;
      const o = assets.get(id);
      o.position.set(x, y, z); o.rotation.y = ry;
      if (noShadow.has(id)) o.traverse(m => { if (m.isMesh) m.castShadow = false; });
      root.add(o);
      if (y > 0) continue;                               // gestapelte Teile: Palette darunter hat schon Kollision & Schatten
      const s = assets.size(id);
      const r = Math.max(s.x, s.z) / 2;
      player.addCircle(x, z, r * 0.85, id);
      footprints.push({ x, z, w: s.x * 0.9, d: s.z * 0.9, s: 0.4, blur: 0.25 });
    }
    if (assets.templates.get('extinguisher')) { const fe = assets.get('extinguisher'); fe.position.set(-1.0 + 0.35, 0, 0.55); fe.rotation.y = 0.4; root.add(fe); player.addCircle(-0.65, 0.55, 0.18); }
    if (assets.templates.get('first_aid')) { const fa = assets.get('first_aid'); fa.position.set(HALL.w / 2 - 0.25, 1.3, 6.6); fa.rotation.y = Math.PI; root.add(fa); }
    if (assets.templates.get('label_printer')) {
      const lp = assets.get('label_printer');
      const lx = SPOTS.packing.x + packSize.x * 0.32, lz = SPOTS.packing.z - 0.1;
      lp.position.set(lx, packTopAt(lx, lz), lz); lp.rotation.y = Math.PI; lp.scale.setScalar(0.8); root.add(lp);
    }

    decorateOld(ctx, { deskTop, footprints });

    // Bodenmarkierung (alter, abgenutzter Gelbstrich)
    floorLines(ctx, [
      { x1: -0.4, z1: 0.1, x2: 6, z2: 0.1, w: 0.08 }, { x1: -0.4, z1: 0.1, x2: -0.4, z2: -8, w: 0.08 },
      { x1: 1.2, z1: 6.0, x2: 4.0, z2: 6.0, w: 0.06 },
    ], { color: 0xb8962a, roughness: 0.8 });

    // ---------- Kommissionierwagen
    const cart = new THREE.Group(); cart.name = 'cart';
    const cartModel = assets.templates.get('cart_angle_bins') ? null : null;   // Winkelkasten-Wagen nur als Deko
    const cartBody = simpleCart(ctx, { w: 0.95, d: 0.58, h: 0.98, color: 0x2f5d8a });
    cartBody.rotation.y = -Math.PI / 2;   // Schiebebügel zum Spieler (+Z lokal)
    cart.add(cartBody);
    const tote = assets.templates.get('tote_blue') ? assets.get('tote_blue') : null;
    const toteTop = 0.63 + 0.01;
    if (tote) {
      const ts = assets.size('tote_blue');
      tote.scale.setScalar(Math.min(0.88 / Math.max(ts.x, ts.z), 1.6));
      tote.rotation.y = ts.x > ts.z ? Math.PI / 2 : 0;
      tote.position.set(0, toteTop, 0);
      cart.add(tote);
    }
    cart.position.copy(SPOTS.cart); cart.rotation.y = 0.2;
    root.add(cart);
    const cartHit = Interaction.hitBox(0.66, 0.6, 1.0);
    cartHit.position.set(0, 0.75, 0); cart.add(cartHit);
    let cartCollider = player.addCircle(cart.position.x, cart.position.z, 0.42, 'cart');
    const cartItems = [];   // {sku, mesh}
    const cartTarget = interaction.add({
      object: cartHit, kind: 'container', color: 0x34d399, priority: () => (hand.empty ? 0 : 2),
      label: 'Kommissionierwagen',
      sub: () => hand.empty ? (player.attached ? `angekoppelt · ${cartItems.length} Teile geladen` : 'Klicken oder F: ankoppeln') : `Klicken: ${hand.count} × ablegen`,
      onPrimary: () => { if (!hand.empty) putIntoCart(); else toggleCart(); },
      onSecondary: () => takeBackFromCart(),
      visibleCheck: () => !(player.attached && hand.empty),
    });

    function toggleCart() {
      if (player.attached) {
        player.detach();
        cartCollider = player.addCircle(cart.position.x, cart.position.z, 0.42, 'cart');
        audio.play('click');
        ui.toast('Wagen abgestellt', 'info', 1400);
      } else {
        const hp = engine.headPosition(new THREE.Vector3());
        if (Math.hypot(hp.x - cart.position.x, hp.z - cart.position.z) > 2.4) { ui.toast('Geh näher an den Wagen heran (F zum Ankoppeln).', 'warn'); return; }
        player.removeCollider(cartCollider);
        player.attach(cart, { offset: new THREE.Vector3(0.3, 0, -1.0), radius: 0.42 });
        audio.play('click');
        if (!state.cartHintDone) { state.cartHintDone = true; ui.toast('Wagen angekoppelt. Zum Picken abstellen (F) oder einfach mitnehmen.', 'ok', 3500); }
      }
      updateObjective();
    }
    input.addEventListener('cart', onCartKey);
    function onCartKey() { if (input.gameActive && !ui.panelOpen) toggleCart(); }

    // ---------- Ware nehmen / zurücklegen / in den Wagen
    const packMatCache = new Map();
    function makeUnitMesh(sku) {
      if (sku.display === 'tools' && assets.templates.get(sku.model)) return assets.get(sku.model);
      if (!packMatCache.has(sku.art)) {
        const t = packAtlas.texture.clone();
        t.repeat.set(sku.uv.w, sku.uv.h); t.offset.set(sku.uv.u, sku.uv.v); t.needsUpdate = true;
        ctx.track(t);
        const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }); ctx.track(m);
        packMatCache.set(sku.art, m);
      }
      const geo = boxGeometryFrontUV();
      ctx.track(geo);
      const mesh = new THREE.Mesh(geo, packMatCache.get(sku.art));
      mesh.scale.set(...sku.size);
      const g = new THREE.Group(); g.add(mesh);
      return g;
    }

    function takeFrom(loc) {
      if (!state.list) { ui.toast('Du hast noch keinen Auftrag. Drucke ihn am **Bürotisch** aus.', 'warn'); return; }
      const direct = player.attached && player.attached.object === cart && hand.empty;
      if (!direct && !hand.empty && hand.sku !== loc.sku.art) { ui.toast('Deine Hand ist voll. Lege die Ware erst in den Wagen (oder zurück).', 'warn'); audio.play('warn'); return; }
      if (loc.stock <= 0) { ui.toast(`Fach ${loc.code} ist **leer**! (Bestand lt. Karteikarte stimmt nicht)`, 'error', 4200); audio.play('error'); return; }
      loc.stock--;
      const vis = loc.unitIdx.filter(i => !units.hidden.has(i));
      let fromPos = loc.slot.world.clone().add(new THREE.Vector3(0, 0.08, 0));
      if (vis.length > loc.stock) { const idx = vis[vis.length - 1]; fromPos = new THREE.Vector3().setFromMatrixPosition(units.matrices[idx]); units.setVisible(idx, false); }
      ctx.currentMission && ctx.currentMission.pick(1);
      audio.play('pick');
      state.stats.picks++;
      if (direct) {
        // angekoppelter Wagen: Ware landet direkt im Wagen
        addToCart(loc.sku, fromPos);
        if (!state.directHint) { state.directHint = true; ui.toast('Wagen ist angekoppelt: Jeder Klick legt **1 Stück direkt in den Wagen**. Rechtsklick aufs Fach legt eins zurück.', 'info', 5000); }
      } else {
        hand.take(loc.sku.art, loc.sku.name, 1, () => makeUnitMesh(loc.sku), { skuObj: loc.sku, from: loc, handSize: loc.sku.display === 'tools' ? 0.26 : 0.14 });
      }
    }

    function putBack(loc) {
      if (hand.empty) {
        // aus dem angekoppelten Wagen zurück ins Fach
        const i = cartItems.map(c => c.sku).lastIndexOf(loc.sku);
        if (player.attached && i >= 0) {
          const [it] = cartItems.splice(i, 1);
          cart.remove(it.mesh);
          restock(loc);
          audio.play('put');
          return;
        }
        ui.toast(cartItems.some(c => c.sku === loc.sku) ? 'Koppel den Wagen an (F), um Ware zurückzulegen.' : 'Rechtsklick legt Ware zurück ins Fach – du hast nichts davon.', 'info', 2600);
        return;
      }
      if (hand.sku !== loc.sku.art) { ui.toast('Das gehört nicht in dieses Fach! Falsch eingelagerte Ware findet niemand wieder.', 'error', 3800); audio.play('error'); return; }
      hand.give(1);
      restock(loc);
      audio.play('put');
    }
    function restock(loc) {
      loc.stock++;
      const vis = loc.unitIdx.filter(i => !units.hidden.has(i)).length;
      const hiddenOnes = loc.unitIdx.filter(i => units.hidden.has(i));
      if (hiddenOnes.length && vis < loc.stock) units.setVisible(hiddenOnes[0], true);
    }

    // fliegende Ware (Fach → Wagen)
    const flights = [];
    function addToCart(sku, fromWorld) {
      const m = makeUnitMesh(sku);
      fitObject(m, sku.display === 'tools' ? 0.24 : 0.12);
      const holder = new THREE.Group(); holder.add(m);
      const target = cartSlotMatrix(cartItems.length);
      cart.updateMatrixWorld(true);
      const start = cart.worldToLocal(fromWorld.clone());
      holder.position.copy(start);
      holder.rotation.set(0, ((cartItems.length * 1.7) % 1) - 0.5, 0);
      cart.add(holder);
      cartItems.push({ sku, mesh: holder });
      flights.push({ obj: holder, start, target, t: 0 });
    }
    ctx.onUpdate(dt => {
      for (let i = flights.length - 1; i >= 0; i--) {
        const f = flights[i];
        f.t = Math.min(1, f.t + dt / 0.38);
        const k = 1 - Math.pow(1 - f.t, 3);
        f.obj.position.lerpVectors(f.start, f.target, k);
        f.obj.position.y += Math.sin(k * Math.PI) * 0.25;
        if (f.t >= 1) { flights.splice(i, 1); audio.play('put'); }
      }
    });

    function cartSlotMatrix(i) {
      // Raster im Behälter: 4 (längs) × 3 (quer), dann stapeln
      const col = i % 4, row = Math.floor(i / 4) % 3, layer = Math.floor(i / 12);
      return new THREE.Vector3(-0.15 + row * 0.15, toteTop + 0.05 + layer * 0.07, -0.3 + col * 0.2);
    }
    function putIntoCart() {
      const n = hand.count, it = hand.item;
      for (let i = 0; i < n; i++) {
        const m = makeUnitMesh(it.skuObj);
        fitObject(m, it.skuObj.display === 'tools' ? 0.24 : 0.12);
        const holder = new THREE.Group(); holder.add(m);
        holder.position.copy(cartSlotMatrix(cartItems.length));
        holder.rotation.set(0, ((cartItems.length * 1.7) % 1) - 0.5, 0);
        cart.add(holder);
        cartItems.push({ sku: it.skuObj, mesh: holder });
      }
      hand.give(n);
      audio.play('put');
    }
    function takeBackFromCart() {
      if (!cartItems.length) return;
      const last = cartItems[cartItems.length - 1];
      if (!hand.empty && hand.sku !== last.sku.art) { ui.toast('Hand ist voll.', 'warn'); return; }
      cartItems.pop();
      cart.remove(last.mesh);
      hand.take(last.sku.art, last.sku.name, 1, () => makeUnitMesh(last.sku), { skuObj: last.sku, handSize: last.sku.display === 'tools' ? 0.26 : 0.14 });
      audio.play('pick');
    }

    // ---------- Aufträge
    const rndO = RNG(4711);
    const pickLoc = (filter) => { const c = locations.filter(filter); return c[Math.floor(rndO() * c.length)]; };
    function makeOrder(no, customer, specs) {
      return { no, customer, lines: specs.map(([loc, qty], i) => ({ pos: i + 1, loc, sku: loc.sku, qty })) };
    }
    // Auftrag 1: 5 Positionen, nach Lagerplatz sortiert; eine Verwechslungsgefahr (Nachbarfach mit ähnlichem Artikel)
    const o1 = makeOrder('A-24-0317', 'Hausmeisterservice Becker', [
      [locByCode.get('A-03-4'), 2], [locByCode.get('B-02-2'), 3], [locByCode.get('B-07-5'), 1], [locByCode.get('C-04-3'), 1], [locByCode.get('D-06-2'), 4],
    ]);
    // Auftrag 2: 7 Positionen; Standarddruck nach Artikelnummer (Zickzack-Wege). Eine Position mit Fehlbestand.
    const o2specs = [
      [locByCode.get('D-02-4'), 2], [locByCode.get('A-08-2'), 3], [locByCode.get('C-09-1'), 1], [locByCode.get('B-04-4'), 2],
      [locByCode.get('A-01-3'), 1], [locByCode.get('D-09-3'), 2], [locByCode.get('C-02-5'), 2],
    ];
    const o2 = makeOrder('WEB-10457', 'Online-Shop: Fam. Schneider', o2specs);
    const shortLine = o2.lines[3];
    shortLine.loc.stock = 1;          // Fehlbestand: Karteikarte sagt mehr, tatsächlich nur 1 Stück da
    shortLine.loc.unitIdx.forEach((u, i) => { if (i >= 1) units.setVisible(u, false); });
    const orders = [o1, o2];

    // ---------- Zustand
    const state = {
      orderIdx: 0, list: null, ticks: new Set(), printed: [false, false], sortedPrint: null, results: [],
      stats: { picks: 0 }, cartHintDone: false, orderStartDist: 0, orderStartTime: 0,
    };

    // ---------- Pickliste (Endlospapier, Nadeldrucker)
    ui.device.resize(600, 900);
    function drawList() {
      const c = ui.device.canvas, g = ui.device.ctx, W = c.width, H = c.height;
      g.clearRect(0, 0, W, H);
      g.fillStyle = '#f7f4ea'; g.fillRect(0, 0, W, H);
      // grüne Streifen
      for (let y = 150; y < H - 120; y += 76) { g.fillStyle = 'rgba(132,190,140,0.18)'; g.fillRect(34, y, W - 68, 38); }
      // Lochrand
      g.fillStyle = '#e7e2d2'; g.fillRect(0, 0, 30, H); g.fillRect(W - 30, 0, 30, H);
      g.fillStyle = '#cfc8b4';
      for (let y = 14; y < H; y += 30) { g.beginPath(); g.arc(15, y, 6, 0, 7); g.fill(); g.beginPath(); g.arc(W - 15, y, 6, 0, 7); g.fill(); }
      if (!state.list) {
        g.fillStyle = '#6b6457'; g.font = `600 26px ${MONO}`; g.textAlign = 'center';
        g.fillText('(noch kein Auftrag gedruckt)', W / 2, H / 2);
        ui.device.update();
        return;
      }
      const o = state.list;
      const ink = '#2a2a33';
      g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      g.fillStyle = ink; g.font = `700 23px ${MONO}`;
      g.fillText('EISENWAREN KRÄMER  -  LAGER', 46, 50);
      g.font = `500 19px ${MONO}`;
      g.fillText(`KOMMISSIONIERSCHEIN   ${o.no}`, 46, 80);
      g.fillText(`KUNDE: ${o.customer}`.slice(0, 44), 46, 106);
      g.fillText(`DATUM: ${new Date().toLocaleDateString('de-DE')}   SORT: ${o.sorted ? 'LAGERPLATZ' : 'ART.-NR.'}`, 46, 130);
      g.fillRect(46, 140, W - 92, 2);
      g.font = `700 17px ${MONO}`;
      g.fillText('POS PLATZ    ART-NR  BEZEICHNUNG         MENGE', 46, 168);
      let y = 210;
      o.view.forEach((ln, i) => {
        g.font = `600 19px ${MONO}`; g.fillStyle = ink;
        g.fillText(`${String(i + 1).padStart(2, ' ')}  ${ln.loc.code}  ${ln.sku.art}`, 46, y);
        g.font = `500 17px ${MONO}`;
        const name = ln.sku.name.length > 24 ? ln.sku.name.slice(0, 23) + '.' : ln.sku.name;
        g.fillText(name, 46 + 26 * 11.2, y);
        g.font = `800 24px ${MONO}`;
        g.fillText(String(ln.qty), W - 92, y + 1);
        g.font = `500 15px ${MONO}`; g.fillStyle = '#666';
        g.fillText(ln.sku.pack, 46 + 26 * 11.2, y + 22);
        // Häkchen (Bleistift)
        g.strokeStyle = '#3b3f8f'; g.lineWidth = 2;
        g.strokeRect(W - 60, y - 22, 26, 26);
        if (state.ticks.has(i)) {
          g.strokeStyle = '#1f3fbf'; g.lineWidth = 4; g.lineCap = 'round';
          g.beginPath(); g.moveTo(W - 58, y - 10); g.lineTo(W - 49, y + 1); g.lineTo(W - 30, y - 30); g.stroke();
        }
        y += 76;
      });
      g.fillStyle = ink; g.font = `500 17px ${MONO}`;
      g.fillText(`SUMME POSITIONEN: ${o.view.length}`, 46, H - 110);
      g.fillText('KOMMISSIONIERT: ________  KONTR.: ______', 46, H - 76);
      g.font = `500 14px ${MONO}`; g.fillStyle = '#777';
      g.fillText('Zum Abhaken: Tasten 1-9 (VR: auf Zeile zeigen)', 46, H - 40);
      ui.device.update();
    }

    // VR: Klemmbrett in der linken Hand
    const clip = new THREE.Group(); clip.name = 'clipboard';
    const boardM = new THREE.Mesh(new THREE.BoxGeometry(0.235, 0.33, 0.006), mat.basic(0x7a5a3a, 0.8, 0));
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.315), new THREE.MeshStandardMaterial({ map: ui.device.texture, roughness: 0.9, emissive: 0xffffff, emissiveMap: ui.device.texture, emissiveIntensity: 0.35 }));
    paper.position.z = 0.0035;
    const clipM = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.02), mat.basic(0xb0b4b8, 0.3, 0.9)); clipM.position.set(0, 0.16, 0.008);
    clip.add(boardM, paper, clipM);
    clip.visible = false;
    clip.userData.noEnvCapture = true;
    const placeClip = () => {
      const c = input.controller('left');
      if (engine.isXR && c) { c.grip.add(clip); clip.position.set(0.0, 0.07, -0.06); clip.rotation.set(-1.05, 0, 0); }
      else if (clip.parent) clip.parent.remove(clip);
      clip.visible = engine.isXR && !!state.list && state.listVisible !== false;
    };
    engine.addEventListener('xrstart', placeClip); engine.addEventListener('xrend', placeClip); input.addEventListener('controllerconnected', placeClip);
    interaction.add({
      object: paper, kind: 'paper', highlight: false, maxDistXR: 0.9, maxDist: 0.01,
      label: 'Pickliste', sub: 'Zeile antippen = abhaken',
      visibleCheck: () => engine.isXR && clip.visible,
      onPrimary: (e, hit) => {
        if (!hit || !hit.uv || !state.list) return;
        const y = (1 - hit.uv.y) * 900;
        const i = Math.floor((y - 210 + 50) / 76);
        if (i >= 0 && i < state.list.view.length) toggleTick(i);
      },
    });
    input.addEventListener('device', onDeviceKey);
    function onDeviceKey() {
      if (!input.gameActive) return;
      if (engine.isXR) { state.listVisible = state.listVisible === false; placeClip(); }
      else ui.device.toggleBig();
    }
    input.addEventListener('number', onNumber);
    function onNumber(e) { if (input.gameActive && state.list && e.value >= 1 && e.value <= state.list.view.length) toggleTick(e.value - 1); }
    function toggleTick(i) {
      if (state.ticks.has(i)) state.ticks.delete(i); else state.ticks.add(i);
      audio.play('paper');
      drawList();
    }

    // ---------- Drucker
    const printerHit = Interaction.hitBox(0.6, 0.35, 0.55);
    printerHit.position.set(0, 0.17, 0); printer.add(printerHit);
    interaction.add({
      object: printerHit, kind: 'button', color: 0x2dd4bf,
      label: 'Auftragsdrucker',
      sub: () => state.list ? 'Auftrag ist schon gedruckt' : `Klicken: Auftrag ${state.orderIdx + 1} drucken`,
      onPrimary: () => printOrder(),
    });
    async function printOrder() {
      if (state.list) { ui.toast('Der aktuelle Auftrag ist bereits gedruckt.', 'info'); return; }
      if (state.orderIdx >= orders.length) return;
      const o = orders[state.orderIdx];
      let sorted = state.orderIdx === 0;
      if (state.orderIdx === 1) {
        const m = ctx.currentMission; m && m.pause();
        const v = await ui.showPanel({
          title: 'Auftrag 2 drucken',
          blocks: [
            { p: 'Der Online-Shop hat eine Bestellung mit **7 Positionen** geschickt. Wie soll die Pickliste gedruckt werden?' },
            { options: [{ text: '**Standard:** sortiert nach Artikelnummer (so kommt sie aus dem System)', value: 'std' }, { text: '**Optimiert:** sortiert nach Lagerplatz – Regal für Regal, Fach für Fach (kürzerer Laufweg)', value: 'opt' }] },
          ],
          buttons: [],
        });
        m && m.resume();
        sorted = v === 'opt';
        state.sortedPrint = sorted;
      }
      const view = o.lines.slice();
      if (sorted) view.sort((a, b) => routeKey(a.loc) - routeKey(b.loc)); else view.sort((a, b) => Number(a.sku.art) - Number(b.sku.art));
      o.view = view; o.sorted = sorted;
      audio.play('printer', { position: printer.getWorldPosition(new THREE.Vector3()) });
      animatePaper();
      await wait(1100);
      state.list = o;
      state.ticks = new Set();
      state.listVisible = true;
      state.orderStartDist = player.distance; state.orderStartTime = ctx.currentMission ? ctx.currentMission.elapsed : 0;
      drawList();
      ui.device.show(true);
      ui.device.setCaption(`Pickliste ${o.no} · <kbd>Tab</kbd> groß/klein · <kbd>1</kbd>–<kbd>${o.view.length}</kbd> abhaken`);
      placeClip();
      ui.toast(`Auftrag ${state.orderIdx + 1} gedruckt: **${o.lines.length} Positionen**. Hol den Wagen und los!`, 'ok', 3600);
      updateObjective();
    }
    // Schleifen-Strategie: Gang 1 (A,B) hinein, Gang 2 (C,D) zurück
    function routeKey(loc) {
      const aisle = loc.regal === 'A' || loc.regal === 'B' ? 0 : 1;
      const f = aisle === 0 ? loc.fach : (SECTIONS + 1 - loc.fach);
      return aisle * 100 + f * 2 + (loc.regal === 'A' || loc.regal === 'C' ? 0 : 1);
    }
    let paperAnim = null;
    function animatePaper() {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.3), new THREE.MeshStandardMaterial({ color: 0xf3f0e4, roughness: 0.95, side: THREE.DoubleSide }));
      ctx.track(p.geometry); ctx.track(p.material);
      p.position.set(0, 0.2, -0.02); p.rotation.x = -0.4; p.scale.y = 0.01;
      printer.add(p);
      let t = 0;
      paperAnim = dt => { t += dt; p.scale.y = Math.min(1, t / 1.0); p.position.y = 0.2 + p.scale.y * 0.13; if (t > 1.3) { printer.remove(p); paperAnim = null; } };
    }

    // ---------- Packtisch / Kontrolle
    const packHit = Interaction.hitBox(packSize.x * 0.9, 0.5, packSize.z * 0.9);
    packHit.position.set(SPOTS.packing.x, Math.min(0.95, packSize.y) - 0.1, SPOTS.packing.z);
    root.add(packHit);
    interaction.add({
      object: packHit, kind: 'button', color: 0x2dd4bf, maxDist: 3,
      label: 'Packtisch · Kontrolle',
      sub: () => !state.list ? 'Erst einen Auftrag drucken' : (cartNear() ? 'Klicken: Auftrag fertig melden' : 'Bring den Wagen hierher'),
      onPrimary: () => finishOrder(),
    });
    function cartNear() { return cart.position.distanceTo(SPOTS.packing) < 3.6; }
    async function finishOrder() {
      if (!state.list) { ui.toast('Erst am Bürotisch einen Auftrag drucken.', 'warn'); return; }
      if (!hand.empty) { ui.toast('Lege zuerst die Ware aus deiner Hand in den Wagen.', 'warn'); return; }
      if (!cartNear()) { ui.toast('Der Wagen steht zu weit weg. Bring ihn an den Packtisch.', 'warn'); return; }
      const o = state.list;
      audio.play('button');
      // Soll/Ist-Vergleich
      const counts = new Map();
      for (const ci of cartItems) counts.set(ci.sku.art, (counts.get(ci.sku.art) || 0) + 1);
      const rows = []; let errs = 0; const errList = [];
      const m = ctx.currentMission;
      for (const ln of o.lines) {
        const ist = counts.get(ln.sku.art) || 0;
        counts.delete(ln.sku.art);
        let st;
        if (ist === ln.qty) st = { t: 'korrekt', cls: 'st-ok' };
        else if (ln === shortLine && ist === 1 && ln.loc.stock === 0) st = { t: 'Fehlbestand (kein Pickfehler)', cls: 'st-warn' };
        else if (ist === 0) { st = { t: 'fehlt', cls: 'st-err' }; errs++; m && m.error('missing', `${ln.loc.code} ${ln.sku.name}`, { silent: true }); }
        else { st = { t: `Menge falsch (${ist})`, cls: 'st-err' }; errs++; m && m.error('wrong_qty', `${ln.loc.code} ${ln.sku.name}: ${ist} statt ${ln.qty}`, { silent: true }); }
        rows.push([ln.loc.code, ln.sku.name, String(ln.qty), String(ist), st]);
        if (st.cls !== 'st-err') m && m.line(1);
      }
      for (const [art, n] of counts) {
        const sku = skus.find(s => s.art === art);
        rows.push([sku.loc.code, sku.name, '0', String(n), { t: 'nicht bestellt', cls: 'st-err' }]);
        errs++; m && m.error('wrong_item', `${sku.loc.code} ${sku.name}`, { silent: true });
      }
      const dist = player.distance - state.orderStartDist;
      const time = (m ? m.elapsed : 0) - state.orderStartTime;
      state.results.push({ no: o.no, lines: o.lines.length, errs, dist, time, sorted: o.sorted });
      audio.play(errs ? 'error' : 'ok');
      // Wagen leeren
      for (const ci of cartItems) cart.remove(ci.mesh);
      cartItems.length = 0;
      state.list = null; ui.device.show(false); placeClip();
      state.orderIdx++;
      if (m) m.pause();
      await ui.showPanel({
        title: errs ? `Kontrolle: ${errs} Fehler gefunden` : 'Kontrolle: alles korrekt!',
        subtitle: `Auftrag ${o.no} · ${o.customer}`,
        blocks: [
          { table: { head: ['Platz', 'Artikel', 'Soll', 'Ist', 'Ergebnis'], rows } },
          { kpis: [{ v: fmtTime(time), l: 'Zeit für den Auftrag' }, { v: fmtNum(dist) + ' m', l: 'Laufweg' }, { v: errs, l: 'Fehler', color: errs ? '#f87171' : '#34d399' }] },
          errs ? { callout: 'Ohne Scanner fallen Fehler erst hier bei der **Kontrolle** auf – oder schlimmer: erst beim Kunden. Jede Reklamation kostet Geld (Rücksendung, Neuversand, Ärger).' }
            : { callout: 'Sauber gearbeitet! Bei Pick-by-Paper hängt die Qualität ganz an deiner Sorgfalt – es gibt keine automatische Prüfung.', tone: 'teal' },
          ...(rows.some(r => r[4].cls === 'st-warn') ? [{ p: '**Fehlbestand:** Laut Karteikarte war genug Ware da – tatsächlich lag nur 1 Stück im Fach. Ohne Echtzeit-Bestandsführung fallen solche **Bestandsdifferenzen** erst beim Picken (oder bei der Inventur) auf.' }] : []),
        ],
        buttons: [{ label: state.orderIdx < orders.length ? 'Weiter zu Auftrag 2' : 'Zur Auswertung', value: 'ok', primary: true }],
      });
      if (m) m.resume();
      if (state.orderIdx >= orders.length) finishMission();
      else { ui.toast('Neuer Auftrag liegt im Drucker bereit.', 'info'); updateObjective(); }
    }

    function finishMission() {
      const m = ctx.currentMission;
      const r = m.finish();
      const [r1, r2] = state.results;
      const blocks = [
        { h: 'Deine Aufträge' },
        { table: { head: ['Auftrag', 'Positionen', 'Zeit', 'Laufweg', 'Fehler'], rows: state.results.map(x => [x.no + (x.sorted ? ' (sortiert)' : x === r1 ? '' : ' (unsortiert)'), String(x.lines), fmtTime(x.time), fmtNum(x.dist) + ' m', { t: String(x.errs), cls: x.errs ? 'st-err' : 'st-ok' }]) } },
      ];
      if (r2) {
        const perLine1 = r1.dist / r1.lines, perLine2 = r2.dist / r2.lines;
        blocks.push({ p: `Laufweg pro Position: **${fmtNum(perLine1, 1)} m** (Auftrag 1) vs. **${fmtNum(perLine2, 1)} m** (Auftrag 2, ${r2.sorted ? 'nach Lagerplatz sortiert' : 'nach Artikelnummer sortiert'}).` });
        blocks.push({ callout: r2.sorted ? 'Du hast die Liste **nach Lagerplatz sortiert** drucken lassen – so läufst du jeden Gang nur einmal ab (**Schleifenstrategie**). Wegoptimierung ist der größte Hebel in Mann-zur-Ware-Lagern.' : 'Die Liste war **nach Artikelnummer** sortiert – dadurch läufst du kreuz und quer durchs Lager. Eine nach Lagerplatz sortierte Liste (**Wegoptimierung**, z. B. Schleifenstrategie) spart viel Zeit.' });
      }
      ctx.complete(r, {
        blocks,
        lesson: `In diesem Lager entfiel etwa **${fmtNum(r.walkShare * 100)} %** deiner Zeit aufs **Gehen**. Typisch für Mann-zur-Ware: Die Wegzeit ist der größte Anteil der Kommissionierzeit – deshalb setzen moderne Lager auf Wegoptimierung oder gleich auf Ware-zur-Person.`,
      });
    }

    // ---------- Ziele / HUD
    function updateObjective() {
      let t;
      if (state.orderIdx >= orders.length) t = 'Alle Aufträge erledigt!';
      else if (!state.list) t = `Geh zum **Bürotisch** (rechts, mit Drucker) und drucke **Auftrag ${state.orderIdx + 1}** aus.`;
      else if (!player.attached && !cartItems.length) t = 'Hol den **Kommissionierwagen** (Taste **F** zum Ankoppeln) und arbeite die Liste ab.';
      else t = `Kommissioniere alle **${state.list.lines.length} Positionen**. Lagerplatz = **Regal-Fach-Ebene**. Danach zum **Packtisch** (vorne).`;
      ui.setObjective(t);
    }
    player.addEventListener('attach', updateObjective);
    player.addEventListener('detach', updateObjective);
    ctx.onUpdate(dt => {
      if (paperAnim) paperAnim(dt);
      const m = ctx.currentMission;
      if (m && m.running) {
        ui.setStats([
          { label: 'Zeit', value: fmtTime(m.elapsed) },
          { label: 'Auftrag', value: `${Math.min(state.orderIdx + 1, orders.length)}/${orders.length}` },
          { label: 'Laufweg', value: fmtNum(player.distance) + ' m' },
        ]);
      }
    });

    // flackernde Röhre
    const flick = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.035, 0.06), new THREE.MeshStandardMaterial({ color: 0, emissive: 0xfff2dc, emissiveIntensity: 5 }));
    flick.position.set(-1.92, 3.62, -6.6); flick.rotation.y = Math.PI / 2;
    root.add(flick);
    let fl = 0;
    ctx.onUpdate((dt, t) => { fl -= dt; if (fl < 0) { fl = Math.random() < 0.08 ? 0.05 : 0.12 + Math.random() * 0.6; flick.material.emissiveIntensity = Math.random() < 0.25 ? 0.2 : 5; } });

    // ---------- Licht
    const fixtures = [];
    for (const x of [-4.4, -1.9]) for (let z = -7; z <= -0.5; z += 1.95) fixtures.push({ x, z, ry: Math.PI / 2 });
    for (let x = 0.6; x <= 5.2; x += 2.3) for (let z = -6.5; z <= 6.8; z += 2.6) fixtures.push({ x, z, ry: 0 });
    for (let x = -5; x <= 0; x += 2.4) fixtures.push({ x, z: 2.2, ry: 0 }, { x, z: 5.4, ry: 0 });
    const L = setupLighting(ctx, {
      sky: 0xffe9cc, ground: 0x8a7258, hemi: 0.5, key: 2.2, keyColor: 0xfff0d8, keyDir: [0.35, 1, -0.65], exposure: 1.45,
      fixtures, fixtureKind: 'tube', fixtureHeight: 3.62, ceilingY: HALL.h, lampColor: 0xfff2dc, lampIntensity: 5,
      points: [{ x: SPOTS.printer.x - 0.6, y: 2.0, z: SPOTS.printer.z, intensity: 5, distance: 6, color: 0xffd9a0 }, { x: SPOTS.packing.x, y: 2.2, z: SPOTS.packing.z - 0.6, intensity: 5, distance: 6, color: 0xffe6bf }],
      background: 0x1a140f, shadowExtent: 11,
    });

    // Boden-AO + Staub
    bakeFloorAO(ctx, hall.floor, HALL.w, HALL.d, footprints, { edge: 0.6, edgeStrength: 0.45 });
    dust(ctx, { minX: -6, maxX: 6, minZ: -8, maxZ: 8, minY: 0.3, maxY: 3.8, count: 320, opacity: 0.28, size: 0.014 });

    // ---------- Infopunkte
    const info = (x, y, z, card) => ctx.addInfoPoint(new THREE.Vector3(x, y, z), card);
    info(0.85, 2.35, 0.95, {
      title: 'Die Lagerplatzadresse', subtitle: 'So findest du jeden Artikel',
      blocks: [
        { p: 'Jeder Lagerplatz hat eine eindeutige **Adresse**. Bei Krämer besteht sie aus drei Teilen:' },
        { list: ['**Regal** (Buchstabe A–D)', '**Fach** (Spalte 01–10, gezählt vom Hauptgang aus)', '**Ebene** (1 = unten, 5 = oben)'] },
        { callout: '**B-04-3** bedeutet also: Regal B, viertes Fach vom Hauptgang aus, dritte Ebene von unten.' },
        { p: 'Ohne Adresssystem müsstest du dir merken, wo was liegt – das klappt nur, solange du schon lange da bist. Mit Adressen findet sich auch eine Aushilfe am ersten Tag zurecht.' },
      ],
    });
    info(-4.6, 2.35, 0.2, {
      title: 'Fachbodenregal', subtitle: 'Das Standardregal für Kleinteile',
      blocks: [
        { p: '**Fachbodenregale** haben mehrere Böden übereinander. Sie eignen sich für kleine, leichte Artikel, die **von Hand** entnommen werden – Schrauben, Werkzeug, Ersatzteile.' },
        { list: ['**Vorteile:** günstig, flexibel, jeder Artikel direkt greifbar', '**Nachteile:** viel Lauferei, Platzbedarf durch Gänge, begrenzte Höhe'] },
        { callout: '**Ergonomie:** Am besten greift man zwischen Hüft- und Schulterhöhe („goldene Zone“). Schnelldreher gehören dorthin – selten gebrauchte Artikel nach ganz oben oder unten.', tone: 'teal' },
      ],
    });
    info(SPOTS.printer.x - 0.7, 1.55, SPOTS.printer.z - 0.75, {
      title: 'Pick-by-Paper', subtitle: 'Kommissionieren mit Papierliste',
      blocks: [
        { p: 'Bei **Pick-by-Paper** druckt das System (oder der Chef) eine **Pickliste**. Der Picker sucht die Plätze, entnimmt die Menge und hakt die Zeile ab.' },
        { list: ['**+** keine Technik nötig, sofort einsetzbar', '**–** Hände nicht frei, Liste geht verloren oder wird verwechselt', '**–** keine Prüfung: falscher Artikel fällt erst bei der Kontrolle auf', '**–** Bestände werden nicht in Echtzeit gebucht'] },
        { callout: 'Typische Fehlerquote bei Papierlisten: deutlich höher als mit Scanner, Licht oder Sprachsteuerung.' },
      ],
    });
    info(SPOTS.cart.x, 1.4, SPOTS.cart.z, {
      title: 'Mann-zur-Ware', subtitle: 'Statische Bereitstellung',
      blocks: [
        { p: 'Die Ware bleibt im Regal liegen – **du gehst zur Ware**. Das nennt man **Mann-zur-Ware** (oder statische Bereitstellung).' },
        { p: 'Die **Kommissionierzeit** setzt sich zusammen aus:' },
        { list: ['**Basiszeit** – Auftrag holen, Wagen vorbereiten, abgeben', '**Wegzeit** – Gehen zwischen den Plätzen (oft der größte Anteil!)', '**Greifzeit** – Entnehmen und Ablegen', '**Totzeit** – Suchen, Lesen, Prüfen'] },
        { callout: 'Weil die Wegzeit so groß ist, lohnt sich alles, was Wege spart: Schnelldreher nach vorne, sortierte Listen, mehrere Aufträge auf einmal.', tone: 'teal' },
      ],
    });
    info(SPOTS.packing.x + 0.9, 1.6, SPOTS.packing.z - 0.6, {
      title: 'Kontrolle & Versand', subtitle: 'Das Vier-Augen-Prinzip',
      blocks: [
        { p: 'Am Packtisch wird jeder Auftrag noch einmal **kontrolliert**, bevor er verpackt und versendet wird.' },
        { p: 'Jeder Fehler, der zum Kunden geht, kostet: Retoure, Neuversand, Bearbeitung – und Kundenzufriedenheit. Im Online-Handel ist das besonders teuer.' },
        { callout: 'Faustregel: Je später ein Fehler entdeckt wird, desto teurer wird er.' },
      ],
    });
    info(-2.0, 2.35, -7.4, {
      title: 'Festplatzsystem', subtitle: 'Jeder Artikel hat seinen festen Platz',
      blocks: [
        { p: 'Bei Krämer hat jeder Artikel **immer denselben Lagerplatz** – das ist das **Festplatzsystem**.' },
        { list: ['**+** Mitarbeiter kennen die Plätze auswendig, auch ohne Computer', '**–** Plätze bleiben leer, wenn ein Artikel ausverkauft ist (Platzverschwendung)', '**Gegenteil:** Freiplatzsystem / **chaotische Lagerhaltung** – die Ware kommt dahin, wo gerade Platz ist. Das funktioniert nur mit einem Lagerverwaltungssystem (LVS).'] },
      ],
    });

    drawList();
    updateObjective();
    onProgress && onProgress(1, 'fertig');

    const mission = ctx.mission({ targetTime: 540, expectedLines: 12 });
    return {
      spawn: SPOTS.spawn,
      hints: [['WASD', 'gehen'], ['Klick', 'nehmen / ablegen'], ['Rechtsklick', 'zurücklegen'], ['F', 'Wagen'], ['1–9', 'abhaken'], ['Tab', 'Liste groß'], ['P', 'Pause']],
      briefing: {
        title: 'Lager 01 · Eisenwaren Krämer',
        subtitle: 'Fachbodenregallager · Mann-zur-Ware · Pick-by-Paper',
        blocks: [
          { p: 'Willkommen bei **Eisenwaren Krämer**, einem Familienbetrieb seit 1962. Seit Kurzem verkauft Krämer auch über einen **Online-Shop** – kommissioniert wird aber noch wie früher: mit **Papierliste**, **Kommissionierwagen** und viel Lauferei.' },
          { h: 'Dein Auftrag' },
          { list: [
            'Drucke am **Bürotisch** (rechts) den ersten Kommissionierauftrag.',
            'Koppel den **Kommissionierwagen** an (Taste **F** oder anklicken).',
            'Finde jede Position über die **Lagerplatzadresse**: **B-04-3** = Regal B, Fach 04, Ebene 3 (von unten).',
            'Nimm die richtige **Menge** – ein Klick = ein Stück. Ist der Wagen angekoppelt, landet die Ware direkt im **Wagen**. Hake die Zeile ab (Taste **1–9**).',
            'Bring den Wagen zum **Packtisch** und melde den Auftrag fertig – dort wird kontrolliert.',
          ] },
          { callout: '**Achtung:** Hier gibt es keinen Scanner. Ob du richtig gegriffen hast, merkt erst die Kontrolle. Lies genau – ähnliche Artikel liegen direkt nebeneinander!' },
          { p: 'Es warten **2 Aufträge**. Die türkisen **i-Punkte** erklären, wie das Lager funktioniert – beim Lesen läuft die Zeit nicht weiter.' },
        ],
      },
      start() {
        mission.start();
        updateObjective();
        audio.ambient('old');
        ui.toast('Tipp: Der **Lagerplan** direkt vor dir zeigt, wie die Regale aufgebaut sind.', 'info', 5000);
      },
      async afterBuild() {
        captureEnvironment(ctx, new THREE.Vector3(-1.5, 1.6, -2), { intensity: 1.05 });
      },
      pauseBlocks: () => [{ p: state.list ? `Aktueller Auftrag: **${state.list.no}** (${state.list.lines.length} Positionen)` : 'Kein Auftrag gedruckt.' }],
      quiz: QUIZ,
      dispose() {
        input.removeEventListener('cart', onCartKey);
        input.removeEventListener('device', onDeviceKey);
        input.removeEventListener('number', onNumber);
        engine.removeEventListener('xrstart', onXR); engine.removeEventListener('xrend', onXR); engine.removeEventListener('quality', onXR);
        engine.removeEventListener('xrstart', placeClip); engine.removeEventListener('xrend', placeClip); input.removeEventListener('controllerconnected', placeClip);
        player.removeEventListener('attach', updateObjective); player.removeEventListener('detach', updateObjective);
        if (clip.parent) clip.parent.remove(clip);
      },
    };
  },
};

// ------------------------------------------------------------------ Hilfsfunktionen
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Höhe der Oberfläche von obj an (x, z) – per Strahl von oben; null, wenn dort nichts ist */
const _surfRay = new THREE.Raycaster();
function surfaceY(obj, x, z, fromY = 2) {
  obj.updateMatrixWorld(true);
  _surfRay.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0));
  const hit = _surfRay.intersectObject(obj, true).find(h => h.object.visible && !h.object.userData.isHitBox);
  return hit ? hit.point.y : null;
}

/** Atmosphäre: Rohre, Kabeltrassen, Pinnwand, Plakate, Radio */
function decorateOld(ctx, { deskTop }) {
  const { root, mat } = ctx;
  const N = -HALL.d / 2 + 0.15, E = HALL.w / 2 - 0.15;
  // Rohre (Sprinkler rot, Heizung grau) an Nord- und Ostwand
  const red = mat.basic(0xa3241c, 0.45, 0.3), grey = mat.basic(0x8d9399, 0.4, 0.7);
  const pipe = (len, r, x, y, z, ry, m) => { const g = new THREE.CylinderGeometry(r, r, len, 12); g.rotateZ(Math.PI / 2); g.rotateY(ry); g.translate(x, y, z); return g; };
  root.add(mergeToMesh([pipe(HALL.w - 0.3, 0.035, 0, 3.78, N + 0.12, 0), pipe(HALL.d - 0.3, 0.035, E - 0.12, 3.78, 0, Math.PI / 2)], red, { cast: false }));
  root.add(mergeToMesh([pipe(HALL.w - 0.3, 0.055, 0, 3.5, N + 0.14, 0), pipe(HALL.d - 0.3, 0.055, E - 0.14, 3.5, 0, Math.PI / 2)], grey, { cast: false }));
  // Heizkörper unter den Ostfenstern
  const rad = [];
  for (const z of [-4.5, 3.0]) for (let i = 0; i < 14; i++) rad.push(boxGeo(0.06, 0.6, 0.04, E - 0.08, 0.55, z - 0.55 + i * 0.08));
  root.add(mergeToMesh(rad, mat.basic(0xe8e4d8, 0.5, 0.2), { cast: false }));
  // Kabeltrassen über den Gängen
  const galv = mat.pbr('metal_galvanized', { repeat: [8, 1], fallbackColor: 0xb8bcc0 });
  const trays = [];
  for (const x of [-5.0, -2.45]) {
    trays.push(boxGeo(0.3, 0.01, 7.6, x, 3.25, -3.85), boxGeo(0.01, 0.06, 7.6, x - 0.15, 3.28, -3.85), boxGeo(0.01, 0.06, 7.6, x + 0.15, 3.28, -3.85));
    for (let z = -7.4; z < 0; z += 1.5) trays.push(boxGeo(0.01, HALL.h - 3.25, 0.01, x, (HALL.h + 3.25) / 2, z));
  }
  root.add(mergeToMesh(trays, galv, { cast: false }));
  const cables = [];
  for (const x of [-5.0, -2.45]) for (let i = 0; i < 3; i++) { const g = new THREE.CylinderGeometry(0.012, 0.012, 7.6, 6); g.rotateX(Math.PI / 2); g.translate(x - 0.08 + i * 0.08, 3.275, -3.85); cables.push(g); }
  root.add(mergeToMesh(cables, mat.basic(0x1d1f22, 0.7, 0), { cast: false }));
  // Pinnwand mit Zetteln (Ostwand zwischen Büro und Spinden)
  const pin = signMesh(ctx, pinboardCanvas(), 1.2, 0.8);
  pin.position.set(E - 0.01, 1.55, 4.3); pin.rotation.y = -Math.PI / 2;
  root.add(pin);
  // Arbeitsschutz-Plakate am Ende der Gänge (Nordwand)
  const p1 = signMesh(ctx, posterCanvas('Richtig heben!', ['Last nah am Körper', 'In die Knie gehen', 'Rücken gerade', 'Nicht verdrehen'], '#1f6f43'), 0.84, 1.18);
  p1.position.set(-4.545, 1.7, N + 0.01); root.add(p1);
  const p2 = signMesh(ctx, posterCanvas('Ordnung im Lager', ['Gänge freihalten', 'Ware nur ins richtige Fach', 'Leere Kartons entsorgen', 'Leiter statt Klettern'], '#a3241c'), 0.84, 1.18);
  p2.position.set(-1.955, 1.7, N + 0.01); root.add(p2);
  // Radio auf dem Bürotisch
  const radio = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.17, 0.11), mat.basic(0x5b3a24, 0.5, 0));
  const grillC = makeCanvas(256, 128), gg = grillC.getContext('2d');
  gg.fillStyle = '#c8b999'; gg.fillRect(0, 0, 256, 128); gg.fillStyle = '#7b6a4c';
  for (let y = 8; y < 128; y += 10) for (let x = 8; x < 150; x += 10) { gg.beginPath(); gg.arc(x, y, 3, 0, 7); gg.fill(); }
  gg.fillStyle = '#e9dfc4'; gg.fillRect(165, 20, 80, 40); gg.fillStyle = '#333'; gg.fillRect(205, 25, 2, 30);
  const front = signMesh(ctx, grillC, 0.3, 0.15); front.position.z = 0.056;
  radio.add(body, front);
  radio.position.set(SPOTS.radio.x, SPOTS.radio.y + 0.085, SPOTS.radio.z); radio.rotation.y = -Math.PI / 2 + 0.2;
  radio.traverse(o => { if (o.isMesh) o.castShadow = true; });
  root.add(radio);
}

function pinboardCanvas() {
  const c = makeCanvas(768, 512), g = c.getContext('2d');
  g.fillStyle = '#b08a5a'; g.fillRect(0, 0, 768, 512);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${90 + Math.random() * 40},${60 + Math.random() * 30},30,0.25)`; g.fillRect(Math.random() * 768, Math.random() * 512, 2, 2); }
  g.strokeStyle = '#6b4b2a'; g.lineWidth = 18; g.strokeRect(0, 0, 768, 512);
  const notes = [
    { x: 40, y: 40, w: 220, h: 290, t: 'Urlaubsplan', l: ['Mai: Werner', 'Juni: Sabine', 'Juli: Azubi?', 'Aug.: Chef'], c: '#fdfbf3', r: -0.03 },
    { x: 290, y: 60, w: 200, h: 160, t: 'Grillfest!', l: ['Fr. 16 Uhr', 'Hof'], c: '#fff59d', r: 0.05 },
    { x: 520, y: 40, w: 210, h: 260, t: 'NEU: Online-Shop', l: ['Bestellungen', 'täglich bis', '14 Uhr packen!'], c: '#e3f2fd', r: -0.02 },
    { x: 300, y: 260, w: 200, h: 200, t: 'Inventur', l: ['31.12.', 'alle helfen'], c: '#fdfbf3', r: 0.03 },
    { x: 540, y: 330, w: 180, h: 140, t: 'Tel. Chef', l: ['0681 / ...'], c: '#ffe0b2', r: -0.06 },
  ];
  for (const n of notes) {
    g.save(); g.translate(n.x + n.w / 2, n.y + n.h / 2); g.rotate(n.r);
    g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 10; g.shadowOffsetY = 4;
    g.fillStyle = n.c; g.fillRect(-n.w / 2, -n.h / 2, n.w, n.h);
    g.shadowColor = 'transparent';
    g.fillStyle = '#c0392b'; g.beginPath(); g.arc(0, -n.h / 2 + 14, 8, 0, 7); g.fill();
    g.fillStyle = '#222'; g.font = `700 26px ${FONT}`; g.textAlign = 'center'; g.fillText(n.t, 0, -n.h / 2 + 56, n.w - 20);
    g.font = `400 22px ${MONO}`; n.l.forEach((ln, i) => g.fillText(ln, 0, -n.h / 2 + 96 + i * 30, n.w - 20));
    g.restore();
  }
  return c;
}

function posterCanvas(title, lines, color) {
  const c = makeCanvas(600, 840), g = c.getContext('2d');
  g.fillStyle = '#f6f3ea'; g.fillRect(0, 0, 600, 840);
  g.fillStyle = color; g.fillRect(0, 0, 600, 150);
  g.fillStyle = '#fff'; g.font = `900 56px ${FONT}`; g.textAlign = 'center'; g.fillText(title, 300, 98, 560);
  // Piktogramm: Person mit Kiste
  g.save(); g.translate(300, 380); g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 22; g.lineCap = 'round';
  g.beginPath(); g.arc(0, -150, 38, 0, 7); g.fill();
  g.beginPath(); g.moveTo(0, -105); g.lineTo(0, 20); g.moveTo(0, 20); g.lineTo(-50, 90); g.lineTo(-40, 150); g.moveTo(0, 20); g.lineTo(50, 90); g.lineTo(40, 150);
  g.moveTo(0, -70); g.lineTo(-60, -10); g.moveTo(0, -70); g.lineTo(60, -10); g.stroke();
  g.fillStyle = '#b88a4a'; g.fillRect(-80, -30, 160, 90); g.strokeStyle = '#7a5a2a'; g.lineWidth = 6; g.strokeRect(-80, -30, 160, 90);
  g.restore();
  g.fillStyle = '#222'; g.font = `700 34px ${FONT}`; g.textAlign = 'left';
  lines.forEach((l, i) => { g.fillStyle = color; g.beginPath(); g.arc(70, 612 + i * 56, 12, 0, 7); g.fill(); g.fillStyle = '#222'; g.fillText(l, 100, 624 + i * 56, 470); });
  g.font = `500 18px ${FONT}`; g.fillStyle = '#777'; g.fillText('Arbeitssicherheit · Eisenwaren Krämer', 40, 820);
  return c;
}

function fachPlate(text) {
  const c = makeCanvas(512, 128), g = c.getContext('2d');
  g.fillStyle = '#2f3b33'; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#c9b98f'; g.lineWidth = 6; g.strokeRect(8, 8, 496, 112);
  g.fillStyle = '#f2e6c9'; g.font = `800 78px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  return c;
}

/** Modell so drehen, dass die kleinste Ausdehnung nach oben zeigt (liegt flach) */
function layFlat(obj, maxLen) {
  const b = new THREE.Box3().setFromObject(obj), s = b.getSize(new THREE.Vector3());
  if (s.y > s.x && s.y > s.z) { obj.rotation.x = Math.PI / 2; }
  obj.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(obj), s2 = b2.getSize(new THREE.Vector3());
  if (s2.x > s2.z) obj.rotation.y = Math.PI / 2;
  const len = Math.max(s2.x, s2.z);
  if (len > maxLen) obj.scale.multiplyScalar(maxLen / len);
}

function makeDotMatrixPrinter(ctx) {
  const { mat } = ctx;
  const g = new THREE.Group();
  const beige = mat.basic(0xcfc6ad, 0.6, 0), dark = mat.basic(0x3a3a3a, 0.5, 0.1);
  const body = mergeToMesh([boxGeo(0.52, 0.13, 0.34, 0, 0.065, 0), boxGeo(0.5, 0.05, 0.12, 0, 0.15, -0.09)], beige);
  g.add(body);
  g.add(mergeToMesh([boxGeo(0.44, 0.03, 0.05, 0, 0.14, 0.05), boxGeo(0.05, 0.03, 0.02, 0.2, 0.135, 0.17)], dark));
  // Endlospapier-Stapel hinten
  const paper = mergeToMesh([boxGeo(0.38, 0.09, 0.26, 0, 0.045, -0.36)], mat.basic(0xf0ece0, 0.95, 0));
  g.add(paper);
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.006, 0.012), mat.emissive(0x33ff66, 3));
  led.position.set(0.2, 0.132, 0.165); g.add(led);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

function makeBell(ctx) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.015, 24), ctx.mat.basic(0x222222, 0.5, 0.2));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.05, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), ctx.mat.basic(0xd4af37, 0.25, 1));
  dome.position.y = 0.012;
  g.add(base, dome);
  return g;
}

function makeClock(ctx, pos, ry) {
  const c = makeCanvas(256, 256), g = c.getContext('2d');
  g.fillStyle = '#f4f1e8'; g.beginPath(); g.arc(128, 128, 120, 0, 7); g.fill();
  g.lineWidth = 10; g.strokeStyle = '#222'; g.stroke();
  g.fillStyle = '#222';
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.fillRect(128 + Math.sin(a) * 96 - 3, 128 - Math.cos(a) * 96 - 10, 6, 20); }
  const tex = ctx.track(new THREE.CanvasTexture(c)); tex.colorSpace = THREE.SRGBColorSpace;
  const grp = new THREE.Group();
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.17, 32), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
  grp.add(face);
  const handM = ctx.mat.basic(0x111111, 0.5, 0);
  const hh = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.09, 0.004), handM); hh.geometry.translate(0, 0.045, 0); hh.position.z = 0.005;
  const mh = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.13, 0.004), handM); mh.geometry.translate(0, 0.065, 0); mh.position.z = 0.008;
  grp.add(hh, mh);
  const now = new Date();
  hh.rotation.z = -((now.getHours() % 12) + now.getMinutes() / 60) / 12 * Math.PI * 2;
  mh.rotation.z = -now.getMinutes() / 60 * Math.PI * 2;
  grp.position.copy(pos); grp.rotation.y = ry;
  return grp;
}

function calendarCanvas() {
  const c = makeCanvas(384, 560), g = c.getContext('2d');
  g.fillStyle = '#faf7ef'; g.fillRect(0, 0, 384, 560);
  g.fillStyle = '#b91c1c'; g.fillRect(0, 0, 384, 70);
  g.fillStyle = '#fff'; g.font = `800 34px ${FONT}`; g.textAlign = 'center'; g.fillText('EISENWAREN KRÄMER', 192, 47, 360);
  const d = new Date();
  g.fillStyle = '#222'; g.font = `800 40px ${FONT}`;
  g.fillText(d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }), 192, 130);
  g.font = `500 22px ${FONT}`;
  const first = new Date(d.getFullYear(), d.getMonth(), 1).getDay() || 7;
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].forEach((t, i) => g.fillText(t, 42 + i * 50, 180));
  for (let i = 1; i <= days; i++) {
    const k = i + first - 2, col = k % 7, row = Math.floor(k / 7);
    g.fillStyle = col >= 5 ? '#b91c1c' : '#222';
    if (i === d.getDate()) { g.strokeStyle = '#1f3fbf'; g.lineWidth = 3; g.beginPath(); g.arc(42 + col * 50, 214 + row * 52, 20, 0, 7); g.stroke(); }
    g.fillText(String(i), 42 + col * 50, 222 + row * 52);
  }
  return c;
}

function planCanvas() {
  const W = 1200, H = 840;
  const c = makeCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#f2ecdc'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#2a2017'; g.font = `900 44px ${FONT}`; g.textAlign = 'left'; g.fillText('LAGERPLAN', 40, 64);
  g.font = `500 24px ${FONT}`; g.fillText('Adresse = Regal – Fach – Ebene   z. B.  B-04-3', 330, 62);
  // Maßstab: Halle 12 × 16 m → x: 60..1140, z: 100..800 (gedreht: oben = hinten)
  const sx = x => 60 + (x + 6) / 12 * 1080, sz = z => 110 + (z + 8) / 16 * 700;
  g.strokeStyle = '#2a2017'; g.lineWidth = 6; g.strokeRect(sx(-6), sz(-8), sx(6) - sx(-6), sz(8) - sz(-8));
  for (const R of REGALE) {
    const x0 = sx(R.x - 0.23), x1 = sx(R.x + 0.23), z0 = sz(ROW_Z - 3.75), z1 = sz(ROW_Z + 3.75);
    g.fillStyle = '#8a6a4a'; g.fillRect(x0, z0, x1 - x0, z1 - z0);
    g.fillStyle = '#2a2017'; g.font = `900 40px ${FONT}`; g.textAlign = 'center';
    g.fillText(R.id, (x0 + x1) / 2, z0 - 12);
    g.font = `600 15px ${MONO}`;
    for (let f = 1; f <= SECTIONS; f++) { const zz = sz(-0.1 - (f - 0.5) * SECTION_W); if (f === 1 || f === 5 || f === 10) g.fillText(String(f).padStart(2, '0'), R.ry > 0 ? x1 + 18 : x0 - 18, zz + 5); }
  }
  g.font = `700 24px ${FONT}`; g.fillStyle = '#3b5d3a'; g.textAlign = 'center';
  g.fillText('Gang 1', sx(-4.55), sz(-8) + 28); g.fillText('Gang 2', sx(-1.95), sz(-8) + 28);
  const box = (x, z, w, d, t, col) => { g.fillStyle = col; g.fillRect(sx(x - w / 2), sz(z - d / 2), sx(x + w / 2) - sx(x - w / 2), sz(z + d / 2) - sz(z - d / 2)); g.fillStyle = '#fff'; g.font = `700 20px ${FONT}`; g.fillText(t, sx(x), sz(z) + 7); };
  box(SPOTS.printer.x, SPOTS.printer.z, 0.9, 1.7, 'Büro', '#4a6a8a');
  box(SPOTS.packing.x, SPOTS.packing.z, 2.0, 0.9, 'Packtisch', '#3b7a57');
  box(4.4, -5.5, 2.2, 3.2, 'Wareneingang', '#7a6a5a');
  g.fillStyle = '#c0392b'; g.beginPath(); g.arc(sx(0.85), sz(1.3), 14, 0, 7); g.fill();
  g.fillStyle = '#c0392b'; g.font = `700 22px ${FONT}`; g.textAlign = 'left'; g.fillText('Sie sind hier', sx(0.85) + 22, sz(1.3) + 8);
  g.strokeStyle = '#3b5d3a'; g.lineWidth = 4; g.setLineDash([10, 8]);
  g.beginPath(); g.moveTo(sx(-4.55), sz(0.2)); g.lineTo(sx(-4.55), sz(-7.4)); g.lineTo(sx(-1.95), sz(-7.4)); g.lineTo(sx(-1.95), sz(0.2)); g.stroke();
  g.setLineDash([]);
  g.font = `500 18px ${FONT}`; g.fillStyle = '#3b5d3a'; g.fillText('Schleifenweg', sx(-3.6), sz(-7.7));
  return c;
}

const QUIZ = [
  { q: 'Welches Kommissionierprinzip liegt bei Eisenwaren Krämer vor?', options: ['Ware-zur-Person – die Regale kommen zum Picker', 'Mann-zur-Ware – der Picker geht zur Ware im Regal', 'Pick-by-Robot – ein Roboter greift die Ware', 'Cross-Docking – Ware wird ohne Lagerung umgeschlagen'], correct: 1, explain: 'Die Ware bleibt im Regal (statische Bereitstellung) und du bewegst dich zu ihr – das ist Mann-zur-Ware.' },
  { q: 'Was bedeutet die Lagerplatzadresse C-07-2?', options: ['Regal C, Fach 07, Ebene 2', 'Gang C, Ebene 07, Fach 2', 'Artikel C07 mit 2 Stück Bestand', 'Regal 7, Ebene C, Fach 2'], correct: 0, explain: 'Bei Krämer gilt: Regal – Fach – Ebene. Ebene 1 ist unten.' },
  { q: 'Welcher Anteil der Kommissionierzeit ist in Mann-zur-Ware-Lagern typischerweise am größten?', options: ['Die Greifzeit', 'Die Basiszeit', 'Die Wegzeit', 'Die Totzeit'], correct: 2, explain: 'Das Gehen zwischen den Lagerplätzen (Wegzeit) macht oft rund die Hälfte der Zeit aus – deshalb lohnt sich Wegoptimierung so sehr.' },
  { q: 'Warum fallen Pickfehler bei Pick-by-Paper oft erst spät auf?', options: ['Weil Papier schneller ist als ein Scanner', 'Weil es keine automatische Prüfung beim Entnehmen gibt', 'Weil die Lagerplätze ständig wechseln', 'Weil die Ware zu klein ist'], correct: 1, explain: 'Niemand prüft beim Greifen, ob Artikel und Menge stimmen. Erst die Kontrolle am Packtisch (oder der Kunde) bemerkt den Fehler.' },
  { q: 'Was kennzeichnet ein Festplatzsystem?', options: ['Ware wird dort eingelagert, wo gerade Platz frei ist', 'Jeder Artikel hat immer denselben Lagerplatz', 'Die Regale stehen fest am Boden verschraubt', 'Nur feste Ware (keine Flüssigkeiten) wird gelagert'], correct: 1, explain: 'Beim Festplatzsystem hat jeder Artikel seinen festen Platz. Das Gegenteil ist die chaotische Lagerhaltung (Freiplatzsystem).' },
  { q: 'Welche Maßnahme verkürzt die Wege eines Pickers am stärksten?', options: ['Die Pickliste in größerer Schrift drucken', 'Die Pickliste nach Lagerplätzen sortieren (Wegoptimierung)', 'Mehr Licht in der Halle', 'Den Wagen schwerer beladen'], correct: 1, explain: 'Eine nach Lagerplatz sortierte Liste (z. B. Schleifenstrategie) verhindert Zickzack-Wege und spart viel Laufweg.' },
];
