// Real-time audio for calls (runs on the audio thread). Wire format identical to PC Smult (media.py):
// packet = [rate code 0/1/2 = 16/24/48 kHz][mu-law bytes of one 20 ms frame]
const MU = 255, LOG1P_MU = Math.log1p(MU);
const RATE_CODES = { 0: 16000, 1: 24000, 2: 48000 };
const CODE_FOR = { 16000: 0, 24000: 1, 48000: 2 };

function mulawEncode(x) {
  const out = new Uint8Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = Math.max(-1, Math.min(1, x[i]));
    const y = Math.sign(v) * Math.log1p(MU * Math.abs(v)) / LOG1P_MU;
    out[i] = Math.floor((y + 1) * 127.5);
  }
  return out;
}
function mulawDecode(b) {
  const out = new Float32Array(b.length);
  for (let i = 0; i < b.length; i++) {
    const y = b[i] / 127.5 - 1;
    out[i] = Math.sign(y) * (Math.pow(1 + MU, Math.abs(y)) - 1) / MU;
  }
  return out;
}
function resample(x, n) {   // same as np.interp(np.linspace(0, len-1, n), arange(len), x)
  if (x.length === n) return x;
  const out = new Float32Array(n);
  if (!x.length) return out;
  const scale = n > 1 ? (x.length - 1) / (n - 1) : 0;
  for (let i = 0; i < n; i++) {
    const p = i * scale, j = Math.floor(p), f = p - j;
    out[i] = j + 1 < x.length ? x[j] * (1 - f) + x[j + 1] * f : x[x.length - 1];
  }
  return out;
}

class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameLen = Math.round(sampleRate * 0.02);
    this.buf = new Float32Array(this.frameLen);
    this.n = 0;
    this.gain = 1; this.gateDb = -50; this.highpass = true; this.muted = false; this.sendRate = 24000; this.inCall = false;
    this.px = 0; this.py = 0; this.gateUntil = 0; this.t = 0;
    this.effects = [];     // [Float32Array, pos, vol] mixed into what I send (soundboard)
    this.lastLevel = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.cfg) Object.assign(this, d.cfg);
      if (d.effect) this.effects.push([d.effect, 0, d.vol || 1]);
      if (d.stopEffects) this.effects = [];
    };
  }
  frame() {
    let x = this.buf;
    for (let i = 0; i < x.length; i++) x[i] *= this.gain;
    if (this.highpass) {        // one-pole high-pass ~90 Hz (removes rumble / desk bumps)
      const a = 0.988;
      let px = this.px, py = this.py;
      for (let i = 0; i < x.length; i++) { py = a * (py + x[i] - px); px = x[i]; x[i] = py; }
      this.px = px; this.py = py;
    }
    let s = 0;
    for (let i = 0; i < x.length; i++) s += x[i] * x[i];
    const rms = Math.sqrt(s / x.length) + 1e-9;
    const db = 20 * Math.log10(rms);
    this.t += 0.02;
    if (db > this.gateDb) this.gateUntil = this.t + 0.25;
    const talking = this.t < this.gateUntil && !this.muted;
    if (!talking) x.fill(0);
    let any = talking;
    if (this.effects.length) {
      const keep = [];
      for (const e of this.effects) {
        const [arr, pos, vol] = e;
        const end = Math.min(arr.length, pos + x.length);
        for (let i = pos; i < end; i++) x[i - pos] += arr[i] * vol;
        e[1] = end;
        if (end < arr.length) keep.push(e);
        any = true;
      }
      this.effects = keep;
    }
    this.port.postMessage({ level: talking ? rms : 0, db });
    if (!this.inCall || !any) return;
    // to send rate: average groups of samples like PC (x.reshape(-1, step).mean(1)) after normalising to 48 kHz
    const at48 = sampleRate === 48000 ? x : resample(x, 960);
    const step = 48000 / this.sendRate;
    const n = 960 / step;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let a = 0;
      for (let k = 0; k < step; k++) a += at48[i * step + k];
      out[i] = Math.max(-1, Math.min(1, a / step));
    }
    const enc = mulawEncode(out);
    const pkt = new Uint8Array(enc.length + 1);
    pkt[0] = CODE_FOR[this.sendRate] ?? 1;
    pkt.set(enc, 1);
    this.port.postMessage({ pkt }, [pkt.buffer]);
  }
  process(inputs) {
    const inp = inputs[0] && inputs[0][0];
    if (inp) {
      for (let i = 0; i < inp.length; i++) {
        this.buf[this.n++] = inp[i];
        if (this.n === this.frameLen) { this.frame(); this.buf = new Float32Array(this.frameLen); this.n = 0; }
      }
    }
    return true;
  }
}

class OutProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameLen = Math.round(sampleRate * 0.02);
    this.q = new Map();       // uid -> [Float32Array frames]
    this.cur = new Map();     // uid -> [frame, pos]
    this.started = new Map();
    this.vol = {}; this.muted = new Set(); this.deaf = false; this.out = 1;
    this.levels = {}; this.k = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.cfg) {
        if ('deaf' in d.cfg) this.deaf = d.cfg.deaf;
        if ('vol' in d.cfg) this.vol = d.cfg.vol;
        if ('muted' in d.cfg) this.muted = new Set(d.cfg.muted);
        if ('out' in d.cfg) this.out = d.cfg.out;
        if (d.cfg.reset) { this.q.clear(); this.cur.clear(); this.started.clear(); }
      }
      if (d.pkt) this.receive(d.uid, d.pkt);
    };
  }
  receive(uid, b) {
    if (!b.length) return;
    const rate = RATE_CODES[b[0]] || 24000;
    let pcm = mulawDecode(b.subarray(1));
    pcm = resample(pcm, Math.round(pcm.length * 48000 / rate));    // to 48 kHz like PC
    if (pcm.length !== 960) { const f = new Float32Array(960); f.set(pcm.subarray(0, 960)); pcm = f; }
    if (sampleRate !== 48000) pcm = resample(pcm, this.frameLen);
    let dq = this.q.get(uid);
    if (!dq) { dq = []; this.q.set(uid, dq); }
    dq.push(pcm);
    if (dq.length > 12) dq.splice(0, dq.length - 3);   // too much latency, catch up
    let s = 0;
    for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i];
    this.levels[uid] = Math.sqrt(s / pcm.length);
  }
  process(_, outputs) {
    const out = outputs[0][0];
    out.fill(0);
    if (!this.deaf) {
      for (const [uid, dq] of this.q) {
        if (!this.started.get(uid)) { if (dq.length >= 3) this.started.set(uid, true); else continue; }
        const v = (this.vol[uid] ?? 1) * this.out;
        const silent = this.muted.has(uid);
        let i = 0;
        while (i < out.length) {
          let c = this.cur.get(uid);
          if (!c || c[1] >= c[0].length) {
            const f = dq.shift();
            if (!f) { this.started.set(uid, false); this.levels[uid] = 0; this.cur.delete(uid); break; }
            c = [f, 0];
            this.cur.set(uid, c);
          }
          const take = Math.min(out.length - i, c[0].length - c[1]);
          if (!silent) for (let k = 0; k < take; k++) out[i + k] += c[0][c[1] + k] * v;
          c[1] += take;
          i += take;
        }
      }
    }
    for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
    for (let ch = 1; ch < outputs[0].length; ch++) outputs[0][ch].set(out);
    if (++this.k % 12 === 0) this.port.postMessage({ levels: this.levels });
    return true;
  }
}

registerProcessor('lobby-mic', MicProcessor);
registerProcessor('lobby-out', OutProcessor);
