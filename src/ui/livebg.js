// Interactive backgrounds: the same particle engine as PC Smult's livebg.py (same settings, same share codes),
// drawn on a canvas behind everything. Fingers work like the mouse: drag = move, tap = click.

export const TYPES = {
  constellation: 'Constellation (dots that join up)', stars: 'Starfield (moves with your finger)', snow: 'Snow', rain: 'Rain',
  bubbles: 'Bubbles (tap to pop)', fireflies: 'Fireflies', aurora: 'Aurora (follows your finger)',
};
export const MOUSE = { repel: 'Pushes them away', attract: 'Pulls them in', follow: 'They follow it', none: 'Nothing' };
export const CLICK = { burst: 'Burst of sparks', ripple: 'Ripple', none: 'Nothing' };
export const DEFAULT = { type: 'constellation', c1: '', c2: '', density: 45, speed: 40, size: 40, mouse: 'repel', click: 'burst' };
export const PRESETS = {
  'Neon Web': { ...DEFAULT },
  'Deep Space': { type: 'stars', c1: '#ffffff', c2: '#9ad8ff', density: 60, speed: 30, size: 35, mouse: 'follow', click: 'ripple' },
  'Cozy Snow': { type: 'snow', c1: '#ffffff', c2: '#cfe8ff', density: 50, speed: 30, size: 45, mouse: 'repel', click: 'burst' },
  'Rainy Window': { type: 'rain', c1: '#9ec9ff', c2: '#5a7dbf', density: 55, speed: 65, size: 35, mouse: 'repel', click: 'ripple' },
  'Bubble Pop': { type: 'bubbles', c1: '', c2: '', density: 35, speed: 30, size: 60, mouse: 'repel', click: 'burst' },
  'Fireflies': { type: 'fireflies', c1: '#ffe27a', c2: '#9cff7a', density: 40, speed: 25, size: 40, mouse: 'attract', click: 'burst' },
  'Aurora': { type: 'aurora', c1: '', c2: '', density: 50, speed: 30, size: 60, mouse: 'follow', click: 'ripple' },
};

