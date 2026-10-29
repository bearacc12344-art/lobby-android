// Background trainer for the community picture brain (port of brain.Brain's data + training thread).
// Runs in a Web Worker so training never makes the app stutter.
import { Net, augment, fromBytes, unb64, NOTHING, MAX_LABELS, VERSION, HID, SIDE } from './visionModel.js';

const S2 = SIDE * SIDE * 3;
const NOTHING_WEIGHT = 0.6;
const BATCH = 24;

let net = null;
let NOTHING_X = null;              // Uint8Array 280*3072
let nNothing = 0;
const examples = new Map();        // id -> {label, x: Uint8Array, author, name, created}
const hashes = new Set();
let X = null, y = null, Xv = null, yv = null, byClass = [], exLoss = null;
let dirty = true, lastRebuild = 0;
const contrib = {};                // pub -> {name, steps, ex}
let history = [];
let myPub = null, myName = 'me', mySteps = 0, unpublished = 0;
let acc = null, classAcc = {}, loss = null;
let proto = null, radius = null;
const lastCkptFrom = {}, peersSeen = {};
let loaded = false;
let training = false;
let timer = null;

const isVal = (id) => parseInt(id.slice(-2), 16) % 8 === 0;
const hashOf = (label, px) => {
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
  const s = label + '\0' + px;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519); }
  return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
};

function addEx(ex) {
  if (examples.has(ex.id)) return false;
  let x;
  try { x = fromBytes(unb64(ex.px)); } catch (e) { return false; }
  if (!x) return false;
  hashes.add(hashOf(ex.label, ex.px));
  examples.set(ex.id, { label: ex.label, x, author: ex.author, name: ex.name || '', created: ex.created || 0 });
  const c = contrib[ex.author] || (contrib[ex.author] = { name: ex.name || '', steps: 0, ex: 0 });
  c.ex++;
  if (ex.name) c.name = ex.name;
  dirty = true;
  return true;
}

function labelsInOrder() {
  const seen = [NOTHING];
  for (const e of [...examples.values()].sort((a, b) => a.created - b.created)) if (!seen.includes(e.label)) seen.push(e.label);
  return seen.slice(0, MAX_LABELS);
}
const userLabels = () => net.labels.filter((l) => l !== NOTHING);
const totalSteps = () => Object.values(contrib).reduce((s, c) => s + c.steps, 0);

function rebuild() {
  net.ensureLabels(labelsInOrder());
  const tr = [], va = [];
  for (const [id, e] of examples) {
    const c = net.labels.indexOf(e.label);
    if (c >= 0) (isVal(id) ? va : tr).push([e.x, c]);
  }
  const k0 = net.labels.indexOf(NOTHING);
  for (let i = 0; i < nNothing; i++) (i % 8 === 0 ? va : tr).push([NOTHING_X.subarray(i * S2, i * S2 + S2), k0]);
  const have = new Set(va.map((t) => t[1]));
  for (const t of tr) if (!have.has(t[1])) va.push(t);
  const old = new Map();
  if (X && exLoss && X.length / S2 < 20000) for (let i = 0; i < exLoss.length; i++) old.set(keyOf(X, i), exLoss[i]);
  X = pack(tr); y = Int32Array.from(tr.map((t) => t[1]));
  Xv = pack(va); yv = Int32Array.from(va.map((t) => t[1]));
  byClass = net.labels.map((_, c) => { const ix = []; for (let i = 0; i < y.length; i++) if (y[i] === c) ix.push(i); return ix; });
  exLoss = new Float32Array(y.length).fill(1);
  if (old.size) for (let i = 0; i < y.length; i++) { const v = old.get(keyOf(X, i)); if (v !== undefined) exLoss[i] = v; }
  dirty = false;
  lastRebuild = Date.now();
}
function pack(list) {
  const out = new Uint8Array(list.length * S2);
  list.forEach((t, i) => out.set(t[0], i * S2));
  return out;
}
function keyOf(arr, i) {
  // cheap fingerprint of one picture
  let h = 2166136261;
  const o = i * S2;
  for (let j = 0; j < S2; j += 7) h = Math.imul(h ^ arr[o + j], 16777619);
  return h;
}

function choice(weights) {
  let s = 0;
  for (const w of weights) s += w;
  let r = Math.random() * s;
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
  return weights.length - 1;
}
function sampleBatch() {
  const classes = byClass.map((ix, c) => [ix, c]).filter((t) => t[0].length);
  const w = classes.map(([, c]) => (net.labels[c] === NOTHING ? NOTHING_WEIGHT : 1));
  const idx = new Int32Array(BATCH);
  for (let j = 0; j < BATCH; j++) {
    const ix = classes[choice(w)][0];
    idx[j] = ix.length > 1 ? ix[choice(ix.map((i) => 0.3 + exLoss[i]))] : ix[0];
  }
  return idx;
}

