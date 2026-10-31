// Brain 3.0 vision network - exact JavaScript port of brain_model.py (same weights layout, same int8+zlib sharing format,
// same genesis, same label initialisation), so phones and PCs train and average ONE shared brain.
//   32x32 RGB -> conv(16) pool -> conv(24) pool -> conv(32) pool -> conv(48) -> [avg, max] -> 64 hidden (dropout) -> labels
import pako from 'pako';
import { NumpyRNG } from './nprng.js';
import { sha256 } from '@noble/hashes/sha2.js';

export const SIDE = 32;
export const CH = [3, 24, 40, 64, 96];          // Brain 4: wider, room for up to 100 things
export const POOLED = [true, true, true, false];
export const FEAT = 2 * CH[4];
export const HID = 128;
export const NOTHING = 'nothing';
export const MAX_LABELS = 101;
export const VERSION = 4;
const KEEP = 0.75;

export function labelSeed(label) {
  const h = sha256(new TextEncoder().encode('lobby-brain:' + label));
  return ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
}

// ---------------------------------------------------------------- building blocks (NHWC, Float32Array)
// cols[(n*h*w), 9*c] with column index = (ky*3+kx)*c + ch   (identical to the numpy im2col)
function im2col(x, n, h, w, c) {
  const K = 9 * c;
  const cols = new Float32Array(n * h * w * K);
  for (let b = 0; b < n; b++) {
    const xb = b * h * w * c;
    for (let y = 0; y < h; y++) {
      for (let xx = 0; xx < w; xx++) {
        const row = ((b * h + y) * w + xx) * K;
        let i = 0;
        for (let ky = -1; ky <= 1; ky++) {
          const sy = y + ky;
          for (let kx = -1; kx <= 1; kx++, i++) {
            const sx = xx + kx;
            if (sy < 0 || sy >= h || sx < 0 || sx >= w) continue;
            const src = xb + (sy * w + sx) * c, dst = row + i * c;
            for (let ch = 0; ch < c; ch++) cols[dst + ch] = x[src + ch];
          }
        }
      }
    }
  }
  return cols;
}
function col2im(dcols, n, h, w, c) {
  const K = 9 * c;
  const dx = new Float32Array(n * h * w * c);
  for (let b = 0; b < n; b++) {
    const xb = b * h * w * c;
    for (let y = 0; y < h; y++) {
      for (let xx = 0; xx < w; xx++) {
        const row = ((b * h + y) * w + xx) * K;
        let i = 0;
        for (let ky = -1; ky <= 1; ky++) {
          const sy = y + ky;
          for (let kx = -1; kx <= 1; kx++, i++) {
            const sx = xx + kx;
            if (sy < 0 || sy >= h || sx < 0 || sx >= w) continue;
            const dst = xb + (sy * w + sx) * c, src = row + i * c;
            for (let ch = 0; ch < c; ch++) dx[dst + ch] += dcols[src + ch];
          }
        }
      }
    }
  }
  return dx;
}
// C[M,N] = A[M,K] @ B[K,N] (+ bias)
function matmul(A, B, M, K, N, bias = null) {
  const C = new Float32Array(M * N);
  for (let i = 0; i < M; i++) {
    const ci = i * N, ai = i * K;
    if (bias) for (let j = 0; j < N; j++) C[ci + j] = bias[j];
    for (let k = 0; k < K; k++) {
      const a = A[ai + k];
      if (a === 0) continue;
      const bk = k * N;
      for (let j = 0; j < N; j++) C[ci + j] += a * B[bk + j];
    }
  }
  return C;
}
// C[K,N] = A[M,K]^T @ G[M,N]
function matmulTA(A, G, M, K, N) {
  const C = new Float32Array(K * N);
  for (let i = 0; i < M; i++) {
    const ai = i * K, gi = i * N;
    for (let k = 0; k < K; k++) {
      const a = A[ai + k];
      if (a === 0) continue;
      const ck = k * N;
      for (let j = 0; j < N; j++) C[ck + j] += a * G[gi + j];
    }
  }
  return C;
}
// C[M,K] = G[M,N] @ B[K,N]^T
function matmulTB(G, B, M, N, K) {
  const C = new Float32Array(M * K);
  for (let i = 0; i < M; i++) {
    const gi = i * N, ci = i * K;
    for (let k = 0; k < K; k++) {
      const bk = k * N;
      let s = 0;
      for (let j = 0; j < N; j++) s += G[gi + j] * B[bk + j];
      C[ci + k] = s;
    }
  }
  return C;
}
function pool(x, n, h, w, c) {
  const h2 = h >> 1, w2 = w >> 1;
  const out = new Float32Array(n * h2 * w2 * c);
  for (let b = 0; b < n; b++) for (let y = 0; y < h2; y++) for (let xx = 0; xx < w2; xx++) {
    const o = ((b * h2 + y) * w2 + xx) * c;
    const i00 = ((b * h + 2 * y) * w + 2 * xx) * c, i01 = i00 + c, i10 = i00 + w * c, i11 = i10 + c;
    for (let ch = 0; ch < c; ch++) out[o + ch] = Math.max(x[i00 + ch], x[i01 + ch], x[i10 + ch], x[i11 + ch]);
  }
  return out;
}
function poolBack(dout, x, out, n, h, w, c) {
  const h2 = h >> 1, w2 = w >> 1;
  const dx = new Float32Array(x.length);
  for (let b = 0; b < n; b++) for (let y = 0; y < h2; y++) for (let xx = 0; xx < w2; xx++) {
    const o = ((b * h2 + y) * w2 + xx) * c;
    const idx = [((b * h + 2 * y) * w + 2 * xx) * c];
    idx.push(idx[0] + c, idx[0] + w * c, idx[0] + w * c + c);
    for (let ch = 0; ch < c; ch++) {
      const m = out[o + ch];
      let cnt = 0;
      for (const i of idx) if (x[i + ch] === m) cnt++;
      const g = dout[o + ch] / cnt;
      for (const i of idx) if (x[i + ch] === m) dx[i + ch] += g;
    }
  }
  return dx;
}

