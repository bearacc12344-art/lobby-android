// The community language brain on a phone (Brain 4): keeps the text library, downloads + averages the tiny GPT that
// everyone's PCs train, scores it and writes with it. (Training a transformer is PC work - phones only feed text.)
import { LangNet, normalize, encode, CTX, VERSION, VOCAB } from './langModel.js';

const SEP = encode('\n\n');
let net = null;
const chunks = new Map();          // id -> {ids, author, name, doc, created}
const hashes = new Set();
let train = null, Xv = null, yv = null, nv = 0;
let dirty = true, lastRebuild = 0;
const contrib = {};
let history = [];
let myPub = null, myName = 'me', mySteps = 0, unpublished = 0, bpc = null;
const lastCkptFrom = {}, peersSeen = {};
let loaded = false, training = false, timer = null;

const isVal = (id) => parseInt(id.slice(-2), 16) % 10 === 0;
export function hashText(s) {
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519); }
  return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16) + s.length;
}

function add(c) {
  if (chunks.has(c.id)) return;
  const ids = encode(normalize(c.text));
  if (ids.length < 2) return;
  hashes.add(hashText(c.text));
  chunks.set(c.id, { ids, author: c.author, name: c.name || '', doc: c.doc || '', created: c.created || 0 });
  const k = contrib[c.author] || (contrib[c.author] = { name: c.name || '', steps: 0, chars: 0 });
  k.chars += ids.length;
  if (c.name) k.name = c.name;
  dirty = true;
}
function cat(list) {
  const n = list.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const a of list) { out.set(a, o); o += a.length; }
  return out;
}
function rebuild() {
  dirty = false;
  let tr = [], va = [];
  for (const [id, c] of [...chunks.entries()].sort((a, b) => a[1].created - b[1].created)) (isVal(id) ? va : tr).push(c.ids, SEP);
  if (va.reduce((s, a) => s + a.length, 0) < 2000) { tr = tr.concat(va); va = tr; }
  train = tr.length ? cat(tr) : null;
  const val = va.length ? cat(va) : null;
  if (val && val.length > CTX + 10) {
    nv = 6;                                         // a few passages: enough for a score, cheap on a phone
    Xv = new Uint8Array(nv * CTX); yv = new Uint8Array(nv * CTX);
    let seed = 7;
    const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
    for (let b = 0; b < nv; b++) {
      const i = Math.floor(rnd() * (val.length - CTX - 1));
      Xv.set(val.subarray(i, i + CTX), b * CTX);
      yv.set(val.subarray(i + 1, i + CTX + 1), b * CTX);
    }
  } else { Xv = yv = null; nv = 0; }
  lastRebuild = Date.now();
}
const chars = () => { let s = 0; for (const c of chunks.values()) s += c.ids.length; return s; };
const totalSteps = () => Object.values(contrib).reduce((s, c) => s + c.steps, 0);