function trainBurst() {
  if (dirty && (!X || Date.now() - lastRebuild > 5000)) rebuild();
  const ready = X && userLabels().length >= 1;
  if (ready) {
    for (let s = 0; s < 3; s++) {
      const idx = sampleBatch();
      const xb = augment(X, idx);
      const yb = Int32Array.from(idx, (i) => y[i]);
      const per = net.step(xb, yb, BATCH);
      let m = 0;
      for (let j = 0; j < BATCH; j++) { exLoss[idx[j]] = 0.6 * exLoss[idx[j]] + 0.4 * Math.min(per[j], 5); m += per[j]; }
      loss = m / BATCH;
    }
    mySteps += 3; unpublished += 3;
    if (myPub) { const c = contrib[myPub] || (contrib[myPub] = { name: myName, steps: 0, ex: 0 }); c.steps = mySteps; }
  }
  return ready;
}
function loop() {
  timer = null;
  if (!training || !loaded) return;
  let ready = false;
  try { ready = trainBurst(); } catch (e) { console.warn('brain train', e); }
  timer = setTimeout(loop, ready ? 1000 : 2000);
}

function toFloat(u8) { const f = new Float32Array(u8.length); for (let i = 0; i < u8.length; i++) f[i] = u8[i] / 255; return f; }

function score(cap = 360) {
  const k = net.labels.length, n = yv.length;
  let ix = [...Array(n).keys()];
  if (n > cap) {
    ix = [];
    const per = Math.max(8, Math.floor(cap / k));
    for (let c = 0; c < k; c++) { let got = 0; for (let i = 0; i < n && got < per; i++) if (yv[i] === c) { ix.push(i); got++; } }
  }
  const right = new Array(k).fill(0), tot = new Array(k).fill(0);
  for (let s = 0; s < ix.length; s += 32) {
    const part = ix.slice(s, s + 32);
    const xb = new Float32Array(part.length * S2);
    part.forEach((i, j) => { for (let q = 0; q < S2; q++) xb[j * S2 + q] = Xv[i * S2 + q] / 255; });
    const { probs } = net.forward(xb, part.length);
    part.forEach((i, j) => {
      let best = 0;
      for (let c = 1; c < k; c++) if (probs[j * k + c] > probs[j * k + best]) best = c;
      tot[yv[i]]++;
      if (best === yv[i]) right[yv[i]]++;
    });
  }
  const ca = {};
  for (let c = 0; c < k; c++) if (tot[c]) ca[net.labels[c]] = right[c] / tot[c];
  const vals = Object.values(ca);
  return [ca, vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null];
}

function calibrate() {
  if (!X || !byClass.length) return;
  const k = net.labels.length;
  const p = new Float32Array(k * HID), r = new Float32Array(k).fill(Infinity);
  byClass.forEach((ix, c) => {
    if (!ix.length) return;
    const step = Math.max(1, Math.floor(ix.length / 40));
    const pick = ix.filter((_, i) => i % step === 0).slice(0, 40);
    const xb = new Float32Array(pick.length * S2);
    pick.forEach((i, j) => { for (let q = 0; q < S2; q++) xb[j * S2 + q] = X[i * S2 + q] / 255; });
    const f = net.features(xb, pick.length);
    const m = new Float32Array(HID);
    for (let j = 0; j < pick.length; j++) {
      let nr = 0;
      for (let q = 0; q < HID; q++) nr += f[j * HID + q] ** 2;
      nr = Math.sqrt(nr) + 1e-6;
      for (let q = 0; q < HID; q++) { f[j * HID + q] /= nr; m[q] += f[j * HID + q] / pick.length; }
    }
    let mn = 0;
    for (let q = 0; q < HID; q++) mn += m[q] ** 2;
    mn = Math.sqrt(mn) + 1e-6;
    for (let q = 0; q < HID; q++) m[q] /= mn;
    const d = [];
    for (let j = 0; j < pick.length; j++) { let s = 0; for (let q = 0; q < HID; q++) s += f[j * HID + q] * m[q]; d.push(1 - s); }
    d.sort((a, b) => a - b);
    const p95 = d[Math.min(d.length - 1, Math.floor(0.95 * (d.length - 1) + 0.5))];
    p.set(m, c * HID);
    r[c] = Math.max(0.05, p95 * 1.3);
  });
  proto = p; radius = r;
}

function housekeeping() {
  if (dirty) rebuild();
  if (!Xv || !userLabels().length) { acc = null; return; }
  [classAcc, acc] = score();
  calibrate();
}

function think(x) {
  const preds = net.predict(x);
  const mature = Math.max(mySteps, totalSteps()) >= 1500 && (acc || 0) >= 0.8;
  if (!mature || !proto || preds.length < 2 || radius.length !== net.labels.length) return { preds, fam: null, closest: null };
  const f = net.features(x, 1);
  let nr = 0;
  for (let q = 0; q < HID; q++) nr += f[q] ** 2;
  nr = Math.sqrt(nr) + 1e-6;
  let best = -1, bestR = Infinity;
  net.labels.forEach((l, i) => {
    if (l === NOTHING || !Number.isFinite(radius[i])) return;
    let s = 0;
    for (let q = 0; q < HID; q++) s += proto[i * HID + q] * f[q] / nr;
    const ratio = (1 - s) / radius[i];
    if (ratio < bestR) { bestR = ratio; best = i; }
  });
  if (best < 0) return { preds, fam: null, closest: null };
  return { preds, fam: Math.max(0, Math.min(1, 1.5 - bestR)), closest: net.labels[best] };
}

