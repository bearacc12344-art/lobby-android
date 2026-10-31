// The Smult Brain's language half (Brain 4) - JS port of lang_model.py's tiny GPT (same weights, same int8 sharing format).
//   64 chars -> letter + position embeddings (64) -> 3 x [attention (4 heads) + feed-forward (256)] -> next letter
// Phones only RUN it (talk / write); everyone's PCs train it.
import pako from 'pako';
import { b64, unb64 } from './visionModel.js';

export const VOCAB = "\n !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~" +
  'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÉÊÍÓÔÕÚÇÑ¿¡°ºª€£';
export const V = VOCAB.length;
export const CTX = 64, D = 64, LAYERS = 3, HEADS = 4, FF = 256, VERSION = 2;
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

export const STAGES = ['👶 babbling', '🔤 letters', '🧩 pairs', '🗣 syllables', '📖 words', '✍️ phrases', '📝 sentences'];
export function stage(bpc) {
  if (bpc === null || bpc === undefined) return [0, "💤 hasn't read anything yet"];
  const st = [[5.5, '👶 babbling random characters'], [4.3, '🔤 learning which letters are common'],
    [3.4, '🧩 learning letter pairs and spaces'], [2.7, '🗣 making syllables and word shapes'], [2.2, '📖 writing real words'],
    [1.7, '✍️ stringing words together']];
  for (let i = 0; i < st.length; i++) if (bpc > st[i][0]) return [i, st[i][1]];
  return [6, '📝 writing whole sentences'];
}

// tensor order + shapes exactly like lang_model.LangNet.keys
export const KEYS = [['wte', V * D], ['wpe', CTX * D]];
for (let l = 0; l < LAYERS; l++) {
  KEYS.push([`${l}.ln1g`, D], [`${l}.ln1b`, D], [`${l}.qkv`, D * 3 * D], [`${l}.qkvb`, 3 * D], [`${l}.o`, D * D], [`${l}.ob`, D],
    [`${l}.ln2g`, D], [`${l}.ln2b`, D], [`${l}.fc`, D * FF], [`${l}.fcb`, FF], [`${l}.pr`, FF * D], [`${l}.prb`, D]);
}
KEYS.push(['lnfg', D], ['lnfb', D]);
const SHAPES = KEYS.map((k) => k[1]);

// out[T,N] = x[T,K] @ W[K,N] + b
function mm(x, T, K, W, N, b) {
  const out = new Float32Array(T * N);
  for (let t = 0; t < T; t++) {
    const o = t * N, xo = t * K;
    if (b) out.set(b, o);
    for (let k = 0; k < K; k++) {
      const v = x[xo + k];
      if (v === 0) continue;
      const wo = k * N;
      for (let n = 0; n < N; n++) out[o + n] += v * W[wo + n];
    }
  }
  return out;
}
function ln(x, T, g, b) {
  const out = new Float32Array(T * D);
  for (let t = 0; t < T; t++) {
    const o = t * D;
    let mu = 0;
    for (let i = 0; i < D; i++) mu += x[o + i];
    mu /= D;
    let v = 0;
    for (let i = 0; i < D; i++) { const d = x[o + i] - mu; v += d * d; }
    const inv = 1 / Math.sqrt(v / D + 1e-5);
    for (let i = 0; i < D; i++) out[o + i] = (x[o + i] - mu) * inv * g[i] + b[i];
  }
  return out;
}
const gelu = (x) => 0.5 * x * (1 + Math.tanh(0.7978845608 * (x + 0.044715 * x * x * x)));

