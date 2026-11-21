// Fortbewegung (Desktop: WASD + Maus, VR: Stick + Snap-Turn), Kollision, Laufweg-Messung,
// mitgeführte Objekte (z. B. Kommissionierwagen).
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _h = new THREE.Vector3();
const _m = new THREE.Vector2();

export class Player extends THREE.EventDispatcher {
  constructor(engine, input) {
    super();
    this.engine = engine;
    this.input = input;
    this.rig = engine.rig;
    this.camera = engine.camera;
    this.radius = 0.26;
    this.walkSpeed = 1.55;     // m/s – zügiges Gehen
    this.sprintSpeed = 2.6;
    this.yaw = 0;
    this.pitch = 0;
    this.enabled = true;
    this.boxes = [];           // {minX,minZ,maxX,maxZ}
    this.circles = [];         // {x,z,r}
    this.bounds = null;        // {minX,minZ,maxX,maxZ}
    this.velocity = new THREE.Vector2();
    this.distance = 0;
    this.walkTime = 0;
    this.speed = 0;
    this._stepAcc = 0;
    this._lastHead = null;
    this._bob = 0;
    this.attached = null;
    this.bodyYaw = 0;

    input.addEventListener('snapturn', e => this.snapTurn(e.angle));
    engine.addEventListener('xrstart', () => { this._recenterPending = 2; });
    engine.addEventListener('xrend', () => { this.setPose(this.rig.position.x, this.rig.position.z, this.yaw); this.vignette.visible = false; });

    // Komfort-Vignette für VR: dunkelt beim Fahren mit dem Stick den Rand des Sichtfelds ab (gegen Übelkeit)
    const vc = document.createElement('canvas'); vc.width = vc.height = 256;
    const vg = vc.getContext('2d');
    const grad = vg.createRadialGradient(128, 128, 40, 128, 128, 128);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.55, 'rgba(0,0,0,0)'); grad.addColorStop(0.85, 'rgba(0,0,0,0.85)'); grad.addColorStop(1, 'rgba(0,0,0,1)');
    vg.fillStyle = grad; vg.fillRect(0, 0, 256, 256);
    const vt = new THREE.CanvasTexture(vc);
    this.vignette = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: vt, transparent: true, depthTest: false, depthWrite: false, opacity: 0, toneMapped: false }));
    this.vignette.position.set(0, 0, -0.25);
    this.vignette.renderOrder = 100;
    this.vignette.visible = false;
    this.vignette.userData.noEnvCapture = true;
    this.camera.add(this.vignette);
    this.comfortVignette = true;
  }

  clearColliders() { this.boxes.length = 0; this.circles.length = 0; this.bounds = null; }
  addBox(minX, minZ, maxX, maxZ, tag) { const b = { minX, minZ, maxX, maxZ, tag }; this.boxes.push(b); return b; }
  /** Box aus Mittelpunkt, Größe und Drehung (nur 0/90/180/270° exakt) */
  addBoxCentered(x, z, w, d, rotY = 0, tag) {
    const swap = Math.abs(Math.sin(rotY)) > 0.7;
    const hw = (swap ? d : w) / 2, hd = (swap ? w : d) / 2;
    return this.addBox(x - hw, z - hd, x + hw, z + hd, tag);
  }
  removeCollider(c) {
    let i = this.boxes.indexOf(c); if (i >= 0) this.boxes.splice(i, 1);
    i = this.circles.indexOf(c); if (i >= 0) this.circles.splice(i, 1);
  }
  addCircle(x, z, r, tag) { const c = { x, z, r, tag }; this.circles.push(c); return c; }
  setBounds(minX, minZ, maxX, maxZ) { this.bounds = { minX, minZ, maxX, maxZ }; }

  setPose(x, z, yaw = 0) {
    this.yaw = yaw;
    this.pitch = 0;
    this.bodyYaw = yaw;
    this.rig.rotation.set(0, yaw, 0);
    if (this.engine.isXR) {
      this.rig.position.set(x, 0, z);
      this._recenterPending = 1;
      this._target = { x, z, yaw };
    } else {
      this.rig.position.set(x, 0, z);
      this.camera.rotation.set(0, 0, 0);
      this.camera.position.set(0, this.engine.eyeHeight, 0);
    }
    this._lastHead = null;
    this.velocity.set(0, 0);
    if (this.attached) this._placeAttached(true);
  }

  resetStats() { this.distance = 0; this.walkTime = 0; this._lastHead = null; }

  /** Rig so verschieben, dass der Kopf über (x,z) steht (VR) */
  recenter(x = this.rig.position.x, z = this.rig.position.z) {
    this.engine.headPosition(_h);
    this.rig.position.x += x - _h.x;
    this.rig.position.z += z - _h.z;
    this._lastHead = null;
  }

  snapTurn(angle) {
    if (!this.engine.isXR) return;
    this.engine.headPosition(_h);
    const rig = this.rig;
    // um die Kopfposition drehen
    const dx = rig.position.x - _h.x, dz = rig.position.z - _h.z;
    const c = Math.cos(angle), s = Math.sin(angle);
    rig.position.x = _h.x + dx * c + dz * s;
    rig.position.z = _h.z - dx * s + dz * c;
    rig.rotation.y += angle;
    this.yaw = rig.rotation.y;
    this._lastHead = null;
  }

  /** Objekt (z. B. Wagen) mitführen. offset: lokal zur Blickrichtung (x rechts, z vorne negativ) */
  attach(object, { offset = new THREE.Vector3(0, 0, -0.95), radius = 0.45, onMove = null } = {}) {
    this.attached = { object, offset: offset.clone(), radius, onMove };
    this._placeAttached(true);
    this.dispatchEvent({ type: 'attach', object });
  }
  detach() {
    const a = this.attached;
    this.attached = null;
    if (a) this.dispatchEvent({ type: 'detach', object: a.object });
    return a && a.object;
  }

  _bodyPos(out) {
    if (this.engine.isXR) { this.engine.headPosition(out); out.y = 0; }
    else out.set(this.rig.position.x, 0, this.rig.position.z);
    return out;
  }

  _placeAttached(instant = false, dt = 0.016) {
    const a = this.attached;
    if (!a) return;
    const body = this._bodyPos(new THREE.Vector3());
    const yaw = this.bodyYaw;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const tx = body.x + a.offset.x * c + a.offset.z * s;
    const tz = body.z - a.offset.x * s + a.offset.z * c;
    const o = a.object;
    if (instant) {
      o.position.x = tx; o.position.z = tz; o.rotation.y = yaw;
    } else {
      const k = 1 - Math.exp(-dt * 10);
      o.position.x += (tx - o.position.x) * k;
      o.position.z += (tz - o.position.z) * k;
      let dy = yaw - o.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      o.rotation.y += dy * (1 - Math.exp(-dt * 7));
    }
    if (a.onMove) a.onMove(o);
  }

  update(dt) {
    const eng = this.engine;
    const xr = eng.isXR;
    if (xr && this._recenterPending) {
      this._recenterPending--;
      if (this._recenterPending === 0) {
        const t = this._target || { x: this.rig.position.x, z: this.rig.position.z };
        this.recenter(t.x, t.z);
        this._target = null;
      }
    }

    // Blick (Desktop)
    if (!xr) {
      const d = this.input.consumeMouse();
      if (this.enabled && this.input.lookActive) {
        this.yaw -= d.x * this.input.sensitivity;
        this.pitch -= d.y * this.input.sensitivity * (this.input.invertY ? -1 : 1);
        this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.35);
      }
      this.rig.rotation.y = this.yaw;
      this.camera.rotation.set(this.pitch, 0, 0);
    }

    // Körper-Gierwinkel (für Laufrichtung in VR und den Wagen)
    const headYaw = xr ? eng.headYaw() : this.yaw;
    let dy = headYaw - this.bodyYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.bodyYaw += dy * (xr ? (1 - Math.exp(-dt * 3)) : 1);

    // Bewegung
    const mv = this.enabled ? this.input.moveVector(_m) : _m.set(0, 0);
    const maxSpeed = (!xr && this.input.sprint) ? this.sprintSpeed : this.walkSpeed;
    const c = Math.cos(headYaw), s = Math.sin(headYaw);
    // Vorwärts = -Z in lokaler Blickrichtung
    const wx = mv.x * c - mv.y * s;
    const wz = -mv.x * s - mv.y * c;
    const accel = mv.lengthSq() > 0 ? 9 : 12;
    const k = 1 - Math.exp(-dt * accel);
    this.velocity.x += (wx * maxSpeed - this.velocity.x) * k;
    this.velocity.y += (wz * maxSpeed - this.velocity.y) * k;
    if (this.velocity.lengthSq() < 1e-5) this.velocity.set(0, 0);

    this.rig.position.x += this.velocity.x * dt;
    this.rig.position.z += this.velocity.y * dt;

    if (xr && this.comfortVignette) {
      const target = Math.min(1, this.velocity.length() / this.walkSpeed) * 0.9;
      const m = this.vignette.material;
      m.opacity += (target - m.opacity) * (1 - Math.exp(-dt * 8));
      this.vignette.visible = m.opacity > 0.02;
    }

    // Kollision am Körperpunkt (Desktop: Rig, VR: Kopf)
    this._resolve();

    if (this.attached) this._placeAttached(false, dt);

    // Laufweg messen (Kopfposition, inkl. echter Schritte in VR)
    eng.headPosition(_h);
    if (this._lastHead) {
      const dist = Math.hypot(_h.x - this._lastHead.x, _h.z - this._lastHead.z);
      if (dist < 1.0) {
        this.distance += dist;
        this.speed = dist / Math.max(dt, 1e-4);
        if (this.speed > 0.25) this.walkTime += dt;
        this._stepAcc += dist;
        if (this._stepAcc > 0.68) { this._stepAcc = 0; this.dispatchEvent({ type: 'step' }); }
      }
    }
    this._lastHead = this._lastHead || new THREE.Vector3();
    this._lastHead.copy(_h);

    // dezentes Kopfwippen + Bücken mit C/Strg (nur Desktop)
    if (!xr) {
      const sp = this.velocity.length();
      this._bob += dt * sp * 5.2;
      const amp = Math.min(sp / this.walkSpeed, 1) * 0.014;
      const k = this.input.keys;
      const crouch = this.enabled && this.input.gameActive && (k.has('KeyC') || k.has('ControlLeft'));
      this._crouch = (this._crouch || 0) + ((crouch ? 1 : 0) - (this._crouch || 0)) * (1 - Math.exp(-dt * 10));
      this.camera.position.y = eng.eyeHeight - this._crouch * 0.62 + Math.sin(this._bob) * amp;
    }
  }

  _resolve() {
    const xr = this.engine.isXR;
    const p = this._bodyPos(_v);
    let px = p.x, pz = p.z;
    const r = this.radius;
    for (let iter = 0; iter < 3; iter++) {
      for (const b of this.boxes) {
        const cx = Math.max(b.minX, Math.min(px, b.maxX));
        const cz = Math.max(b.minZ, Math.min(pz, b.maxZ));
        let dx = px - cx, dz = pz - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            px += dx / d * (r - d); pz += dz / d * (r - d);
          } else {
            // Mittelpunkt in der Box: an die nächste Kante schieben
            const pen = [px - b.minX, b.maxX - px, pz - b.minZ, b.maxZ - pz];
            const i = pen.indexOf(Math.min(...pen));
            if (i === 0) px = b.minX - r; else if (i === 1) px = b.maxX + r; else if (i === 2) pz = b.minZ - r; else pz = b.maxZ + r;
          }
        }
      }
      for (const c of this.circles) {
        const dx = px - c.x, dz = pz - c.z;
        const d = Math.hypot(dx, dz), min = r + c.r;
        if (d < min && d > 1e-6) { px += dx / d * (min - d); pz += dz / d * (min - d); }
      }
    }
    // mitgeführtes Objekt darf auch nicht in Regale fahren
    if (this.attached) {
      const a = this.attached;
      const yaw = this.bodyYaw, c = Math.cos(yaw), s = Math.sin(yaw);
      let ax = px + a.offset.x * c + a.offset.z * s;
      let az = pz - a.offset.x * s + a.offset.z * c;
      const ar = a.radius;
      let sx = 0, sz = 0;
      for (const b of this.boxes) {
        const cx = Math.max(b.minX, Math.min(ax, b.maxX));
        const cz = Math.max(b.minZ, Math.min(az, b.maxZ));
        const dx = ax - cx, dz = az - cz, d2 = dx * dx + dz * dz;
        if (d2 < ar * ar && d2 > 1e-8) { const d = Math.sqrt(d2); sx += dx / d * (ar - d); sz += dz / d * (ar - d); }
      }
      px += sx; pz += sz;
    }
    if (this.bounds) {
      const B = this.bounds;
      px = Math.max(B.minX + r, Math.min(B.maxX - r, px));
      pz = Math.max(B.minZ + r, Math.min(B.maxZ - r, pz));
    }
    this.rig.position.x += px - p.x;
    this.rig.position.z += pz - p.z;
  }
}
