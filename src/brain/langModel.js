// The Smult Brain's language half - exact JS port of lang_model.py (same weights, same int8 sharing format).
//   12 chars -> embeddings (12 x 12) -> 144 -> hidden 128 (tanh) -> one score per character -> softmax
import pako from 'pako';
import { b64, unb64 } from './visionModel.js';

export const VOCAB = "\n !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~" +
  'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÉÊÍÓÔÕÚÇÑ¿¡°ºª€£';
export const V = VOCAB.length;
export const CTX = 12, EMB = 12, HID = 128, VERSION = 1;
const IDX = new Map([...VOCAB].map((c, i) => [c, i]));
export const SPACE = IDX.get(' ');

const TRANS = {
  '“': '"', '”': '"', '„': '"', '‟': '"', '«': '"', '»': '"', '‘': "'", '’': "'", '‚': "'", '‛': "'", '´': "'", '`': "'",
  '–': '-', '—': '-', '―': '-', '−': '-', '•': '-', '·': '-', '\t': ' ', ' ': ' ', ' ': ' ', '​': '', '\r': '',
  '…': '...', 'ﬁ': 'fi', 'ﬂ': 'fl',
};
const TRANS_RE = new RegExp('[' + Object.keys(TRANS).join('') + ']', 'g');
const esc = (s) => s.replace(/[\\\]^\-[]/g, '\\$&');
const UNKNOWN = new RegExp('[^' + esc(VOCAB) + ']+', 'g');

