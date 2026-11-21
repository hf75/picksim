// Prozedurale Geräusche mit der Web Audio API (keine Audiodateien nötig) + Sprachausgabe.
import * as THREE from 'three';

const _p = new THREE.Vector3();
const _f = new THREE.Vector3();
const _u = new THREE.Vector3();

export class AudioFX {
  constructor(engine) {
    this.engine = engine;
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.8;
    this.sources = new Set();   // positionale Dauerquellen
    this.ambientNodes = [];
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    engine.renderer.xr.addEventListener('sessionstart', unlock);
    engine.onUpdate(dt => this._updateListener(dt), 90);
    this.voice = null;
    if ('speechSynthesis' in window) {
      const pick = () => {
        const vs = speechSynthesis.getVoices();
        this.voice = vs.find(v => /de(-|_)DE/i.test(v.lang) && /Google|Microsoft|Natural/i.test(v.name)) || vs.find(v => /^de/i.test(v.lang)) || null;
      };
      pick();
      speechSynthesis.onvoiceschanged = pick;
    }
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? this.volume : 0;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      this.master.connect(comp); comp.connect(this.ctx.destination);
      this.noiseBuf = this._makeNoise();
      if (this._pendingAmbient) { const a = this._pendingAmbient; this._pendingAmbient = null; this.ambient(a); }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(v) { this.enabled = v; if (this.master) this.master.gain.value = v ? this.volume : 0; }

  _makeNoise() {
    const len = this.ctx.sampleRate * 2;
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  _env(gainNode, t, a, peak, dec) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + a);
    g.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }

