// Schlichter Empfangsraum (Hintergrund der Lagerauswahl, v. a. in VR sichtbar)
import * as THREE from 'three';
import { signCanvas } from '../core/canvas.js';
import { signMesh } from '../core/builders.js';

export function buildLobby(ctx) {
  const { root, engine } = ctx;
  engine.scene.background = new THREE.Color(0x07090c);
  engine.scene.fog = null;
  // Boden läuft zum Rand hin weich in den dunklen Hintergrund aus (statt Nebel)
  const fadeC = document.createElement('canvas'); fadeC.width = fadeC.height = 256;
  const fg = fadeC.getContext('2d');
  const rg = fg.createRadialGradient(128, 128, 20, 128, 128, 128);
  rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.45, '#ffffff'); rg.addColorStop(1, '#000000');
  fg.fillStyle = rg; fg.fillRect(0, 0, 256, 256);
  const fadeTex = ctx.track(new THREE.CanvasTexture(fadeC));
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x1a1f26, roughness: 0.35, metalness: 0.2, alphaMap: fadeTex, transparent: true });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);
  // Bodenringe
  for (let i = 1; i <= 5; i++) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(i * 1.6 - 0.01, i * 1.6 + 0.01, 96), new THREE.MeshBasicMaterial({ color: 0xf5a524, transparent: true, opacity: 0.25 / i }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002;
    root.add(ring);
  }
  root.add(new THREE.HemisphereLight(0xbfd4ff, 0x1a1208, 0.6));
  const key = new THREE.SpotLight(0xffe2b5, 40, 20, 0.6, 0.6, 1.5);
  key.position.set(2, 7, 3); key.target.position.set(0, 0, -2);
  key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
  root.add(key, key.target);
  const sign = signMesh(ctx, signCanvas('PickSim', { sub: 'Lager-Simulator für die Ausbildung', bg: '#0f141b', fg: '#f5a524', w: 1024, h: 384 }), 3.2, 1.2, { emissive: 0.6 });
  sign.position.set(0, 2.6, -4.5);
  root.add(sign);
  // ein paar Paletten als Deko, falls Modelle geladen sind
  ctx.assets.load('pallet_load_a').then(t => { if (!t || !ctx.root.parent) return; const p = ctx.assets.get('pallet_load_a'); p.position.set(-2.6, 0, -3.2); p.rotation.y = 0.4; root.add(p); });
  ctx.assets.load('pallet_load_wrapped').then(t => { if (!t || !ctx.root.parent) return; const p = ctx.assets.get('pallet_load_wrapped'); p.position.set(2.7, 0, -3.0); p.rotation.y = -0.3; root.add(p); });
  ctx.onUpdate((dt, t) => { key.intensity = 40 + Math.sin(t * 0.7) * 2; });
  return { spawn: { x: 0, z: 2.2, yaw: 0 } };
}