export function normalize(text) {
  let t = text.replace(TRANS_RE, (c) => TRANS[c]);
  t = t.replace(UNKNOWN, '');
  t = t.replace(/ {2,}/g, ' ');
  t = t.replace(/ *\n */g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t;
}
export function encode(text) {
  const t = text.replace(UNKNOWN, '');
  const out = new Uint8Array(t.length);
  let n = 0;
  for (const c of t) { const i = IDX.get(c); if (i !== undefined) out[n++] = i; }
  return out.subarray(0, n);
}
export const decode = (ids) => Array.from(ids, (i) => VOCAB[i]).join('');

export const STAGES = ['👶 babbling', '🔤 letters', '🧩 pairs', '🗣 syllables', '📖 words', '✍️ phrases'];
export function stage(bpc) {
  if (bpc === null || bpc === undefined) return [0, "💤 hasn't read anything yet"];
  const st = [[5.5, '👶 babbling random characters'], [4.3, '🔤 learning which letters are common'],
    [3.4, '🧩 learning letter pairs and spaces'], [2.7, '🗣 making syllables and word shapes'], [2.2, '📖 writing real words']];
  for (let i = 0; i < st.length; i++) if (bpc > st[i][0]) return [i, st[i][1]];
  return [5, '✍️ stringing words together'];
}

const SHAPES = [V * EMB, CTX * EMB * HID, HID, HID * V, V];

export class LangNet {
  constructor(genesis) {
    let o = 0;
    const take = (n) => { const a = genesis.slice(o, o + n); o += n; return a; };
    [this.E, this.W1, this.b1, this.W2, this.b2] = SHAPES.map(take);
    this.adam = null;
    this.t = 0;
  }
  params() { return [this.E, this.W1, this.b1, this.W2, this.b2]; }
  forward(X, n) {
    // X: Uint8Array n*CTX
    const D = CTX * EMB;
    const e = new Float32Array(n * D);
    for (let b = 0; b < n; b++) for (let j = 0; j < CTX; j++) e.set(this.E.subarray(X[b * CTX + j] * EMB, X[b * CTX + j] * EMB + EMB), b * D + j * EMB);
    const h = new Float32Array(n * HID);
    for (let b = 0; b < n; b++) {
      const hb = b * HID;
      for (let k = 0; k < HID; k++) h[hb + k] = this.b1[k];
      for (let i = 0; i < D; i++) {
        const v = e[b * D + i];
        if (v === 0) continue;
        const wi = i * HID;
        for (let k = 0; k < HID; k++) h[hb + k] += v * this.W1[wi + k];
      }
      for (let k = 0; k < HID; k++) h[hb + k] = Math.tanh(h[hb + k]);
    }
    const p = new Float32Array(n * V);
    for (let b = 0; b < n; b++) {
      const pb = b * V;
      for (let k = 0; k < V; k++) p[pb + k] = this.b2[k];
      for (let i = 0; i < HID; i++) {
        const v = h[b * HID + i];
        const wi = i * V;
        for (let k = 0; k < V; k++) p[pb + k] += v * this.W2[wi + k];
      }
      let mx = -Infinity;
      for (let k = 0; k < V; k++) mx = Math.max(mx, p[pb + k]);
      let s = 0;
      for (let k = 0; k < V; k++) { p[pb + k] = Math.exp(p[pb + k] - mx); s += p[pb + k]; }
      for (let k = 0; k < V; k++) p[pb + k] /= s;
    }
    return { p, e, h };
  }
  loss(X, y, n) {
    const { p } = this.forward(X, n);
    let s = 0;
    for (let b = 0; b < n; b++) s -= Math.log(p[b * V + y[b]] + 1e-9);
    return s / n;
  }
  step(X, y, n, lr = 0.003) {
    const D = CTX * EMB;
    const { p, e, h } = this.forward(X, n);
    let loss = 0;
    for (let b = 0; b < n; b++) { loss -= Math.log(p[b * V + y[b]] + 1e-9); p[b * V + y[b]] -= 1; }
    for (let i = 0; i < p.length; i++) p[i] /= n;
    const g = p;
    const gW2 = new Float32Array(HID * V), gb2 = new Float32Array(V), gh = new Float32Array(n * HID);
    for (let b = 0; b < n; b++) {
      for (let k = 0; k < V; k++) gb2[k] += g[b * V + k];
      for (let i = 0; i < HID; i++) {
        const hv = h[b * HID + i];
        let s = 0;
        const wi = i * V;
        for (let k = 0; k < V; k++) { const gv = g[b * V + k]; gW2[wi + k] += hv * gv; s += gv * this.W2[wi + k]; }
        gh[b * HID + i] = s * (1 - hv * hv);
      }
    }
    const gW1 = new Float32Array(D * HID), gb1 = new Float32Array(HID), gE = new Float32Array(V * EMB);
    for (let b = 0; b < n; b++) {
      for (let k = 0; k < HID; k++) gb1[k] += gh[b * HID + k];
      for (let i = 0; i < D; i++) {
        const ev = e[b * D + i];
        const wi = i * HID;
        let s = 0;
        for (let k = 0; k < HID; k++) { const gv = gh[b * HID + k]; gW1[wi + k] += ev * gv; s += gv * this.W1[wi + k]; }
        const j = (i / EMB) | 0, d = i % EMB;
        gE[X[b * CTX + j] * EMB + d] += s;
      }
    }
    const grads = [gE, gW1, gb1, gW2, gb2];
    if (!this.adam) this.adam = this.params().map((a) => [new Float32Array(a.length), new Float32Array(a.length)]);
    this.t++;
    const b1 = 0.9, b2 = 0.999, c1 = 1 - b1 ** this.t, c2 = 1 - b2 ** this.t;
    this.params().forEach((prm, pi) => {
      const gr = grads[pi], [m, v] = this.adam[pi];
      for (let i = 0; i < prm.length; i++) {
        const gi = Math.max(-1, Math.min(1, gr[i]));
        m[i] = b1 * m[i] + (1 - b1) * gi;
        v[i] = b2 * v[i] + (1 - b2) * gi * gi;
        prm[i] -= lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + 1e-8);
      }
    });
    return loss / n;
  }
  context(text) {
    const ids = encode(normalize(text)).slice(-CTX);
    const ctx = new Uint8Array(CTX).fill(SPACE);
    ctx.set(ids, CTX - ids.length);
    return ctx;
  }
  nextProbs(text) { return this.forward(this.context(text), 1).p; }
  generate(prompt = '', n = 200, temp = 0.8) {
    const ctx = Array.from(this.context(prompt));
    const out = [];
    for (let s = 0; s < n; s++) {
      const p = this.forward(Uint8Array.from(ctx.slice(-CTX)), 1).p;
      const q = new Float64Array(V);
      let sum = 0;
      for (let k = 0; k < V; k++) { q[k] = temp !== 1 ? Math.exp(Math.log(p[k] + 1e-12) / Math.max(0.05, temp)) : p[k]; sum += q[k]; }
      let r = Math.random() * sum, c = V - 1;
      for (let k = 0; k < V; k++) { r -= q[k]; if (r <= 0) { c = k; break; } }
      out.push(c);
      ctx.push(c);
    }
    return decode(out);
  }
  pack() {
    const scales = [];
    const total = SHAPES.reduce((a, b) => a + b, 0);
    const raw = new Int8Array(total);
    let o = 0;
    for (const a of this.params()) {
      let mx = 0;
      for (let i = 0; i < a.length; i++) mx = Math.max(mx, Math.abs(a[i]));
      const s = mx / 127 || 1e-8;
      scales.push(s);
      for (let i = 0; i < a.length; i++) raw[o + i] = Math.max(-127, Math.min(127, Math.round(a[i] / s)));
      o += a.length;
    }
    return [b64(pako.deflate(new Uint8Array(raw.buffer), { level: 9 })), scales];
  }
  static unpack(blob, scales) {
    const raw = pako.inflate(unb64(blob));
    if (raw.length !== SHAPES.reduce((a, b) => a + b, 0) || scales.length !== SHAPES.length) throw new Error('bad weights');
    const out = [];
    let o = 0;
    SHAPES.forEach((m, si) => {
      const sc = Number(scales[si]);
      if (!Number.isFinite(sc)) throw new Error('bad weights');
      const a = new Float32Array(m);
      for (let i = 0; i < m; i++) a[i] = ((raw[o + i] << 24) >> 24) * sc;
      out.push(a);
      o += m;
    });
    return out;
  }
  blend(arrays, alpha) {
    this.params().forEach((prm, pi) => { const o = arrays[pi]; for (let i = 0; i < prm.length; i++) prm[i] += alpha * (o[i] - prm[i]); });
  }
}