export class LangNet {
  constructor(arrays = null) {
    this.p = {};
    KEYS.forEach(([k, n], i) => { this.p[k] = arrays ? arrays[i] : new Float32Array(n); });
    this.empty = !arrays;              // no brain yet (nothing downloaded)
  }
  params() { return KEYS.map(([k]) => this.p[k]); }
  context(text) {
    const ids = encode(normalize(text));
    return ids.length ? ids.slice(-CTX) : Uint8Array.of(VOCAB.indexOf('\n'));
  }
  // logits for every position (or only the last when lastOnly)
  forward(ids, lastOnly = true) {
    const p = this.p, T = ids.length, hd = D / HEADS, sc = 1 / Math.sqrt(hd);
    let x = new Float32Array(T * D);
    for (let t = 0; t < T; t++) for (let i = 0; i < D; i++) x[t * D + i] = p.wte[ids[t] * D + i] + p.wpe[t * D + i];
    for (let l = 0; l < LAYERS; l++) {
      const h = ln(x, T, p[`${l}.ln1g`], p[`${l}.ln1b`]);
      const qkv = mm(h, T, D, p[`${l}.qkv`], 3 * D, p[`${l}.qkvb`]);
      const y = new Float32Array(T * D);
      const att = new Float32Array(T);
      for (let hh = 0; hh < HEADS; hh++) {
        const qo = hh * hd, ko = D + hh * hd, vo = 2 * D + hh * hd;
        for (let t = 0; t < T; t++) {
          let mx = -Infinity;
          for (let s = 0; s <= t; s++) {
            let d = 0;
            for (let i = 0; i < hd; i++) d += qkv[t * 3 * D + qo + i] * qkv[s * 3 * D + ko + i];
            att[s] = d * sc;
            if (att[s] > mx) mx = att[s];
          }
          let sum = 0;
          for (let s = 0; s <= t; s++) { att[s] = Math.exp(att[s] - mx); sum += att[s]; }
          for (let s = 0; s <= t; s++) {
            const a = att[s] / sum;
            for (let i = 0; i < hd; i++) y[t * D + qo + i] += a * qkv[s * 3 * D + vo + i];
          }
        }
      }
      const ao = mm(y, T, D, p[`${l}.o`], D, p[`${l}.ob`]);
      for (let i = 0; i < x.length; i++) x[i] += ao[i];
      const h2 = ln(x, T, p[`${l}.ln2g`], p[`${l}.ln2b`]);
      const f = mm(h2, T, D, p[`${l}.fc`], FF, p[`${l}.fcb`]);
      for (let i = 0; i < f.length; i++) f[i] = gelu(f[i]);
      const mo = mm(f, T, FF, p[`${l}.pr`], D, p[`${l}.prb`]);
      for (let i = 0; i < x.length; i++) x[i] += mo[i];
    }
    const t0 = lastOnly ? T - 1 : 0, n = T - t0;
    const hf = ln(x.subarray(t0 * D), n, p.lnfg, p.lnfb);
    const logits = new Float32Array(n * V);
    for (let t = 0; t < n; t++) for (let c = 0; c < V; c++) {
      let d = 0;
      for (let i = 0; i < D; i++) d += hf[t * D + i] * p.wte[c * D + i];
      logits[t * V + c] = d;
    }
    return logits;
  }
  static softmax(z, o = 0, n = V) {
    let mx = -Infinity;
    for (let i = 0; i < n; i++) if (z[o + i] > mx) mx = z[o + i];
    const out = new Float64Array(n);
    let s = 0;
    for (let i = 0; i < n; i++) { out[i] = Math.exp(z[o + i] - mx); s += out[i]; }
    for (let i = 0; i < n; i++) out[i] /= s;
    return out;
  }
  // mean cross-entropy (nats) of passages X (B x CTX) predicting Y
  loss(X, Y, B) {
    let tot = 0, n = 0;
    for (let b = 0; b < B; b++) {
      const lg = this.forward(X.subarray(b * CTX, (b + 1) * CTX), false);
      for (let t = 0; t < CTX; t++) { const pr = LangNet.softmax(lg, t * V); tot -= Math.log(pr[Y[b * CTX + t]] + 1e-9); n++; }
    }
    return tot / Math.max(1, n);
  }
  nextProbs(text) { return LangNet.softmax(this.forward(this.context(text))); }
  generate(prompt = '', n = 200, temp = 0.8, stop = null, topK = 12) {
    const ctx = Array.from(this.context(prompt));
    const out = [];
    for (let s = 0; s < n; s++) {
      const z = this.forward(Uint8Array.from(ctx.slice(-CTX)));
      for (let i = 0; i < V; i++) z[i] /= Math.max(0.05, temp);
      if (topK) { const cut = Array.from(z).sort((a, b) => b - a)[topK - 1]; for (let i = 0; i < V; i++) if (z[i] < cut) z[i] = -1e9; }
      const q = LangNet.softmax(z);
      let r = Math.random(), c = V - 1;
      for (let k = 0; k < V; k++) { r -= q[k]; if (r <= 0) { c = k; break; } }
      out.push(c);
      ctx.push(c);
      if (stop && decode(out).endsWith(stop)) break;
    }
    return decode(out);
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
    if (this.empty) { KEYS.forEach(([k], i) => { this.p[k] = Float32Array.from(arrays[i]); }); this.empty = false; return; }
    this.params().forEach((prm, pi) => { const o = arrays[pi]; for (let i = 0; i < prm.length; i++) prm[i] += alpha * (o[i] - prm[i]); });
  }
}