export function clean(d) {
  const out = { ...DEFAULT };
  if (d && typeof d === 'object') {
    if (d.type in TYPES) out.type = d.type;
    for (const k of ['c1', 'c2']) { const v = String(d[k] || ''); out[k] = /^#[0-9a-fA-F]{6}$/.test(v) ? v : ''; }
    for (const k of ['density', 'speed', 'size']) { const v = parseInt(d[k], 10); if (!Number.isNaN(v)) out[k] = Math.max(1, Math.min(100, v)); }
    if (d.mouse in MOUSE) out.mouse = d.mouse;
    if (d.click in CLICK) out.click = d.click;
  }
  return out;
}

const PREFIX = 'SMULTBG1:';
export function toCode(cfg) {
  const s = JSON.stringify(clean(cfg));
  return PREFIX + btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromCode(text) {
  const t = String(text || '').trim();
  if (!t.startsWith(PREFIX)) return null;
  try {
    let raw = t.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    while (raw.length % 4) raw += '=';
    return clean(JSON.parse(decodeURIComponent(escape(atob(raw)))));
  } catch (e) { return null; }
}

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
};

export class Engine {
  constructor(cfg, accent, accent2) {
    this.cfg = clean(cfg);
    this.w = this.h = 0;
    this.mouse = null; this.mouseT = 0;
    this.ps = []; this.fx = [];
    this.last = performance.now() / 1000;
    this.setColors(accent, accent2);
  }
  setColors(accent, accent2) { this.c1 = this.cfg.c1 || accent; this.c2 = this.cfg.c2 || accent2; }
  resize(w, h) {
    if ((w === this.w && h === this.h) || w < 10 || h < 10) return;
    this.w = w; this.h = h;
    this.ps = Array.from({ length: this.count() }, () => this.spawn(true));
  }
  count() {
    const d = this.cfg.density / 100, area = (this.w * this.h) / (1280 * 800);
    const base = { constellation: 110, stars: 260, snow: 220, rain: 260, bubbles: 45, fireflies: 70, aurora: 0 }[this.cfg.type];
    // phones are smaller and slower: a bit fewer, but never empty
    return Math.floor(base * (0.15 + d * 1.25) * Math.max(0.35, Math.min(2.2, area)));
  }
  spawn(anywhere = false) {
    const t = this.cfg.type, r = Math.random, sz = 0.4 + this.cfg.size / 50;
    const p = { x: r() * this.w, y: anywhere ? r() * this.h : -20, vx: 0, vy: 0, s: sz, c: r() < 0.6 ? 0 : 1, ph: r() * 6.283 };
    if (t === 'constellation') { const a = r() * 6.283; p.vx = Math.cos(a) * 25; p.vy = Math.sin(a) * 25; p.s = sz * (1.2 + r() * 1.6); }
    else if (t === 'stars') { p.z = 0.15 + r() * 0.85; p.s = sz * (0.6 + p.z * 1.8); }
    else if (t === 'snow') { p.vy = 25 + r() * 40; p.s = sz * (1.2 + r() * 3.2); }
    else if (t === 'rain') { p.vy = 520 + r() * 380; p.vx = -40; p.s = sz * (0.8 + r()); }
    else if (t === 'bubbles') { if (!anywhere) p.y = this.h + 40; p.vy = -(18 + r() * 38); p.s = sz * (6 + r() * 18); }
    else if (t === 'fireflies') { const a = r() * 6.283; p.vx = Math.cos(a) * 18; p.vy = Math.sin(a) * 18; p.s = sz * (1.5 + r() * 2.5); }
    return p;
  }
  move(x, y) { this.mouse = { x, y }; this.mouseT = performance.now() / 1000; }
  leave() { this.mouse = null; }
  click(x, y) {
    const kind = this.cfg.click;
    if (kind === 'none') return;
    if (this.cfg.type === 'bubbles') {
      for (const p of this.ps) if ((p.x - x) ** 2 + (p.y - y) ** 2 < (p.s + 10) ** 2) { this.fx.push({ k: 'pop', x: p.x, y: p.y, age: 0, s: p.s }); Object.assign(p, this.spawn()); }
    }
    if (kind === 'burst') {
      const sparks = [];
      for (let i = 0; i < 26; i++) { const a = (i / 26) * 6.283 + Math.random() * 0.2, v = 120 + Math.random() * 220; sparks.push([x, y, Math.cos(a) * v, Math.sin(a) * v]); }
      this.fx.push({ k: 'burst', x, y, age: 0, sparks });
    } else if (kind === 'ripple') this.fx.push({ k: 'ripple', x, y, age: 0 });
    this.fx = this.fx.slice(-12);
  }
  step() {
    const now = performance.now() / 1000, dt = Math.min(0.08, now - this.last);
    this.last = now;
    if (!this.w) return;
    const sp = 0.25 + this.cfg.speed / 40, t = this.cfg.type, mode = this.cfg.mouse, w = this.w, h = this.h, rad = 150;
    const m = this.mouse && now - this.mouseT < 6 ? this.mouse : null;
    for (const p of this.ps) {
      if (m && mode !== 'none' && t !== 'stars') {
        const dx = p.x - m.x, dy = p.y - m.y, d2 = dx * dx + dy * dy;
        if (d2 < rad * rad && d2 > 1) {
          const d = Math.sqrt(d2), f = 1 - d / rad;
          if (mode === 'repel') { p.x += (dx / d) * f * 220 * dt; p.y += (dy / d) * f * 220 * dt; }
          else if (mode === 'attract') { p.x -= (dx / d) * f * 160 * dt; p.y -= (dy / d) * f * 160 * dt; }
          else if (mode === 'follow') { p.vx += (-dx / d) * 30 * dt; p.vy += (-dy / d) * 30 * dt; }
        }
      }
      if (t === 'stars') continue;
      if (t === 'snow') p.x += (Math.sin(now * 0.8 + p.ph) * 18 + p.vx) * sp * dt;
      else if (t === 'fireflies') {
        p.vx = Math.max(-30, Math.min(30, p.vx + (Math.random() - 0.5) * 40 * dt));
        p.vy = Math.max(-30, Math.min(30, p.vy + (Math.random() - 0.5) * 40 * dt));
        p.x += p.vx * sp * dt;
      } else p.x += p.vx * sp * dt;
      p.y += p.vy * sp * dt;
      if (t === 'snow' || t === 'rain') { if (p.y > h + 30 || p.x < -40 || p.x > w + 40) Object.assign(p, this.spawn()); }
      else if (t === 'bubbles') { p.x += Math.sin(now + p.ph) * 12 * dt; if (p.y < -p.s * 2 - 10) Object.assign(p, this.spawn()); }
      else {
        if (p.x < -20) p.x += w + 40; if (p.x > w + 20) p.x -= w + 40;
        if (p.y < -20) p.y += h + 40; if (p.y > h + 20) p.y -= h + 40;
        if (t === 'constellation' && Math.hypot(p.vx, p.vy) > 40) { p.vx *= 0.97; p.vy *= 0.97; }
      }
    }
    for (const f of this.fx) {
      f.age += dt;
      if (f.k === 'burst') for (const s of f.sparks) { s[0] += s[2] * dt; s[1] += s[3] * dt; s[2] *= 0.94; s[3] = s[3] * 0.94 + 160 * dt; }
    }
    this.fx = this.fx.filter((f) => f.age < 1.2);
  }
  col(c, a) { return rgba(c === 0 ? this.c1 : this.c2, a); }
  paint(g) {
    const t = this.cfg.type, w = this.w, h = this.h, now = performance.now() / 1000;
    if (t === 'aurora') this.aurora(g, w, h, now);
    else if (t === 'constellation') {
      const pts = this.ps, link = 130 * (0.7 + this.cfg.size / 120), l2 = link * link;
      const cells = new Map();
      pts.forEach((p, i) => { const k = `${Math.floor(p.x / link)},${Math.floor(p.y / link)}`; (cells.get(k) || cells.set(k, []).get(k)).push(i); });
      g.lineWidth = 1;
      for (const [key, idx] of cells) {
        const [cx, cy] = key.split(',').map(Number);
        let near = [];
        for (const [ox, oy] of [[1, -1], [1, 0], [1, 1], [0, 1]]) near = near.concat(cells.get(`${cx + ox},${cy + oy}`) || []);
        idx.forEach((i, n) => {
          const a = pts[i];
          for (const j of idx.slice(n + 1).concat(near)) {
            const b = pts[j], d2 = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
            if (d2 < l2) { g.strokeStyle = this.col(a.c, 0.47 * (1 - d2 / l2)); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
          }
        });
      }
      const m = this.mouse;
      if (m && this.cfg.mouse !== 'none') for (const a of pts) {
        const d2 = (a.x - m.x) ** 2 + (a.y - m.y) ** 2;
        if (d2 < l2 * 1.6) { g.strokeStyle = this.col(a.c, 0.63 * (1 - d2 / (l2 * 1.6))); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(m.x, m.y); g.stroke(); }
      }
      for (const p of pts) { g.fillStyle = this.col(p.c, 0.82); g.beginPath(); g.arc(p.x, p.y, p.s, 0, 6.283); g.fill(); }
    } else if (t === 'stars') {
      const m = this.mouse;
      const ox = m ? m.x / Math.max(1, w) - 0.5 : Math.sin(now * 0.05) * 0.2, oy = m ? m.y / Math.max(1, h) - 0.5 : Math.cos(now * 0.04) * 0.2;
      const drift = now * (4 + this.cfg.speed * 0.6);
      for (const p of this.ps) {
        const z = p.z, x = (((p.x - ox * 90 * z + drift * z) % (w + 20)) + w + 20) % (w + 20) - 10;
        const y = (((p.y - oy * 90 * z) % (h + 20)) + h + 20) % (h + 20) - 10;
        const tw = 0.65 + 0.35 * Math.sin(now * (1.5 + z * 2) + p.ph);
        g.fillStyle = this.col(p.c, z * tw); g.beginPath(); g.arc(x, y, p.s * 0.7, 0, 6.283); g.fill();
      }
    } else if (t === 'snow') {
      for (const p of this.ps) { g.fillStyle = this.col(p.c, 0.78); g.beginPath(); g.arc(p.x, p.y, p.s, 0, 6.283); g.fill(); }
    } else if (t === 'rain') {
      g.lineCap = 'round';
      for (const p of this.ps) { g.strokeStyle = this.col(p.c, 0.59); g.lineWidth = p.s; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + p.vx * 0.02, p.y - 12 - p.s * 6); g.stroke(); }
    } else if (t === 'bubbles') {
      for (const p of this.ps) {
        const gr = g.createRadialGradient(p.x - p.s * 0.35, p.y - p.s * 0.35, 0, p.x, p.y, p.s * 1.2);
        gr.addColorStop(0, 'rgba(255,255,255,0.43)'); gr.addColorStop(0.35, this.col(p.c, 0.24)); gr.addColorStop(1, this.col(p.c, 0.5));
        g.fillStyle = gr; g.strokeStyle = this.col(p.c, 0.59); g.lineWidth = 1.2;
        g.beginPath(); g.arc(p.x, p.y, p.s, 0, 6.283); g.fill(); g.stroke();
      }
    } else if (t === 'fireflies') {
      for (const p of this.ps) {
        const glow = 0.5 + 0.5 * Math.sin(now * 2.2 + p.ph);
        const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.s * 5);
        gr.addColorStop(0, this.col(p.c, 0.78 * glow)); gr.addColorStop(1, this.col(p.c, 0));
        g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.s * 5, 0, 6.283); g.fill();
        g.fillStyle = this.col(p.c, glow); g.beginPath(); g.arc(p.x, p.y, p.s * 0.8, 0, 6.283); g.fill();
      }
    }
    for (const f of this.fx) {
      const k = 1 - f.age / 1.2;
      if (f.k === 'burst') { g.fillStyle = this.col(0, k); for (const s of f.sparks) { g.beginPath(); g.arc(s[0], s[1], 2.4 * k + 0.6, 0, 6.283); g.fill(); } }
      else if (f.k === 'ripple') {
        g.strokeStyle = this.col(1, 0.86 * k); g.lineWidth = 2.5 * k + 0.5;
        for (let i = 0; i < 3; i++) { const r = f.age * 260 - i * 26; if (r > 0) { g.beginPath(); g.arc(f.x, f.y, r, 0, 6.283); g.stroke(); } }
      } else if (f.k === 'pop') {
        g.strokeStyle = this.col(0, 0.9 * k); g.lineWidth = 2;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * 6.283, r1 = f.s * (0.6 + f.age * 2), r2 = f.s * (0.9 + f.age * 3);
          g.beginPath(); g.moveTo(f.x + Math.cos(a) * r1, f.y + Math.sin(a) * r1); g.lineTo(f.x + Math.cos(a) * r2, f.y + Math.sin(a) * r2); g.stroke();
        }
      }
    }
  }
  aurora(g, w, h, now) {
    const sp = 0.2 + this.cfg.speed / 60, m = this.mouse;
    const mx = m ? m.x / Math.max(1, w) : 0.5 + 0.3 * Math.sin(now * 0.07);
    const bands = 3 + Math.floor(this.cfg.density / 30), thick = h * (0.12 + this.cfg.size / 400);
    for (let b = 0; b < bands; b++) {
      const c = b % 2 === 0 ? this.c1 : this.c2, base = h * (0.18 + (b * 0.62) / Math.max(1, bands)), steps = 28, top = [];
      for (let i = 0; i <= steps; i++) {
        const pull = Math.exp(-((i / steps - mx) ** 2) / 0.05) * 60 * (m ? 1 : 0.5);
        top.push([(w * i) / steps, base + Math.sin(i * 0.45 + now * sp + b * 1.7) * thick * 0.5 + Math.sin(i * 0.17 - now * sp * 0.6 + b) * thick * 0.4 - pull]);
      }
      g.beginPath(); g.moveTo(top[0][0], top[0][1]);
      for (const p of top.slice(1)) g.lineTo(p[0], p[1]);
      for (const p of top.slice().reverse()) g.lineTo(p[0], p[1] + thick);
      g.closePath();
      const gr = g.createRadialGradient(mx * w, base + thick / 2, 0, mx * w, base + thick / 2, Math.max(w, h) * 0.7);
      gr.addColorStop(0, rgba(c, 0.33)); gr.addColorStop(1, rgba(c, 0.04));
      g.fillStyle = gr; g.fill();
    }
  }
}

