// Zielauswahl per Fadenkreuz (Desktop) bzw. Controller-Strahl (VR), Hover-Hervorhebung,
// Aktionen an Ziele weiterreichen, und die "Hand" (gerade gehaltene Ware).
import * as THREE from 'three';

const _m4 = new THREE.Matrix4();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _ctr = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _org = new THREE.Vector3();

let _id = 0;

export class Interaction extends THREE.EventDispatcher {
  constructor(engine, input, ui) {
    super();
    this.engine = engine;
    this.input = input;
    this.ui = ui;
    this.targets = new Set();
    this.hitObjects = [];
    this.blockers = [];
    this.raycaster = new THREE.Raycaster();
    this.enabled = true;
    this.hover = null;          // Desktop- bzw. "aktiver" Hover
    this.hoverByCtrl = new Map();
    this.defaultMaxDist = 2.5;
    this.xrMaxDist = 1.9;
    this.onAction = null;       // (action, target|null, ev, hit) => void   – Fallback für Levels

    // Hervorhebung (Kantenbox)
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.highlights = [0, 1, 2].map(() => {
      const hl = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xf5a524, transparent: true, opacity: 0.95, depthTest: true }));
      hl.matrixAutoUpdate = false;
      hl.visible = false;
      hl.renderOrder = 5;
      engine.scene.add(hl);
      return hl;
    });

    // VR-Tooltip (Sprite mit Canvas)
    this._tipCanvas = document.createElement('canvas');
    this._tipCanvas.width = 1024; this._tipCanvas.height = 192;
    this._tipTex = new THREE.CanvasTexture(this._tipCanvas);
    this._tipTex.colorSpace = THREE.SRGBColorSpace;
    this.xrTip = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._tipTex, depthTest: false, transparent: true }));
    this.xrTip.scale.set(0.48, 0.09, 1);
    this.xrTip.renderOrder = 20;
    this.xrTip.visible = false;
    engine.scene.add(this.xrTip);
    this._tipText = '';

    input.addEventListener('action', e => this._onAction(e));
    this.hand = new Hand(engine, input, ui);
  }

  /** Ziel registrieren. Gibt das Ziel-Objekt zurück. */
  add(t) {
    t.id = ++_id;
    t.enabled = t.enabled !== false;
    t.hit = t.hit || t.object;
    t.hit.userData.target = t;
    this.targets.add(t);
    this.hitObjects.push(t.hit);
    return t;
  }

  remove(t) {
    if (!t || !this.targets.has(t)) return;
    this.targets.delete(t);
    const i = this.hitObjects.indexOf(t.hit);
    if (i >= 0) this.hitObjects.splice(i, 1);
    if (this.hover === t) this._setHover(null);
  }

  clear() {
    this.targets.clear();
    this.hitObjects.length = 0;
    this.blockers.length = 0;
    this.hover = null;
    this.hoverByCtrl.clear();
    this.highlights.forEach(h => (h.visible = false));
    this.xrTip.visible = false;
    this.onAction = null;
    this.ui.setTooltip(null);
    this.hand.clear();
  }

  addBlocker(obj) { this.blockers.push(obj); obj.userData.blocker = true; }

  /** unsichtbare Trefferbox erzeugen (für Fächer, Behälter, Knöpfe …) */
  static hitBox(w, h, d) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: 0xff00ff }));
    m.visible = false;
    m.userData.isHitBox = true;
    return m;
  }

  _raySource(ctrl) {
    if (ctrl) {
      ctrl.ray.updateMatrixWorld();
      _m4.identity().extractRotation(ctrl.ray.matrixWorld);
      _org.setFromMatrixPosition(ctrl.ray.matrixWorld);
      _dir.set(0, 0, -1).applyMatrix4(_m4).normalize();
    } else {
      this.engine.camera.getWorldPosition(_org);
      this.engine.camera.getWorldDirection(_dir);
    }
    this.raycaster.set(_org, _dir);
    this.raycaster.far = 12;
    return this.raycaster;
  }

  /** liefert {target, hit} unter dem Strahl */
  pick(ctrl = null) {
    if (!this.enabled) return null;
    const rc = this._raySource(ctrl);
    const objs = this.blockers.length ? this.hitObjects.concat(this.blockers) : this.hitObjects;
    const hits = rc.intersectObjects(objs, true);
    const maxD = ctrl ? this.xrMaxDist : this.defaultMaxDist;
    // Kandidaten entlang des Strahls sammeln (bis zum ersten Blocker); höchste Priorität gewinnt,
    // bei Gleichstand der nächstgelegene. So kann z. B. ein Wagen (Priorität 0) nicht das Fach dahinter verdecken.
    let best = null, firstFar = null, firstHit = null;
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.target && !o.userData.blocker) o = o.parent;
      if (!o) continue;
      if (!firstHit) firstHit = h;
      if (o.userData.blocker) break;
      const t = o.userData.target;
      if (!t.enabled || (t.visibleCheck && !t.visibleCheck())) continue;
      const lim = ctrl ? (t.maxDistXR || maxD) : (t.maxDist || maxD);
      if (h.distance > lim) { if (!firstFar) firstFar = { target: null, hit: h, tooFar: t }; continue; }
      const pr = typeof t.priority === 'function' ? t.priority() : (t.priority ?? 1);
      if (!best || pr > best.pr) best = { target: t, hit: h, pr };
    }
    if (best) return best;
    if (firstFar) return firstFar;
    return firstHit ? { target: null, hit: firstHit, blocked: true } : null;
  }

  update() {
    const xr = this.engine.isXR;
    if (!xr) {
      const res = this.pick(null);
      this._setHover(res && res.target, res, 0);
      if (this.highlights[1].visible) this.highlights[1].visible = false;
      if (this.highlights[2].visible) this.highlights[2].visible = false;
      this.xrTip.visible = false;
    } else {
      this.ui.setTooltip(null);
      this.highlights[0].visible = false;
      let tipShown = false;
      this.input.controllers.forEach((c, i) => {
        if (!c.source) { this.highlights[i + 1].visible = false; return; }
        const res = this.pick(c);
        const t = res && res.target;
        this.hoverByCtrl.set(c, t || null);
        const hl = this.highlights[i + 1];
        this._placeHighlight(hl, t);
        // Strahl-Länge / Punkt
        const d = res && res.hit ? res.hit.distance : 3;
        c.line.scale.z = Math.min(d, 3);
        c.line.material.color.set(t ? 0xf5a524 : 0xffffff);
        c.line.material.opacity = t ? 0.95 : 0.4;
        c.dot.visible = !!(res && res.hit);
        if (res && res.hit) c.dot.position.set(0, 0, -d);
        if (t && !tipShown && (c === this.input.lastController || !this.input.lastController || !this.hoverByCtrl.get(this.input.lastController))) {
          tipShown = true;
          this._showXRTip(t, res.hit.point);
        }
      });
      if (!tipShown) this.xrTip.visible = false;
    }
  }

  _setHover(t, res) {
    if (t !== this.hover) {
      if (this.hover && this.hover.onHover) this.hover.onHover(false);
      this.hover = t;
      if (t && t.onHover) t.onHover(true);
    }
    this._placeHighlight(this.highlights[0], t);
    if (t) {
      const label = typeof t.label === 'function' ? t.label() : t.label;
      const sub = typeof t.sub === 'function' ? t.sub() : t.sub;
      this.ui.setTooltip(label, sub, t.kind === 'ok');
    } else if (res && res.tooFar) {
      this.ui.setTooltip('Zu weit entfernt', 'Geh näher heran');
    } else {
      this.ui.setTooltip(null);
    }
  }

  _placeHighlight(hl, t) {
    if (!t || t.highlight === false) { hl.visible = false; return; }
    const obj = t.highlightObject || t.hit;
    obj.updateWorldMatrix(true, false);
    if (obj.geometry) {
      if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
      const bb = obj.geometry.boundingBox;
      bb.getSize(_size); bb.getCenter(_ctr);
      _size.multiplyScalar(1.04).addScalar(0.01);
      hl.matrix.copy(obj.matrixWorld).multiply(_m4.makeTranslation(_ctr.x, _ctr.y, _ctr.z)).multiply(new THREE.Matrix4().makeScale(_size.x, _size.y, _size.z));
    } else {
      _box.setFromObject(obj);
      _box.getSize(_size).addScalar(0.02); _box.getCenter(_ctr);
      hl.matrix.makeTranslation(_ctr.x, _ctr.y, _ctr.z).multiply(_m4.makeScale(_size.x, _size.y, _size.z));
    }
    hl.material.color.set(t.color != null ? t.color : 0xf5a524);
    hl.visible = true;
  }

  _showXRTip(t, point) {
    const label = typeof t.label === 'function' ? t.label() : t.label;
    const sub = typeof t.sub === 'function' ? t.sub() : t.sub;
    const text = (label || '') + '|' + (sub || '');
    if (text !== this._tipText) {
      this._tipText = text;
      const c = this._tipCanvas, g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      g.font = '600 54px Inter, system-ui, sans-serif';
      const w1 = g.measureText(label || '').width;
      g.font = '400 40px Inter, system-ui, sans-serif';
      const w2 = sub ? g.measureText(sub).width : 0;
      const w = Math.min(c.width - 8, Math.max(w1, w2) + 60);
      const x0 = (c.width - w) / 2;
      g.fillStyle = 'rgba(10,14,19,0.88)';
      roundRect(g, x0, 8, w, sub ? 176 : 100, 26); g.fill();
      g.strokeStyle = 'rgba(245,165,36,0.9)'; g.lineWidth = 4; g.stroke();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '600 54px Inter, system-ui, sans-serif';
      g.fillText(label || '', c.width / 2, 60, c.width - 40);
      if (sub) { g.fillStyle = '#aab6c4'; g.font = '400 40px Inter, system-ui, sans-serif'; g.fillText(sub, c.width / 2, 132, c.width - 40); }
      this._tipTex.needsUpdate = true;
    }
    const cam = this.engine.camera.getWorldPosition(_ctr);
    this.xrTip.position.copy(point).lerp(cam, 0.18);
    this.xrTip.position.y += 0.1;
    this.xrTip.visible = true;
  }

  _onAction(e) {
    if (!this.enabled) return;
    const a = e.action;
    if (!['primary', 'secondary', 'grab', 'confirm'].includes(a)) {
      if (this.onAction) this.onAction(a, null, e, null);
      return;
    }
    let res = null;
    if (e.source === 'xr') res = this.pick(e.controller);
    else if (e.source === 'mouse' || e.source === 'key') res = this.input.lookActive || this.engine.isXR ? this.pick(null) : null;
    const t = res && res.target;
    const handler = t && (a === 'primary' ? t.onPrimary : a === 'secondary' ? t.onSecondary : a === 'grab' ? (t.onGrab || t.onPrimary) : t.onConfirm);
    if (handler) {
      handler.call(t, e, res.hit);
      if (e.controller) this.input.pulse(e.controller, 0.35, 30);
    } else if (this.onAction) {
      this.onAction(a, t || null, e, res && res.hit);
    }
  }
}

