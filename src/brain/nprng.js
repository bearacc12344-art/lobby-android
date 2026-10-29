// Exact port of numpy's default_rng(seed).standard_normal() (SeedSequence -> PCG64 -> ziggurat), so a brand-new label
// gets exactly the same starting weights on a phone as on a PC (needed for the community brain to merge cleanly).
import Z from './ziggurat.json' with { type: 'json' };

const M32 = 0xffffffffn, M64 = (1n << 64n) - 1n, M128 = (1n << 128n) - 1n;
const MULT = (2549297995355413924n << 64n) | 4865540595714422341n;
const KI = Z.ki.map(BigInt), WI = Z.wi, FI = Z.fi;
const NOR_R = 3.6541528853610087963519472518, NOR_INV_R = 0.27366123732975827203338247596;

function u32(x) { return x >>> 0; }
function mul32(a, b) { return Math.imul(a, b) >>> 0; }

function seedSequenceState(seed, nWords64) {
  // entropy -> uint32 words, least significant first
  let words = [];
  let s = BigInt(seed);
  if (s === 0n) words = [0];
  while (s > 0n) { words.push(Number(s & M32)); s >>= 32n; }
  const POOL = 4;
  let hc = 0x43b0d7e5;
  const hashmix = (v) => {
    v = u32(v ^ hc);
    hc = mul32(hc, 0x931e8875);
    v = mul32(v, hc);
    return u32(v ^ (v >>> 16));
  };
  const mix = (x, y) => {
    let r = u32(mul32(0xca01f9dd, x) - mul32(0x4973f715, y));
    return u32(r ^ (r >>> 16));
  };
  const pool = new Array(POOL);
  for (let i = 0; i < POOL; i++) pool[i] = hashmix(i < words.length ? words[i] : 0);
  for (let s2 = 0; s2 < POOL; s2++) for (let d = 0; d < POOL; d++) if (s2 !== d) pool[d] = mix(pool[d], hashmix(pool[s2]));
  for (let s2 = POOL; s2 < words.length; s2++) for (let d = 0; d < POOL; d++) pool[d] = mix(pool[d], hashmix(words[s2]));
  // generate_state(n, uint64): 2n uint32 words, viewed little-endian as uint64
  let hb = 0x8b51f9dd;
  const out32 = [];
  for (let i = 0; i < nWords64 * 2; i++) {
    let v = pool[i % POOL];
    v = u32(v ^ hb);
    hb = mul32(hb, 0x58f38ded);
    v = mul32(v, hb);
    out32.push(u32(v ^ (v >>> 16)));
  }
  const out = [];
  for (let i = 0; i < nWords64; i++) out.push(BigInt(out32[2 * i]) | (BigInt(out32[2 * i + 1]) << 32n));
  return out;
}

export class NumpyRNG {
  constructor(seed) {
    const v = seedSequenceState(seed, 4);
    const initstate = (v[0] << 64n) | v[1];
    const initseq = (v[2] << 64n) | v[3];
    this.inc = ((initseq << 1n) | 1n) & M128;
    this.state = 0n;
    this.step();
    this.state = (this.state + initstate) & M128;
    this.step();
  }
  step() { this.state = (this.state * MULT + this.inc) & M128; }
  nextU64() {
    this.step();
    const hi = this.state >> 64n, lo = this.state & M64;
    const x = hi ^ lo, rot = Number(hi >> 58n);
    return ((x >> BigInt(rot)) | (x << BigInt((64 - rot) & 63))) & M64;
  }
  nextDouble() { return Number(this.nextU64() >> 11n) * (1.0 / 9007199254740992.0); }
  standardNormal() {
    for (;;) {
      let r = this.nextU64();
      const idx = Number(r & 0xffn);
      r >>= 8n;
      const sign = Number(r & 1n);
      const rabs = (r >> 1n) & 0x000fffffffffffffn;
      let x = Number(rabs) * WI[idx];
      if (sign) x = -x;
      if (rabs < KI[idx]) return x;
      if (idx === 0) {
        for (;;) {
          const xx = -NOR_INV_R * Math.log1p(-this.nextDouble());
          const yy = -Math.log1p(-this.nextDouble());
          if (yy + yy > xx * xx) return Number((rabs >> 8n) & 1n) ? -(NOR_R + xx) : NOR_R + xx;
        }
      } else if ((FI[idx - 1] - FI[idx]) * this.nextDouble() + FI[idx] < Math.exp(-0.5 * x * x)) {
        return x;
      }
    }
  }
}