// ---------------------------------------------------------------- the network
export class Net {
  constructor(genesis) {
    // genesis: Float32Array of [W,b]*4 + W1 + b1 exported from Python (everyone starts from the same baby brain)
    this.convs = [];
    let o = 0;
    for (let l = 0; l < 4; l++) {
      const K = 9 * CH[l], N = CH[l + 1];
      const W = genesis.slice(o, o + K * N); o += K * N;
      const b = genesis.slice(o, o + N); o += N;
      this.convs.push([W, b]);
    }
    this.W1 = genesis.slice(o, o + FEAT * HID); o += FEAT * HID;
    this.b1 = genesis.slice(o, o + HID); o += HID;
    this.labels = [];
    this.Wd = new Float32Array(0);
    this.bd = new Float32Array(0);
    this.opt = null;
    this.t = 0;
  }
  get k() { return this.labels.length; }
  params() { return [...this.convs.flat(), this.W1, this.b1, this.Wd, this.bd]; }
  ensureLabels(labels) {
    let changed = false;
    for (const lab of labels) {
      if (this.labels.includes(lab) || this.labels.length >= MAX_LABELS) continue;
      const rng = new NumpyRNG(labelSeed(lab));
      const col = new Float32Array(HID);
      const s = Math.sqrt(1 / HID);
      for (let i = 0; i < HID; i++) col[i] = rng.standardNormal() * s;
      const k = this.labels.length;
      const Wd = new Float32Array(HID * (k + 1));
      for (let i = 0; i < HID; i++) { for (let j = 0; j < k; j++) Wd[i * (k + 1) + j] = this.Wd[i * k + j]; Wd[i * (k + 1) + k] = col[i]; }
      const bd = new Float32Array(k + 1);
      bd.set(this.bd);
      this.Wd = Wd; this.bd = bd;
      this.labels.push(lab);
      changed = true;
    }
    if (changed) this.opt = null;
  }
  forward(X, n, keep = false, rng = null) {
    const cache = [];
    let a = X, h = SIDE, w = SIDE;
    for (let l = 0; l < 4; l++) {
      const c = CH[l], co = CH[l + 1];
      const cols = im2col(a, n, h, w, c);
      const z = matmul(cols, this.convs[l][0], n * h * w, 9 * c, co, this.convs[l][1]);
      const r = new Float32Array(z.length);
      for (let i = 0; i < z.length; i++) r[i] = z[i] > 0 ? z[i] : 0;
      const p = POOLED[l] ? pool(r, n, h, w, co) : r;
      if (keep) cache.push({ shape: [n, h, w, c], cols, z, r, p, co });
      a = p;
      if (POOLED[l]) { h >>= 1; w >>= 1; }
    }
    const c4 = CH[4], hw = h * w;
    const f = new Float32Array(n * FEAT);
    for (let b = 0; b < n; b++) for (let ch = 0; ch < c4; ch++) {
      let s = 0, m = -Infinity;
      for (let p2 = 0; p2 < hw; p2++) { const v = a[(b * hw + p2) * c4 + ch]; s += v; if (v > m) m = v; }
      f[b * FEAT + ch] = s / hw;
      f[b * FEAT + c4 + ch] = m;
    }
    const hz = matmul(f, this.W1, n, FEAT, HID, this.b1);
    const hh = new Float32Array(hz.length);
    for (let i = 0; i < hz.length; i++) hh[i] = hz[i] > 0 ? hz[i] : 0;
    let mask = null;
    if (rng) {
      mask = new Float32Array(hh.length);
      for (let i = 0; i < hh.length; i++) { mask[i] = Math.random() < KEEP ? 1 / KEEP : 0; hh[i] *= mask[i]; }
    }
    const k = this.k;
    const probs = matmul(hh, this.Wd, n, HID, k, this.bd);
    for (let b = 0; b < n; b++) {
      let mx = -Infinity;
      for (let j = 0; j < k; j++) mx = Math.max(mx, probs[b * k + j]);
      let s = 0;
      for (let j = 0; j < k; j++) { const e = Math.exp(probs[b * k + j] - mx); probs[b * k + j] = e; s += e; }
      for (let j = 0; j < k; j++) probs[b * k + j] /= s;
    }
    return { probs, cache: keep ? { cache, a4: a, hw, f, hz, h: hh, mask } : null };
  }
  features(X, n) {
    // the 64 hidden neurons (what it 'thinks' about a picture), no dropout
    const saveK = this.labels;
    const { cache } = { cache: null };
    let a = X, h = SIDE, w = SIDE;
    for (let l = 0; l < 4; l++) {
      const c = CH[l], co = CH[l + 1];
      const z = matmul(im2col(a, n, h, w, c), this.convs[l][0], n * h * w, 9 * c, co, this.convs[l][1]);
      for (let i = 0; i < z.length; i++) if (z[i] < 0) z[i] = 0;
      a = POOLED[l] ? pool(z, n, h, w, co) : z;
      if (POOLED[l]) { h >>= 1; w >>= 1; }
    }
    const c4 = CH[4], hw = h * w;
    const f = new Float32Array(n * FEAT);
    for (let b = 0; b < n; b++) for (let ch = 0; ch < c4; ch++) {
      let s = 0, m = -Infinity;
      for (let p2 = 0; p2 < hw; p2++) { const v = a[(b * hw + p2) * c4 + ch]; s += v; if (v > m) m = v; }
      f[b * FEAT + ch] = s / hw; f[b * FEAT + c4 + ch] = m;
    }
    const hz = matmul(f, this.W1, n, FEAT, HID, this.b1);
    for (let i = 0; i < hz.length; i++) if (hz[i] < 0) hz[i] = 0;
    void saveK; void cache;
    return hz;
  }
  predict(x) {
    if (!this.labels.length) return [];
    const { probs } = this.forward(x, 1);
    return this.labels.map((l, i) => [l, probs[i]]).sort((a, b) => b[1] - a[1]);
  }
  grads(X, y, n, smooth = 0.05) {
    const k = this.k;
    const { probs, cache: C } = this.forward(X, n, true, true);
    const per = new Float32Array(n);
    const g = new Float32Array(n * k);
    for (let b = 0; b < n; b++) {
      per[b] = -Math.log(probs[b * k + y[b]] + 1e-9);
      for (let j = 0; j < k; j++) g[b * k + j] = (probs[b * k + j] - (smooth / k + (j === y[b] ? 1 - smooth : 0))) / n;
    }
    const gWd = matmulTA(C.h, g, n, HID, k);
    const gbd = new Float32Array(k);
    for (let b = 0; b < n; b++) for (let j = 0; j < k; j++) gbd[j] += g[b * k + j];
    const dh = matmulTB(g, this.Wd, n, k, HID);
    for (let i = 0; i < dh.length; i++) dh[i] *= (C.mask ? C.mask[i] : 1) * (C.hz[i] > 0 ? 1 : 0);
    const gW1 = matmulTA(C.f, dh, n, FEAT, HID);
    const gb1 = new Float32Array(HID);
    for (let b = 0; b < n; b++) for (let j = 0; j < HID; j++) gb1[j] += dh[b * HID + j];
    const df = matmulTB(dh, this.W1, n, HID, FEAT);
    const c4 = CH[4], hw = C.hw, a4 = C.a4;
    let d = new Float32Array(a4.length);
    for (let b = 0; b < n; b++) for (let ch = 0; ch < c4; ch++) {
      let m = -Infinity, cnt = 0;
      for (let p2 = 0; p2 < hw; p2++) m = Math.max(m, a4[(b * hw + p2) * c4 + ch]);
      for (let p2 = 0; p2 < hw; p2++) if (a4[(b * hw + p2) * c4 + ch] === m) cnt++;
      const ga = df[b * FEAT + ch] / hw, gm = df[b * FEAT + c4 + ch] / cnt;
      for (let p2 = 0; p2 < hw; p2++) {
        const i = (b * hw + p2) * c4 + ch;
        d[i] = ga + (a4[i] === m ? gm : 0);
      }
    }
    const gr = new Array(8);
    for (let l = 3; l >= 0; l--) {
      const { shape, cols, z, r, co } = C.cache[l];
      const [nn, h, w, c] = shape;
      let dz = POOLED[l] ? poolBack(d, r, C.cache[l].p, nn, h, w, co) : d;
      for (let i = 0; i < dz.length; i++) if (z[i] <= 0) dz[i] = 0;
      const M = nn * h * w;
      gr[2 * l] = matmulTA(cols, dz, M, 9 * c, co);
      const gb = new Float32Array(co);
      for (let i = 0; i < M; i++) for (let j = 0; j < co; j++) gb[j] += dz[i * co + j];
      gr[2 * l + 1] = gb;
      if (l > 0) d = col2im(matmulTB(dz, this.convs[l][0], M, co, 9 * c), nn, h, w, c);
    }
    return { per, grads: [...gr, gW1, gb1, gWd, gbd] };
  }
  step(X, y, n, lr = 0.002, wd = 2e-4, smooth = 0.05) {
    const { per, grads } = this.grads(X, y, n, smooth);
    const params = this.params();
    if (!this.opt) { this.opt = params.map((p) => [new Float32Array(p.length), new Float32Array(p.length)]); this.t = 0; }
    this.t++;
    const b1 = 0.9, b2 = 0.999, c1 = 1 - b1 ** this.t, c2 = 1 - b2 ** this.t;
    params.forEach((p, pi) => {
      const g = grads[pi], [m, v] = this.opt[pi];
      const decay = pi === 1 || pi === 3 || pi === 5 || pi === 7 || pi === 9 || pi === 11 ? 1 : 1 - lr * wd;   // weight decay on matrices only
      for (let i = 0; i < p.length; i++) {
        const gi = Math.max(-1, Math.min(1, g[i]));
        m[i] = b1 * m[i] + (1 - b1) * gi;
        v[i] = b2 * v[i] + (1 - b2) * gi * gi;
        p[i] = p[i] * decay - lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + 1e-7);
      }
    });
    return per;
  }
  // ---- sharing: per tensor [float32 scale][int8 values], zlib, base64 (same bytes as Python)
  pack() {
    const parts = [];
    let total = 0;
    for (const a of this.params()) {
      let mx = 0;
      for (let i = 0; i < a.length; i++) mx = Math.max(mx, Math.abs(a[i]));
      const s = mx / 127 || 1e-8;
      const buf = new Uint8Array(4 + a.length);
      new DataView(buf.buffer).setFloat32(0, s, true);
      const q = new Int8Array(buf.buffer, 4);
      for (let i = 0; i < a.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(a[i] / s)));
      parts.push(buf);
      total += buf.length;
    }
    const raw = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { raw.set(p, o); o += p.length; }
    return b64(pako.deflate(raw, { level: 9 }));
  }
  static shapes(k) {
    const sz = [];
    for (let l = 0; l < 4; l++) sz.push(9 * CH[l] * CH[l + 1], CH[l + 1]);
    return [...sz, FEAT * HID, HID, HID * k, k];
  }
  static unpack(blob, labels) {
    const raw = pako.inflate(unb64(blob));
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const out = [];
    let o = 0;
    for (const m of Net.shapes(labels.length)) {
      if (o + 4 + m > raw.length) throw new Error('bad weights');
      const sc = dv.getFloat32(o, true);
      if (!Number.isFinite(sc)) throw new Error('bad weights');
      const a = new Float32Array(m);
      for (let i = 0; i < m; i++) a[i] = ((raw[o + 4 + i] << 24) >> 24) * sc;
      out.push(a);
      o += 4 + m;
    }
    if (o !== raw.length) throw new Error('bad weights');
    return out;
  }
  blend(arrays, labels, alpha) {
    this.ensureLabels(labels);
    for (let l = 0; l < 4; l++) {
      const [W, b] = this.convs[l], oW = arrays[2 * l], ob = arrays[2 * l + 1];
      for (let i = 0; i < W.length; i++) W[i] += alpha * (oW[i] - W[i]);
      for (let i = 0; i < b.length; i++) b[i] += alpha * (ob[i] - b[i]);
    }
    const oW1 = arrays[8], ob1 = arrays[9];
    for (let i = 0; i < this.W1.length; i++) this.W1[i] += alpha * (oW1[i] - this.W1[i]);
    for (let i = 0; i < this.b1.length; i++) this.b1[i] += alpha * (ob1[i] - this.b1[i]);
    const Wd = arrays[10], bd = arrays[11], kk = labels.length, k = this.k;
    labels.forEach((lab, j) => {
      const i = this.labels.indexOf(lab);
      if (i < 0) return;
      for (let r = 0; r < HID; r++) this.Wd[r * k + i] += alpha * (Wd[r * kk + j] - this.Wd[r * k + i]);
      this.bd[i] += alpha * (bd[j] - this.bd[i]);
    });
  }
  copy() {
    const n = Object.create(Net.prototype);
    n.convs = this.convs.map(([W, b]) => [W.slice(), b.slice()]);
    n.W1 = this.W1.slice(); n.b1 = this.b1.slice(); n.Wd = this.Wd.slice(); n.bd = this.bd.slice();
    n.labels = [...this.labels]; n.opt = null; n.t = 0;
    return n;
  }
}