// a canvas running an engine (used for the background and for the maker's preview)
export function runCanvas(canvas, cfg, colors, { input = null } = {}) {
  const g = canvas.getContext('2d');
  let eng = new Engine(cfg, colors().accent, colors().accent2);
  let raf = 0, lastDraw = 0, stopped = false, frames = 0;
  const fps = 30;
  const loop = (t) => {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    if (document.hidden || t - lastDraw < 1000 / fps - 2) return;
    lastDraw = t;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    if (++frames % 30 === 0) eng.setColors(colors().accent, colors().accent2);
    eng.resize(w, h);
    eng.step();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    eng.paint(g);
  };
  raf = requestAnimationFrame(loop);
  const target = input || canvas;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const onMove = (e) => eng.move(...pos(e));
  const onDown = (e) => { const [x, y] = pos(e); eng.move(x, y); eng.click(x, y); };
  const onUp = (e) => { if (e.pointerType !== 'mouse') eng.leave(); };
  target.addEventListener('pointermove', onMove, { passive: true });
  target.addEventListener('pointerdown', onDown, { passive: true });
  target.addEventListener('pointerup', onUp, { passive: true });
  return {
    set(cfg2) { eng = new Engine(cfg2, colors().accent, colors().accent2); },
    stop() {
      stopped = true; cancelAnimationFrame(raf);
      target.removeEventListener('pointermove', onMove); target.removeEventListener('pointerdown', onDown); target.removeEventListener('pointerup', onUp);
    },
  };
}

// YouTube link -> video id (watch?v=, youtu.be/, shorts/, embed/)
export function ytId(link) {
  const s = String(link || '').trim();
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/) || s.match(/^([\w-]{11})$/);
  return m ? m[1] : '';
}