function addPoint() {
  if (acc === null || !userLabels().length) return;
  history.push([Math.floor(Date.now() / 1000), Math.round(acc * 10000) / 10000, examples.size, totalSteps(), (myPub || '').slice(0, 8)]);
  dedupeHistory();
}
function dedupeHistory() {
  const m = new Map();
  for (const h of history) m.set(h[0] + ':' + h[4], h);
  history = [...m.values()].sort((a, b) => a[0] - b[0] || (a[4] < b[4] ? -1 : 1)).slice(-300);
}

function checkpoint() {
  if (!X) rebuild();
  if (acc === null && Xv && userLabels().length) [classAcc, acc] = score();
  addPoint();
  const c = {};
  for (const [p, v] of Object.entries(contrib)) if (v.steps) c[p] = [v.name, v.steps];
  unpublished = 0;
  return JSON.stringify({ v: VERSION, labels: net.labels, w: net.pack(), steps: mySteps, name: myName, acc, n_ex: examples.size, contrib: c, hist: history.slice(-60) });
}

function merge(author, content, { alpha = 0.5, own = false, created = 0 } = {}) {
  let ck, labels, arrays;
  try {
    ck = JSON.parse(content);
    if (ck.v !== VERSION) return;
    labels = ck.labels.map((l) => String(l).slice(0, 16)).slice(0, MAX_LABELS);
    arrays = Net.unpack(ck.w, labels);
  } catch (e) { return; }
  if (own) {
    net.blend(arrays, labels, 1.0);
    mySteps = parseInt(ck.steps || 0, 10) || 0;
  } else {
    if ((lastCkptFrom[author] || 0) >= created) return;
    lastCkptFrom[author] = created;
    const a = mySteps === 0 && !Object.keys(peersSeen).length ? 1.0 : alpha;   // fresh phones adopt the community copy
    net.blend(arrays, labels, a);
  }
  peersSeen[author] = created;
  for (const [p, v] of Object.entries(ck.contrib || {})) {
    const c = contrib[p] || (contrib[p] = { name: '', steps: 0, ex: 0 });
    c.steps = Math.max(c.steps, parseInt(v[1], 10) || 0);
    if (v[0]) c.name = String(v[0]).slice(0, 32);
  }
  for (const h of (ck.hist || []).slice(-80)) if (Array.isArray(h) && h.length === 5 && typeof h[1] === 'number' && h[1] >= 0 && h[1] <= 1) history.push(h);
  dedupeHistory();
  dirty = true;
}

function stats(withRecent) {
  const counts = {};
  for (const e of examples.values()) counts[e.label] = (counts[e.label] || 0) + 1;
  const out = {
    loaded, acc, loss, nEx: examples.size, labels: net ? [...net.labels] : [], userLabels: net ? userLabels() : [], counts, classAcc,
    contrib: JSON.parse(JSON.stringify(contrib)), history, totalSteps: totalSteps(), mySteps, unpublished, myPub,
    online: Object.values(peersSeen).filter((t) => Date.now() / 1000 - t < 180).length,
    filters: net ? net.convs[0][0].slice() : null,
  };
  if (withRecent) {
    out.recent = [...examples.values()].sort((a, b) => b.created - a.created).slice(0, 24).map((e) => ({ label: e.label, x: e.x, name: e.name }));
  }
  return out;
}

self.onmessage = (e) => {
  const { id, op, d } = e.data;
  let res = null;
  try {
    if (op === 'init') {
      net = new Net(new Float32Array(d.genesis));
      NOTHING_X = new Uint8Array(d.nothing);
      nNothing = NOTHING_X.length / S2;
    } else if (op === 'load') {
      myPub = d.data.me; myName = d.name || myName;
      for (const ex of d.data.examples) addEx(ex);
      if (d.data.mine) merge(myPub, d.data.mine, { own: true });
      for (const ck of d.data.ckpts) merge(ck.author, ck.content, { created: ck.created });
      loaded = true;
      if (training && !timer) loop();
    } else if (op === 'add') {
      res = addEx(d.ex);
    } else if (op === 'merge') {
      merge(d.author, d.content, { created: d.created });
    } else if (op === 'train') {
      training = !!d.on;
      if (d.name) myName = d.name;
      if (training && !timer && loaded) loop();
      if (!training && timer) { clearTimeout(timer); timer = null; }
    } else if (op === 'housekeeping') {
      if (loaded) { housekeeping(); if (d && d.point) addPoint(); }
    } else if (op === 'think') {
      res = think(new Float32Array(d.x));
    } else if (op === 'checkpoint') {
      if (d && d.name) myName = d.name;
      res = loaded && net.labels.length ? checkpoint() : null;
    } else if (op === 'stats') {
      res = stats(d && d.recent);
    } else if (op === 'dupe') {
      res = hashes.has(hashOf(d.label, d.px));
    }
    self.postMessage({ id, ok: true, res });
  } catch (err) {
    self.postMessage({ id, ok: false, err: String(err && err.message || err) });
  }
};