  _tone(freq, type, start, dur, peak = 0.2, dest = this.master, slideTo = null) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, start);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    this._env(g, start, 0.005, peak, dur);
    o.connect(g); g.connect(dest);
    o.start(start); o.stop(start + dur + 0.05);
  }

  _noise(start, dur, peak, filterType, freq, q = 1, dest = this.master) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; s.loop = true;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    this._env(g, start, 0.004, peak, dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(start, Math.random()); s.stop(start + dur + 0.05);
  }

  /** kurze Effekte: scan, ok, error, pick, put, step, click, complete, alarm, light */
  play(name, opts = {}) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + 0.005;
    const dest = opts.position ? this._panner(opts.position) : this.master;
    switch (name) {
      case 'scan': this._tone(2050, 'square', t, 0.07, 0.09, dest); break;
      case 'ok': this._tone(880, 'sine', t, 0.12, 0.18, dest); this._tone(1320, 'sine', t + 0.09, 0.18, 0.16, dest); break;
      case 'error': this._tone(160, 'square', t, 0.18, 0.12, dest); this._tone(130, 'square', t + 0.2, 0.25, 0.12, dest); break;
      case 'warn': this._tone(660, 'triangle', t, 0.15, 0.15, dest); this._tone(520, 'triangle', t + 0.16, 0.2, 0.15, dest); break;
      case 'pick': this._noise(t, 0.08, 0.25, 'bandpass', 2400, 0.8, dest); this._tone(320, 'sine', t, 0.06, 0.05, dest); break;
      case 'put': this._noise(t, 0.12, 0.35, 'lowpass', 500, 0.7, dest); this._tone(140, 'sine', t, 0.15, 0.15, dest, 70); break;
      case 'step': this._noise(t, 0.07, 0.10 + Math.random() * 0.05, 'lowpass', 380 + Math.random() * 200, 0.6, dest); break;
      case 'click': this._noise(t, 0.025, 0.25, 'highpass', 3000, 0.7, dest); break;
      case 'paper': this._noise(t, 0.25, 0.16, 'bandpass', 3800, 0.4, dest); break;
      case 'printer': for (let i = 0; i < 14; i++) this._noise(t + i * 0.07, 0.04, 0.12, 'bandpass', 1800 + (i % 3) * 400, 2, dest); break;
      case 'complete': [523, 659, 784, 1046].forEach((f, i) => this._tone(f, 'sine', t + i * 0.11, 0.3, 0.14, dest)); break;
      case 'light': this._tone(1500, 'sine', t, 0.05, 0.06, dest); break;
      case 'button': this._tone(1000, 'square', t, 0.03, 0.06, dest); this._noise(t, 0.02, 0.15, 'highpass', 2500, 1, dest); break;
      case 'alarm': for (let i = 0; i < 3; i++) this._tone(980, 'square', t + i * 0.32, 0.18, 0.1, dest); break;
      case 'whoosh': this._noise(t, 0.5, 0.12, 'bandpass', 900, 0.5, dest); break;
      default: break;
    }
  }

  _panner(pos) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 1.5; p.rolloffFactor = 1.1; p.maxDistance = 60;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    p.connect(this.master);
    setTimeout(() => p.disconnect(), 3000);
    return p;
  }

  /** Dauerhafte positionale Quelle (z. B. Stapler-Warnton, Roboter-Surren). Gibt Steuerobjekt zurück. */
  loop(kind, object3D, opts = {}) {
    const src = { kind, object3D, opts, nodes: null, gain: opts.gain ?? 0.2, active: true, _beepT: 0 };
    this.sources.add(src);
    return {
      setGain: v => { src.gain = v; if (src.nodes) src.nodes.g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1); },
      setRate: v => { src.rate = v; if (src.nodes && src.nodes.o) src.nodes.o.frequency.setTargetAtTime(src.opts.freq * v, this.ctx.currentTime, 0.1); },
      stop: () => this._stopSource(src),
      src,
    };
  }

  _startSource(src) {
    const c = this.ctx;
    const pan = c.createPanner();
    pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = src.opts.ref || 2; pan.rolloffFactor = 1.2; pan.maxDistance = 80;
    const g = c.createGain(); g.gain.value = src.gain;
    g.connect(pan); pan.connect(this.master);
    const nodes = { pan, g };
    if (src.kind === 'motor') {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = src.opts.freq || 110;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = src.opts.cutoff || 600;
      const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
      const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1200; nf.Q.value = 0.5;
      const ng = c.createGain(); ng.gain.value = 0.25;
      o.connect(f); f.connect(g); n.connect(nf); nf.connect(ng); ng.connect(g);
      o.start(); n.start();
      nodes.o = o; nodes.n = n;
    } else if (src.kind === 'hum') {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = src.opts.freq || 100;
      const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = (src.opts.freq || 100) * 2;
      const g2 = c.createGain(); g2.gain.value = 0.3;
      o.connect(g); o2.connect(g2); g2.connect(g);
      o.start(); o2.start();
      nodes.o = o; nodes.o2 = o2;
    }
    src.nodes = nodes;
  }

  _stopSource(src) {
    src.active = false;
    this.sources.delete(src);
    if (src.nodes) {
      try { src.nodes.o && src.nodes.o.stop(); src.nodes.o2 && src.nodes.o2.stop(); src.nodes.n && src.nodes.n.stop(); } catch (e) { /* ignore */ }
      src.nodes.pan.disconnect();
    }
  }

  stopAll() {
    for (const s of [...this.sources]) this._stopSource(s);
    this.ambient(null);
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  /** Hintergrundklang: 'old' | 'hall' | 'modern' | 'robot' | null */
  ambient(kind) {
    if (!this.ctx) { this._pendingAmbient = kind; return; }
    for (const n of this.ambientNodes) { try { n.stop ? n.stop() : n.disconnect(); } catch (e) { /* ignore */ } }
    this.ambientNodes = [];
    if (!kind) return;
    const c = this.ctx;
    const g = c.createGain(); g.gain.value = 0; g.connect(this.master);
    g.gain.setTargetAtTime(kind === 'old' ? 0.05 : 0.07, c.currentTime, 1.5);
    // Raumrauschen (Lüftung)
    const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true; n.playbackRate.value = 0.5;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = kind === 'robot' ? 420 : 260;
    n.connect(f); f.connect(g); n.start();
    this.ambientNodes.push(n, g);
    // Netzbrummen der Leuchtstoffröhren
    if (kind === 'old' || kind === 'hall') {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 100;
      const og = c.createGain(); og.gain.value = kind === 'old' ? 0.35 : 0.12;
      o.connect(og); og.connect(g); o.start();
      this.ambientNodes.push(o);
    }
    if (kind === 'robot' || kind === 'modern') {
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = 58;
      const og = c.createGain(); og.gain.value = 0.25;
      o.connect(og); og.connect(g); o.start();
      this.ambientNodes.push(o);
    }
  }

  /** Text vorlesen (Pick-by-Voice). Gibt Promise zurück, wenn fertig. */
  speak(text, { rate = 1.05, pitch = 1.0, interrupt = true } = {}) {
    if (!('speechSynthesis' in window) || !this.enabled) return Promise.resolve();
    if (interrupt) speechSynthesis.cancel();
    return new Promise(res => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'de-DE';
      if (this.voice) u.voice = this.voice;
      u.rate = rate; u.pitch = pitch; u.volume = this.volume;
      u.onend = res; u.onerror = res;
      speechSynthesis.speak(u);
    });
  }

  _updateListener(dt = 1 / 60) {
    if (!this.ctx) return;
    const cam = this.engine.camera;
    cam.getWorldPosition(_p);
    cam.getWorldDirection(_f);
    _u.set(0, 1, 0).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    const L = this.ctx.listener;
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setTargetAtTime(_p.x, t, 0.02); L.positionY.setTargetAtTime(_p.y, t, 0.02); L.positionZ.setTargetAtTime(_p.z, t, 0.02);
      L.forwardX.setTargetAtTime(_f.x, t, 0.02); L.forwardY.setTargetAtTime(_f.y, t, 0.02); L.forwardZ.setTargetAtTime(_f.z, t, 0.02);
      L.upX.setTargetAtTime(_u.x, t, 0.02); L.upY.setTargetAtTime(_u.y, t, 0.02); L.upZ.setTargetAtTime(_u.z, t, 0.02);
    } else if (L.setPosition) { L.setPosition(_p.x, _p.y, _p.z); L.setOrientation(_f.x, _f.y, _f.z, _u.x, _u.y, _u.z); }
    for (const s of this.sources) {
      if (!s.active) continue;
      if (!s.nodes) this._startSource(s);
      s.object3D.getWorldPosition(_p);
      const pn = s.nodes.pan;
      if (pn.positionX) { pn.positionX.value = _p.x; pn.positionY.value = _p.y; pn.positionZ.value = _p.z; }
      if (s.kind === 'beeper') {
        // periodischer Rückfahr-/Warnton
        s._beepT -= dt;
        if (s._beepT <= 0 && s.on !== false) {
          s._beepT = s.opts.interval || 0.9;
          const t = this.ctx.currentTime;
          this._tone(s.opts.freq || 1150, 'square', t, 0.22, s.gain, pn);
        }
      }
    }
  }
}