/** Ware in der Hand des Pickers */
export class Hand {
  constructor(engine, input, ui) {
    this.engine = engine;
    this.input = input;
    this.ui = ui;
    this.item = null;   // { sku, name, count, from }
    this.anchor = new THREE.Group();
    this.anchor.name = 'hand-anchor';
    this.desktopPose = { pos: new THREE.Vector3(0.24, -0.23, -0.46), rot: new THREE.Euler(0.15, -0.5, 0.08) };
    engine.camera.add(this.anchor);
    this._placeDesktop();
    this.visuals = [];
    this.factory = null;
    engine.addEventListener('xrstart', () => this._reparent());
    engine.addEventListener('xrend', () => this._reparent());
    input.addEventListener('controllerconnected', () => this._reparent());
  }

  _placeDesktop() {
    this.anchor.position.copy(this.desktopPose.pos);
    this.anchor.rotation.copy(this.desktopPose.rot);
    this.anchor.scale.setScalar(1);
  }

  _reparent() {
    if (this.engine.isXR) {
      const c = this.input.controller('right') || this.input.controllers[0];
      if (c) { c.grip.add(this.anchor); this.anchor.position.set(0, -0.02, -0.11); this.anchor.rotation.set(-0.6, 0, 0); }
    } else {
      this.engine.camera.add(this.anchor);
      this._placeDesktop();
    }
  }