function burst() {                                 // (phones don't train the tiny GPT)
  return false;
}
function oldBurst() {
  if (dirty && (!train || Date.now() - lastRebuild > 5000)) rebuild();
  const ready = train && train.length > CTX * 20;
  if (ready) {
    const B = 128;
    const X = new Uint8Array(B * CTX), y = new Uint8Array(B);
    for (let s = 0; s < 6; s++) {
      for (let b = 0; b < B; b++) {
        const i = CTX + Math.floor(Math.random() * (train.length - CTX));
        X.set(train.subarray(i - CTX, i), b * CTX);
        y[b] = train[i];
      }
      net.step(X, y, B);
    }
    mySteps += 6; unpublished += 6;
    if (myPub) { const k = contrib[myPub] || (contrib[myPub] = { name: myName, steps: 0, chars: 0 }); k.steps = mySteps; }
  }
  return ready;
}
function loop() {
  timer = null;
  if (!training || !loaded) return;
  let ready = false;
  try { ready = burst(); } catch (e) { console.warn('lang train', e); }
  timer = setTimeout(loop, ready ? 600 : 2000);
}
function measure() {
  if (!Xv || net.empty) { bpc = null; return; }
  bpc = net.loss(Xv, yv, nv) / Math.log(2);
}
function addPoint(n) {
  if (bpc === null) return;
  history.push([Math.floor(Date.now() / 1000), Math.round(bpc * 1000) / 1000, n === undefined ? chars() : n, totalSteps(), (myPub || '').slice(0, 8)]);
  dedupe();
}
function dedupe() {
  const m = new Map();
  for (const h of history) m.set(h[0] + ':' + h[4], h);
  history = [...m.values()].sort((a, b) => a[0] - b[0] || (a[4] < b[4] ? -1 : 1)).slice(-300);
}
function checkpoint() {
  const n = chars();
  measure();
  addPoint(n);
  const [w, s] = net.pack();
  const c = {};
  for (const [p, v] of Object.entries(contrib)) if (v.steps) c[p] = [v.name, v.steps];
  unpublished = 0;
  return JSON.stringify({ v: VERSION, w, s, steps: mySteps, name: myName, bpc, n_chars: n, contrib: c, hist: history.slice(-50) });
}
function merge(author, content, own = false, created = 0) {
  let ck, arrays;
  try {
    ck = JSON.parse(content);
    if (ck.v !== VERSION) return;
    arrays = LangNet.unpack(ck.w, ck.s);
  } catch (e) { return; }
  if (own) { net.blend(arrays, 1.0); mySteps = parseInt(ck.steps || 0, 10) || 0; } else {
    if ((lastCkptFrom[author] || 0) >= created) return;
    lastCkptFrom[author] = created;
    net.blend(arrays, mySteps === 0 && !Object.keys(peersSeen).length ? 1.0 : 0.5);
  }
  peersSeen[author] = created;
  for (const [p, v] of Object.entries(ck.contrib || {})) {
    const c = contrib[p] || (contrib[p] = { name: '', steps: 0, chars: 0 });
    c.steps = Math.max(c.steps, parseInt(v[1], 10) || 0);
    if (v[0]) c.name = String(v[0]).slice(0, 32);
  }
  for (const h of (ck.hist || []).slice(-80)) if (Array.isArray(h) && h.length === 5 && typeof h[1] === 'number' && h[1] > 0 && h[1] < 10) history.push(h);
  dedupe();
}
function library(n = 12) {
  const docs = new Map();
  for (const c of chunks.values()) {
    const k = (c.doc || 'pasted text') + '\0' + c.name;
    const d = docs.get(k) || [0, 0];
    d[0] += c.ids.length; d[1] = Math.max(d[1], c.created);
    docs.set(k, d);
  }
  return [...docs.entries()].map(([k, [ch, t]]) => { const [doc, name] = k.split('\0'); return { doc, name, chars: ch, t }; })
    .sort((a, b) => b.t - a.t).slice(0, n);
}

self.onmessage = (e) => {
  const { id, op, d } = e.data;
  let res = null;
  try {
    if (op === 'init') net = new LangNet();
    else if (op === 'load') {
      myPub = d.data.me; myName = d.name || myName;
      for (const c of d.data.chunks) add(c);
      if (d.data.mine) merge(myPub, d.data.mine, true);
      for (const ck of d.data.ckpts) merge(ck.author, ck.content, false, ck.created);
      loaded = true;
      if (training && !timer) loop();
    } else if (op === 'add') add(d.chunk);
    else if (op === 'merge') merge(d.author, d.content, false, d.created);
    else if (op === 'train') {
      training = !!d.on;
      if (d.name) myName = d.name;
      if (training && !timer && loaded) loop();
      if (!training && timer) { clearTimeout(timer); timer = null; }
    } else if (op === 'tick') {
      if (loaded) {
        if (dirty && (d.train || d.first)) rebuild();
        if (d.train || d.first) measure();
        if (d.point) addPoint();
      }
    } else if (op === 'checkpoint') { res = null; }    // phones never publish the language brain
    else if (op === 'write') res = net.empty ? '' : net.generate(d.prompt || '', Math.min(d.n || 200, 220), d.temp || 0.7, d.stop || null);
    else if (op === 'next' && net.empty) res = [];
    else if (op === 'next') {
      const p = net.nextProbs(d.text);
      const top = [...p.keys()].sort((a, b) => p[b] - p[a]).slice(0, 6);
      res = top.map((i) => [({ ' ': '␣ space', '\n': '⏎ new line' })[VOCAB[i]] || VOCAB[i], p[i]]);
    } else if (op === 'stats') {
      res = {
        loaded, bpc, chars: chars(), docs: new Set([...chunks.values()].map((c) => c.doc)).size, totalSteps: totalSteps(), mySteps, unpublished,
        contrib: JSON.parse(JSON.stringify(contrib)), history, myPub, library: library(),
        online: Object.values(peersSeen).filter((t) => Date.now() / 1000 - t < 180).length,
      };
    } else if (op === 'dupe') res = hashes.has(hashText(d.text));
    self.postMessage({ id, ok: true, res });
  } catch (err) {
    self.postMessage({ id, ok: false, err: String(err && err.message || err) });
  }
};
