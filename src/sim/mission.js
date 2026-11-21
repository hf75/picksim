// Missions-Statistik & Kennzahlen (KPIs) + Speicherung der Ergebnisse im Browser.
const KEY = 'picksim.results.v1';

export const ERROR_TEXT = {
  wrong_item: 'Falscher Artikel',
  wrong_qty: 'Falsche Menge',
  missing: 'Position fehlt',
  extra: 'Artikel nicht bestellt',
  wrong_location: 'Falscher Lagerplatz gescannt',
  wrong_tote: 'Falscher Behälter',
  wrong_bin: 'Falsches Fach',
  safety: 'Sicherheitsverstoß',
  damaged: 'Beschädigte Ware weitergegeben',
  packaging: 'Ungeeignete Verpackung',
  order: 'Falsche Reihenfolge',
};

export class Mission {
  constructor(ctx, { levelId, title, targetTime = 600, expectedLines = 0 }) {
    this.ctx = ctx;
    this.levelId = levelId;
    this.title = title;
    this.targetTime = targetTime;
    this.expectedLines = expectedLines;
    this.lines = 0;        // erledigte Auftragspositionen
    this.units = 0;        // entnommene Einheiten
    this.scans = 0;
    this.errors = [];      // {code, text, detail, t}
    this.running = false;
    this.t0 = 0; this.t1 = 0;
    this.distance0 = 0; this.walk0 = 0;
    this.notes = [];
  }

  start() {
    this.running = true;
    this.t0 = performance.now();
    this._pausedAt = null;
    this.ctx.player.resetStats();
  }

  /** Zeit anhalten (z. B. während Info-Tafeln gelesen werden) */
  pause() { if (this.running && this._pausedAt == null) { this._pausedAt = performance.now(); this._walkAtPause = this.ctx.player.walkTime; } }
  resume() {
    if (this._pausedAt != null) {
      this.t0 += performance.now() - this._pausedAt;
      this._pausedAt = null;
      this.ctx.player.walkTime = this._walkAtPause ?? this.ctx.player.walkTime;
    }
  }

  get elapsed() {
    const now = this._pausedAt != null ? this._pausedAt : (this.running ? performance.now() : this.t1);
    return (now - this.t0) / 1000;
  }

  pick(n = 1) { this.units += n; }
  line(n = 1) { this.lines += n; }
  scan() { this.scans++; }
  error(code, detail = '', { silent = false } = {}) {
    const e = { code, text: ERROR_TEXT[code] || code, detail, t: this.elapsed };
    this.errors.push(e);
    if (!silent) this.ctx.audio.play('error');
    return e;
  }

  /** Mission beenden → Ergebnisobjekt */
  finish(extra = {}) {
    this.resume();
    if (this.running) { this.running = false; this.t1 = performance.now(); }
    const time = Math.max(1, this.elapsed);
    const p = this.ctx.player;
    const errorCount = this.errors.length;
    const lines = this.lines;
    const res = {
      levelId: this.levelId,
      title: this.title,
      date: new Date().toISOString(),
      time,
      lines,
      units: this.units,
      scans: this.scans,
      errors: this.errors,
      errorCount,
      errorRate: errorCount / Math.max(this.expectedLines || (lines + errorCount), 1),
      distance: p.distance,
      walkShare: Math.min(1, p.walkTime / time),
      linesPerHour: lines / (time / 3600),
      unitsPerHour: this.units / (time / 3600),
      targetTime: this.targetTime,
      ...extra,
    };
    const fast = time <= this.targetTime, okish = time <= this.targetTime * 1.6;
    res.stars = errorCount === 0 && fast ? 3 : (errorCount <= 1 && okish ? 2 : 1);
    res.score = Math.max(0, Math.round(lines * 100 + this.units * 10 - errorCount * 120 - Math.max(0, time - this.targetTime) * 1.5));
    saveResult(res);
    return res;
  }
}

export function loadResults() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
}

export function saveResult(res) {
  try {
    const all = loadResults();
    const slim = { ...res, errors: res.errors.map(e => ({ code: e.code, text: e.text, detail: e.detail })) };
    const cur = all[res.levelId] || { runs: 0 };
    cur.runs = (cur.runs || 0) + 1;
    cur.last = slim;
    if (!cur.best || slim.score > cur.best.score) cur.best = slim;
    all[res.levelId] = cur;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (e) { /* privat/gesperrt */ }
}

export function fmtTime(s) {
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function fmtNum(n, d = 0) { return Number(n).toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d }); }