// ---------------------------------------------------------------- augmentation (tougher variations, like PC)
function resizeNearestArea(src, sh, sw, dh, dw) {
  const out = new Float32Array(dh * dw * 3);
  for (let y = 0; y < dh; y++) {
    const y0 = (y * sh) / dh, y1 = ((y + 1) * sh) / dh;
    for (let x = 0; x < dw; x++) {
      const x0 = (x * sw) / dw, x1 = ((x + 1) * sw) / dw;
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
        const i = (yy * sw + xx) * 3; r += src[i]; g += src[i + 1]; b += src[i + 2]; n++;
      }
      const o = (y * dw + x) * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return out;
}
export function augment(Xu8, idx) {
  const n = idx.length, S2 = SIDE * SIDE * 3;
  const out = new Float32Array(n * S2);
  for (let b = 0; b < n; b++) {
    let im = new Float32Array(S2);
    const src = Xu8.subarray(idx[b] * S2, idx[b] * S2 + S2);
    for (let i = 0; i < S2; i++) im[i] = src[i] / 255;
    if (Math.random() < 0.5) {
      const c = 24 + Math.floor(Math.random() * 7);
      const y0 = Math.floor(Math.random() * (SIDE - c + 1)), x0 = Math.floor(Math.random() * (SIDE - c + 1));
      const crop = new Float32Array(c * c * 3);
      for (let y = 0; y < c; y++) for (let x = 0; x < c; x++) for (let ch = 0; ch < 3; ch++) crop[(y * c + x) * 3 + ch] = im[((y0 + y) * SIDE + x0 + x) * 3 + ch];
      im = resizeNearestArea(crop, c, c, SIDE, SIDE);
    }
    const dx = Math.floor(Math.random() * 7) - 3, dy = Math.floor(Math.random() * 7) - 3, flip = Math.random() < 0.5;
    const br = 0.7 + Math.random() * 0.6, cast = [0.9 + Math.random() * 0.2, 0.9 + Math.random() * 0.2, 0.9 + Math.random() * 0.2];
    const ct = 0.75 + Math.random() * 0.5;
    const o = new Float32Array(S2);
    let mean = 0;
    for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
      const sy = (y - dy + SIDE) % SIDE, sx0 = (x - dx + SIDE) % SIDE, sx = flip ? SIDE - 1 - sx0 : sx0;
      for (let ch = 0; ch < 3; ch++) { const v = im[(sy * SIDE + sx) * 3 + ch] * br * cast[ch]; o[(y * SIDE + x) * 3 + ch] = v; mean += v; }
    }
    mean /= S2;
    for (let i = 0; i < S2; i++) o[i] = (o[i] - mean) * ct + mean;
    if (Math.random() < 0.3) {
      const s = 6 + Math.floor(Math.random() * 6);
      const y0 = Math.floor(Math.random() * (SIDE - s + 1)), x0 = Math.floor(Math.random() * (SIDE - s + 1));
      const col = [Math.random(), Math.random(), Math.random()];
      for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) for (let ch = 0; ch < 3; ch++) o[(y * SIDE + x) * 3 + ch] = col[ch];
    }
    for (let i = 0; i < S2; i++) out[b * S2 + i] = Math.max(0, Math.min(1, o[i]));
  }
  return out;
}

// ---------------------------------------------------------------- picture -> 32x32 input
export function fromBytes(raw) {
  // shared example: 3072 bytes = colour 32x32, 400 bytes = old 20x20 grey sketch
  if (raw.length === SIDE * SIDE * 3) return raw;
  if (raw.length === 400) {
    const out = new Uint8Array(SIDE * SIDE * 3);
    for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
      const v = raw[Math.floor((y * 20) / SIDE) * 20 + Math.floor((x * 20) / SIDE)];
      const o = (y * SIDE + x) * 3; out[o] = out[o + 1] = out[o + 2] = v;
    }
    return out;
  }
  return null;
}

export function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