  get empty() { return !this.item || this.item.count <= 0; }
  get sku() { return this.item ? this.item.sku : null; }
  get count() { return this.item ? this.item.count : 0; }

  /**
   * Ware aufnehmen. makeMesh: () => Object3D (wird auf ~maxSize skaliert)
   */
  take(sku, name, n = 1, makeMesh = null, extra = {}) {
    if (this.item && this.item.sku !== sku) return false;
    if (!this.item) this.item = { sku, name, count: 0, makeMesh, ...extra };
    this.item.count += n;
    this._refresh();
    return true;
  }

  /** n Stück abgeben; gibt Anzahl zurück */
  give(n = Infinity) {
    if (!this.item) return 0;
    const k = Math.min(n, this.item.count);
    this.item.count -= k;
    if (this.item.count <= 0) this.item = null;
    this._refresh();
    return k;
  }

  clear() { this.item = null; this._refresh(); }

  _refresh() {
    for (const v of this.visuals) this.anchor.remove(v);
    this.visuals = [];
    const it = this.item;
    if (it && it.makeMesh) {
      const shown = Math.min(it.count, 3);
      for (let i = 0; i < shown; i++) {
        const m = it.makeMesh();
        fitObject(m, it.handSize || 0.16);
        m.position.x += i * 0.025; m.position.y += i * 0.03; m.position.z -= i * 0.015;
        m.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
        this.anchor.add(m);
        this.visuals.push(m);
      }
    }
    this.ui.setHand(it ? `<b>${it.count} ×</b> ${it.name}` : null);
    this.engine.dispatchEvent({ type: 'handchange', item: it });
  }
}

/** Objekt auf eine maximale Kantenlänge skalieren und um den Mittelpunkt zentrieren */
export function fitObject(obj, maxSize) {
  obj.updateMatrixWorld(true);
  _box.setFromObject(obj);
  _box.getSize(_size);
  const s = maxSize / Math.max(_size.x, _size.y, _size.z, 1e-4);
  obj.scale.multiplyScalar(s);
  obj.updateMatrixWorld(true);
  _box.setFromObject(obj);
  _box.getCenter(_ctr);
  obj.position.sub(_ctr);
  return obj;
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
