// LAGER 02 – Flurförderzeuge (Stapler, Schubmaststapler) mit Befehlsliste, Sicherheitsstopp, Blue Spot und Warnton
import * as THREE from 'three';

const FRONT_ROT = { '+Z': 0, '-Z': Math.PI, '+X': -Math.PI / 2, '-X': Math.PI / 2 };
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const _v = new THREE.Vector3();

let _spotTex = null;
function spotTexture() {
  if (_spotTex) return _spotTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(120,170,255,1)'); r.addColorStop(0.35, 'rgba(60,120,255,0.85)'); r.addColorStop(1, 'rgba(30,80,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  _spotTex = new THREE.CanvasTexture(c);
  _spotTex.colorSpace = THREE.SRGBColorSpace;
  return _spotTex;
}

export class Vehicle {
  /**
   * model: Bodenmittig ausgerichtetes Modell; front: Richtung der Gabeln/Fahrerseite im Modell ('+Z', '-Z', '+X', '-X')
   * opts: speed, turnRate, loadBack (Abstand Lastmitte → Gabelspitze), name, motorFreq, blueSpot (bool), onIncident(v)
   */
  constructor(ctx, model, front, opts = {}) {
    this.ctx = ctx;
    this.opts = opts;
    this.group = new THREE.Group();
    this.group.name = opts.name || 'vehicle';
    this.inner = new THREE.Group();
    this.inner.add(model);
    this.inner.rotation.y = FRONT_ROT[front] ?? 0;
    this.group.add(this.inner);
    this.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.inner);
    const size = box.getSize(new THREE.Vector3());
    this.width = opts.width || size.x;
    this.length = opts.length || size.z;
    this.frontExt = box.max.z;
    this.rearExt = -box.min.z;
    this.maxSpeed = opts.speed || 1.6;
    this.turnRate = opts.turnRate || 1.3;
    this.speed = 0;
    this.heading = 0;
    this.queue = [];
    this.cmd = null;
    this.loopCmds = null;
    this.paused = false;
    this._hornT = 0; this._incT = 0;
    // Lastaufnahme (Gabel): Kinder dieses Objekts fahren mit und heben sich mit der Gabel
    this.fork = new THREE.Group();
    this.forkY0 = opts.forkY0 ?? 0.06;
    this.fork.position.set(0, this.forkY0, this.frontExt - (opts.loadBack ?? 0.62));
    this.group.add(this.fork);
    // bewegliche Teile im Modell (Gabelträger/Mast), falls benannt
    this.liftParts = [];
    model.traverse(o => {
      const n = o.name || '';
      if (o === model || /wheel|forklift/i.test(n)) return;
      let f = 0;
      if (/fork|carriage|gabel|^lift$|^lift[_.]|[_.]lift$/i.test(n)) f = 1;
      const ms = n.match(/mast_?stage_?(\d)/i);
      if (ms) f = (Number(ms[1]) - 1) / 4;
      if (f > 0) this.liftParts.push({ o, y0: o.position.y, f });
    });
    // Kollision (zwei Kreise entlang der Längsachse)
    const r = Math.max(0.45, this.width * 0.55);
    this.c1 = ctx.player.addCircle(0, 0, r, 'vehicle');
    this.c2 = ctx.player.addCircle(0, 0, r, 'vehicle');
    // Blue Spot (Warnlicht auf dem Boden in Fahrtrichtung)
    this.spot = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), new THREE.MeshBasicMaterial({ map: spotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.spot.rotation.x = -Math.PI / 2;
    this.spot.position.y = 0.012;
    this.spot.visible = false;
    this.spot.userData.noEnvCapture = true;
    ctx.root.add(this.spot);
    ctx.track(this.spot.geometry); ctx.track(this.spot.material);
    // Geräusche
    this.motor = ctx.audio.loop('motor', this.group, { freq: opts.motorFreq || 62, gain: 0.0, cutoff: 420, ref: 2.5 });
    this.beep = ctx.audio.loop('beeper', this.group, { interval: 0.7, freq: 1300, gain: 0.07, ref: 3 });
    this.beep.src.on = false;
    ctx.root.add(this.group);
  }

  get position() { return this.group.position; }

  setPose(x, z, heading) {
    this.group.position.set(x, 0, z);
    this.heading = heading;
    this.group.rotation.y = heading;
    this._updateColliders();
    return this;
  }

  // ---- Befehle (verkettbar)
  drive(x, z, o = {}) { this.queue.push({ type: 'drive', x, z, rev: !!o.rev, speed: o.speed }); return this; }
  turn(heading) { this.queue.push({ type: 'turn', heading }); return this; }
  move(d, speed = 0.5) { this.queue.push({ type: 'move', d, speed }); return this; }
  lift(h, t = 2) { this.queue.push({ type: 'lift', h, t }); return this; }
  wait(t) { this.queue.push({ type: 'wait', t }); return this; }
  call(fn) { this.queue.push({ type: 'call', fn }); return this; }
  loop(cmds) { this.loopCmds = cmds; return this; }
  get idle() { return !this.cmd && !this.queue.length && !this.loopCmds; }

  /** Gabelhöhe (Unterkante Last) in m */
  setForkHeight(h) {
    this.fork.position.y = h;
    const dy = Math.max(0, h - this.forkY0);
    for (const p of this.liftParts) p.o.position.y = p.y0 + dy * p.f;
  }

  _next() {
    if (this.queue.length) return this.queue.shift();
    if (this.loopCmds) { this.queue.push(...this.loopCmds.map(c => ({ ...c }))); return this.queue.shift(); }
    return null;
  }

  update(dt, playerPos, onWalkway) {
    if (!this.cmd) this.cmd = this._next();
    const c = this.cmd;
    let target = 0;
    const pos = this.group.position;
    if (c && !this.paused) {
      switch (c.type) {
        case 'drive': {
          const dx = c.x - pos.x, dz = c.z - pos.z, dist = Math.hypot(dx, dz);
          if (dist < 0.1) { this.cmd = null; break; }
          let desired = Math.atan2(dx, dz);
          if (c.rev) desired += Math.PI;
          const diff = wrap(desired - this.heading);
          const k = this.turnRate * dt * (Math.abs(this.speed) > 0.05 ? 1 : 0.7);
          this.heading += Math.max(-k, Math.min(k, diff));
          const align = Math.max(0, Math.cos(diff));
          let v = (c.speed || this.maxSpeed) * align * Math.min(1, dist / 1.6 + 0.12);
          if (Math.abs(diff) > 0.6) v = Math.min(v, 0.18);
          target = c.rev ? -v : v;
          break;
        }
        case 'turn': {
          const diff = wrap(c.heading - this.heading);
          const k = this.turnRate * 0.8 * dt;
          this.heading += Math.max(-k, Math.min(k, diff));
          if (Math.abs(diff) < 0.01) { this.heading = c.heading; this.cmd = null; }
          break;
        }
        case 'move': {
          c.done = c.done || 0;
          const left = Math.abs(c.d) - c.done;
          if (left <= 0.005) { this.cmd = null; break; }
          const v = Math.min(c.speed, left / 0.6 + 0.05);
          target = Math.sign(c.d) * v;
          break;
        }
        case 'lift': {
          c.t0 = (c.t0 || 0) + dt;
          if (c.from == null) c.from = this.fork.position.y;
          const k = Math.min(1, c.t0 / c.t);
          const e = k * k * (3 - 2 * k);
          this.setForkHeight(c.from + (c.h - c.from) * e);
          if (k >= 1) this.cmd = null;
          break;
        }
        case 'wait': c.t -= dt; if (c.t <= 0) this.cmd = null; break;
        case 'call': this.cmd = null; c.fn(this); break;
        default: this.cmd = null;
      }
    }

    // Sicherheitsstopp vor Personen
    const s = Math.sign(target || this.speed);
    this.blocked = false;
    if (playerPos && s !== 0) {
      const dx = playerPos.x - pos.x, dz = playerPos.z - pos.z;
      const fwd = dx * Math.sin(this.heading) + dz * Math.cos(this.heading);
      const lat = dx * Math.cos(this.heading) - dz * Math.sin(this.heading);
      const ahead = s * fwd - (s > 0 ? this.frontExt : this.rearExt);
      if (ahead > -0.4 && ahead < 3.0 && Math.abs(lat) < this.width / 2 + 0.75) {
        this.blocked = true;
        if (Math.abs(this.speed) > 0.35 && ahead < 1.8 && this._incT <= 0 && !(onWalkway && onWalkway(playerPos))) {
          this._incT = 8;
          this.opts.onIncident && this.opts.onIncident(this);
        }
        if (this._hornT <= 0) { this._hornT = 4; this.ctx.audio.play('warn', { position: pos.clone().setY(1.2) }); }
        target = 0;
      }
    }
    this._hornT -= dt; this._incT -= dt;

    const acc = Math.abs(target) > Math.abs(this.speed) ? 1.4 : 3.2;
    const dv = target - this.speed;
    this.speed += Math.max(-acc * dt, Math.min(acc * dt, dv));
    if (Math.abs(this.speed) < 0.002 && target === 0) this.speed = 0;
    const step = this.speed * dt;
    pos.x += Math.sin(this.heading) * step;
    pos.z += Math.cos(this.heading) * step;
    if (c && c.type === 'move') c.done += Math.abs(step);
    this.group.rotation.y = this.heading;
    this._updateColliders();

    // Blue Spot & Töne
    const moving = Math.abs(this.speed) > 0.08;
    this.spot.visible = moving && this.opts.blueSpot !== false;
    if (moving) {
      const d = Math.sign(this.speed) * ((this.speed > 0 ? this.frontExt : this.rearExt) + 2.6);
      this.spot.position.set(pos.x + Math.sin(this.heading) * d, 0.012, pos.z + Math.cos(this.heading) * d);
    }
    this.beep.src.on = this.speed < -0.05;
    this.motor.setGain(0.02 + Math.min(1, Math.abs(this.speed) / this.maxSpeed) * 0.09);
  }

  _updateColliders() {
    const p = this.group.position, h = this.heading;
    const off = Math.max(0.2, this.length * 0.24);
    const cx = (this.frontExt - this.rearExt) / 2;
    this.c1.x = p.x + Math.sin(h) * (cx + off); this.c1.z = p.z + Math.cos(h) * (cx + off);
    this.c2.x = p.x + Math.sin(h) * (cx - off); this.c2.z = p.z + Math.cos(h) * (cx - off);
  }

  dispose() {
    this.ctx.player.removeCollider(this.c1);
    this.ctx.player.removeCollider(this.c2);
    this.motor.stop(); this.beep.stop();
  }
}
