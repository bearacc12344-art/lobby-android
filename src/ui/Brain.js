// 🧠 The Smult Brain: the community picture brain + the language brain (port of brain.BrainView / lang.LangView)
import { I } from '../util/icons.js';
import { html, useBus, useEffect, useRef, useState } from './h.js';
import { ctx } from '../ctx.js';
import { S } from '../util/settings.js';
import { tr } from '../util/i18n.js';
import { fmtAgo } from '../util/format.js';
import { pickFiles } from '../util/files.js';
import { Check } from './common.js';
import { photoInput, doodleInput, fileToBitmap, bytesToCanvas, SIDE } from '../brain/pics.js';
import { stage, STAGES } from '../brain/langModel.js';

const NOTHING = 'nothing';
const PEN_COLORS = ['#ffffff', '#ff4d4d', '#ff9f1a', '#ffe14d', '#4cd964', '#3fa7ff', '#a66bff', '#ff6fb5', '#8b5a2b'];
const MEDALS = ['🥇', '🥈', '🥉'];
const fmtSecs = (s) => { s = Math.floor(s); return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };
const num = (n) => (n || 0).toLocaleString();

function Card({ title, children }) {
  return html`<div class="card" style=${{ marginTop: '10px' }}><div class="section" style=${{ marginTop: 0 }}>${tr(title)}</div>${children}</div>`;
}
function Chips({ items }) {
  return html`<div class="statchips">${items.map(([ic, v, t]) => html`<span class="chip"><span class="emoji">${ic}</span> <b>${v}</b> ${tr(t)}</span>`)}</div>`;
}
export function Bars({ preds, placeholder }) {
  if (!preds || !preds.length) return html`<div class="muted small" style=${{ textAlign: 'center', padding: '22px 8px' }}>${tr(placeholder)}</div>`;
  return html`<div class="bars">${preds.slice(0, 5).map(([l, p]) => html`<div class="barrow"><i style=${{ width: Math.max(4, p * 100) + '%' }}></i>
    <span><b>${l}</b><b>${Math.round(p * 100)}%</b></span></div>`)}</div>`;
}
function LineChart({ pts, max = 1, invert = false, fmt, empty }) {
  if (pts.length < 2) return html`<div class="muted small" style=${{ textAlign: 'center', padding: '30px 8px' }}>${tr(empty)}</div>`;
  const W = 320, H = 140, L = 28, B = 18;
  const t0 = pts[0][0], t1 = Math.max(pts[pts.length - 1][0], t0 + 1);
  const X = (t) => L + ((W - L - 4) * (t - t0)) / (t1 - t0);
  const Y = (v) => (invert ? 4 + (H - B - 4) * (Math.min(v, max) / max) : H - B - (H - B - 4) * (Math.min(v, max) / max));
  const d = pts.map(([t, v], i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const ticks = invert ? [1, 2, 3, 4, 5, 6, 7] : [0, 0.25, 0.5, 0.75, 1];
  return html`<svg viewBox="0 0 ${W} ${H}" style=${{ width: '100%', display: 'block' }}>
    <defs><linearGradient id="cg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity="0.35" /><stop offset="1" stop-color="var(--accent)" stop-opacity="0" /></linearGradient></defs>
    ${ticks.map((v) => html`<line x1=${L} x2=${W - 4} y1=${Y(v)} y2=${Y(v)} stroke="var(--border)" stroke-width="1" />
      <text x=${L - 4} y=${Y(v) + 3} text-anchor="end" font-size="9" fill="var(--muted)">${fmt(v)}</text>`)}
    <path d=${d + `L${X(t1)},${H - B}L${L},${H - B}Z`} fill="url(#cg)" />
    <path d=${d} fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" />
    <text x=${L} y=${H - 4} font-size="9" fill="var(--muted)">${fmtAgo(t0)}</text>
    <text x=${W - 4} y=${H - 4} font-size="9" fill="var(--muted)" text-anchor="end">${tr('now')}</text></svg>`;
}
function PixelCanvas({ x, size = 64, cls = '' }) {
  const ref = useRef();
  useEffect(() => {
    const c = ref.current;
    if (!c || !x) return;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(bytesToCanvas(x), 0, 0, c.width, c.height);
  }, [x]);
  return html`<canvas ref=${ref} width=${size} height=${size} class=${cls} style=${{ imageRendering: 'pixelated' }}></canvas>`;
}
function Filters({ W }) {
  const ref = useRef();
  useEffect(() => {
    const c = ref.current;
    if (!c || !W) return;
    const n = 16, cell = 3;
    const g = c.getContext('2d');
    const im = g.createImageData(n * (cell + 1), cell);
    for (let k = 0; k < n; k++) {
      let m = 1e-6;
      for (let i = 0; i < 27; i++) m = Math.max(m, Math.abs(W[i * n + k]));
      for (let ky = 0; ky < 3; ky++) for (let kx = 0; kx < 3; kx++) {
        const o = (ky * im.width + k * (cell + 1) + kx) * 4;
        for (let ch = 0; ch < 3; ch++) im.data[o + ch] = Math.round(255 * (0.5 + 0.5 * W[((ky * 3 + kx) * 3 + ch) * n + k] / m));
        im.data[o + 3] = 255;
      }
    }
    g.putImageData(im, 0, 0);
  }, [W]);
  return html`<canvas ref=${ref} width=${16 * 4} height=${3} style=${{ width: '100%', imageRendering: 'pixelated', display: 'block' }}></canvas>`;
}
function Board({ contrib, score, line }) {
  const rows = Object.values(contrib || {}).sort((a, b) => score(b) - score(a)).slice(0, 8);
  if (!rows.length) return html`<div class="muted">${tr('nobody yet. be the first!')}</div>`;
  return html`<div>${rows.map((c, i) => html`<div style=${{ padding: '3px 0' }}><span class="emoji">${MEDALS[i] || '·'}</span> <b>${c.name || tr('someone')}</b> <span class="muted small">— ${line(c)}</span></div>`)}</div>`;
}

// ===================================================================== drawing pad
function Pad({ padRef, pen, eraser, onChange }) {
  const last = useRef(null);
  const cvRef = useRef();
  useEffect(() => {
    const c = cvRef.current;
    padRef.current = { canvas: c, photo: false, clear() { const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 300, 300); this.photo = false; onChange(); } };
    padRef.current.clear();
  }, []);
  const pos = (e) => { const r = cvRef.current.getBoundingClientRect(); return [((e.clientX - r.left) * 300) / r.width, ((e.clientY - r.top) * 300) / r.height]; };
  const line = (a, b) => {
    const g = cvRef.current.getContext('2d');
    g.strokeStyle = eraser ? '#000' : pen;
    g.lineWidth = eraser ? 36 : 18;
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
  };
  return html`<canvas ref=${cvRef} width="300" height="300" class="pad-canvas"
    onPointerDown=${(e) => { e.target.setPointerCapture(e.pointerId); if (padRef.current.photo) padRef.current.photo = false; last.current = pos(e); line(last.current, last.current); }}
    onPointerMove=${(e) => { if (!last.current) return; const p = pos(e); line(last.current, p); last.current = p; }}
    onPointerUp=${() => { last.current = null; onChange(); }} onPointerCancel=${() => { last.current = null; onChange(); }}></canvas>`;
}

// ===================================================================== pictures
function VisionPage() {
  useBus(['brain', 'brainjob']);
  const b = ctx.brain;
  const st = b ? b.st : {};
  const pad = useRef(null);
  const [feeding, setFeeding] = useState(false);
  const [pen, setPen] = useState(PEN_COLORS[0]);
  const [eraser, setEraser] = useState(false);
  const [label, setLabel] = useState('');
  const [seen, setSeen] = useState(null);
  const [res, setRes] = useState(null);
  const job = ctx.brainJob;

  const vector = () => {
    const p = pad.current;
    if (!p) return null;
    return p.photo ? photoInput(p.canvas, 300, 300) : doodleInput(p.canvas);
  };
  const onDraw = async () => {
    const x = vector();
    setSeen(x);
    if (!x || !b || !b.loaded) { setRes(null); return; }
    try { setRes(await b.think(x)); } catch (e) { setRes(null); }
  };
  useEffect(() => { onDraw(); }, [st.labels && st.labels.join(), st.acc]);

  const loadPhoto = async (file) => {
    try {
      const bmp = await fileToBitmap(file, 600);
      const sq = document.createElement('canvas');
      sq.width = sq.height = 300;
      const g = pad.current.canvas.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, 300, 300);
      const sc = 300 / Math.max(bmp.width, bmp.height);
      const w = Math.round(bmp.width * sc), h = Math.round(bmp.height * sc);
      g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, Math.floor((300 - w) / 2), Math.floor((300 - h) / 2), w, h);
      pad.current.photo = true;
      ctx.toast(feeding ? '🖼 Picture loaded — name it and hit Teach it ✨' : '🖼 Picture loaded — see what it guesses!');
      onDraw();
    } catch (e) { ctx.toast(`Couldn't read ${file.name}: ${e.message || e}`, 'error'); }
  };
  const pick = async (capture) => {
    const files = await pickFiles({ accept: 'image/*', multiple: !capture, capture });
    if (!files.length) return;
    if (files.length === 1) return loadPhoto(files[0]);
    importMany(files);
  };
  const importMany = async (files) => {
    if (ctx.brainJob) return ctx.toast('An import is already running — wait for it or cancel it first');
    const known = Object.keys(st.counts || {}).sort();
    const lab = ((await ctx.prompt(`${files.length} pictures — what are they?` + (known.length ? `\n(${tr('it knows')}: ${known.join(', ')})` : ''), { value: label, placeholder: 'e.g. my dawg' })) || '').trim().toLowerCase().slice(0, 16);
    if (!lab) return;
    if (!b.canLearn(lab)) return ctx.toast('It already knows 16 things (max). Pick one of those!', 'error');
    setFeeding(true); setLabel(lab);
    const j = { label: lab, total: files.length, processed: 0, imported: 0, dupes: 0, failed: 0, failures: [], paused: false, cancelled: false, done: false, t0: Date.now() };
    ctx.brainJob = j;
    const emit = () => ctx.bus.emit('brainjob');
    emit();
    for (const f of files) {
      while (j.paused && !j.cancelled) await new Promise((r) => setTimeout(r, 200));
      if (j.cancelled) break;
      const t = Date.now();
      try {
        const bmp = await fileToBitmap(f, 256);
        const x = photoInput(bmp, bmp.width, bmp.height);
        setSeen(x);
        if (await b.isDupe(lab, x)) j.dupes++;
        else { await b.feed(lab, x, true); j.imported++; }
      } catch (e) { j.failed++; j.failures.push([f.name, String(e.message || e).slice(0, 40)]); }
      j.processed++;
      emit();
      const wait = (S.get('brain_import_pace') || 300) - (Date.now() - t);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    j.done = true;
    j.elapsed = (Date.now() - j.t0) / 1000;
    emit();
    ctx.toast(`🧠 ${j.cancelled && j.processed < j.total ? 'Cancelled' : 'Done'}: taught ${j.imported} pictures as "${lab}"` +
      (j.dupes ? ` · ${j.dupes} duplicates skipped` : '') + (j.failed ? ` · ${j.failed} failed` : ''), j.imported ? 'ok' : 'info', 6000);
  };
  const teach = async () => {
    const x = vector();
    const lab = label.trim().toLowerCase();
    if (!x) return ctx.toast('Draw or upload something first ✏️');
    if (!lab) return ctx.toast('Give it a name');
    if (!b.canLearn(lab)) return ctx.toast('It already knows 16 things (max). Pick one of those!', 'error');
    await ctx.try(b.feed(lab, x));
    pad.current.clear();
  };

  const real = st.userLabels || [];
  let guess = '';
  if (seen && res) {
    if (!real.length) guess = tr("It doesn't know anything yet. Feed it! 🍎");
    else if (res.preds.length) {
      const [lab, pr] = res.preds[0];
      const { fam, closest } = res;
      if (lab === NOTHING) guess = tr("🤷 That doesn't look like anything to it — just a doodle, a blank or a colour.");
      else if (fam !== null && fam < 0.35) guess = tr(`🤔 It's never seen anything like this. The closest thing it knows is '${closest}', but it doesn't look much like it.`);
      else {
        guess = tr(`It ${pr > 0.8 ? 'is pretty sure' : pr > 0.5 ? 'thinks' : 'is guessing'} that's: ${lab}`);
        if (fam !== null && fam < 0.6) guess += ' ' + tr('(but this looks a bit unfamiliar)');
      }
      guess += '\n' + (fam !== null ? `🧠 ${tr('Familiarity')}: ${Math.round(fam * 100)}%` : tr('🌱 Still young: it starts noticing unfamiliar things after a bit more training.'));
      if (real.length === 1) guess += '\n' + tr(`💡 It only knows '${real[0]}' (and 'nothing'). Teach it other things too (other animals, people, rooms...) so it learns what ISN'T ${real[0]}.`);
    }
  }
  const me = (st.contrib || {})[st.myPub || ''] || {};
  const counts = st.counts || {};
  const ca = st.classAcc || {};
  const accTxt = st.acc !== null && st.acc !== undefined ? Math.round(st.acc * 100) + '%' : '—';

  return html`<div class="pad">
    <div class="muted small">${tr("One neural network trained by everyone's devices at the same time. Teach it real pictures or coloured doodles, watch it get smarter, test it.")}</div>
    <div style=${{ margin: '10px 0' }}><${Chips} items=${[['🎯', accTxt, 'accuracy'], ['🍎', num(st.nEx), 'examples fed'], ['🏷', real.length, 'things known'],
      ['⚙', num(st.totalSteps), 'training steps'], ['🖥', (st.online || 0) + (S.get('brain_train') ? 1 : 0), 'devices training now'],
      ['🙋', `${me.ex || 0} fed · ${num(me.steps)} steps`, 'by you']]} /></div>
    ${!b || !b.loaded ? html`<div class="muted small">⏳ ${tr('Loading the brain...')}</div>` : null}
    <div class="row" style=${{ margin: '8px 0' }}>
      <button class=${'chip' + (!feeding ? ' on' : '')} onClick=${() => setFeeding(false)}>${I('🎯')} ${tr('Test it')}</button>
      <button class=${'chip' + (feeding ? ' on' : '')} onClick=${() => setFeeding(true)}>${I('🍎')} ${tr('Feed it')}</button>
      <span class="grow"></span><button class="btn small flat" onClick=${() => pad.current.clear()}>${I('🗑')} ${tr('Clear')}</button>
    </div>
    <div class="row" style=${{ gap: '5px', marginBottom: '8px', flexWrap: 'wrap' }}>
      ${PEN_COLORS.map((c) => html`<button onClick=${() => { setPen(c); setEraser(false); }} style=${{ width: '28px', height: '28px', borderRadius: '14px', background: c,
        border: `${!eraser && pen === c ? 3 : 2}px solid ${!eraser && pen === c ? 'var(--text)' : 'var(--border)'}` }}></button>`)}
      <button class=${'chip' + (eraser ? ' on' : '')} onClick=${() => setEraser(true)}>${I('🧽')}</button>
    </div>
    <${Pad} padRef=${pad} pen=${pen} eraser=${eraser} onChange=${onDraw} />
    <div class="row" style=${{ margin: '8px 0', flexWrap: 'wrap' }}>
      <button class="btn small" onClick=${() => pick(null)}>${I('🖼')} ${tr('Picture(s)')}</button>
      <button class="btn small" onClick=${() => pick('environment')}>${I('📷')} ${tr('Camera')}</button>
    </div>
    ${job ? html`<${BrainJobCard} j=${job} />` : null}
    ${feeding ? html`<div class="row" style=${{ marginBottom: '8px' }}>
      <input class="field grow" list="brainlabels" placeholder=${tr('what is it? (cat, door, seek...)')} value=${label} onInput=${(e) => setLabel(e.target.value)} />
      <datalist id="brainlabels">${Object.keys(counts).sort().map((l) => html`<option value=${l} />`)}</datalist>
      <button class="btn primary" onClick=${teach}>${tr('Teach it ✨')}</button></div>` : null}
    <div class="row" style=${{ alignItems: 'flex-start', gap: '10px', margin: '6px 0' }}>
      <div style=${{ textAlign: 'center' }}>${seen ? html`<${PixelCanvas} x=${seen} size=${72} />` : html`<div style=${{ width: '72px', height: '72px', background: 'var(--panel3)', borderRadius: '8px' }}></div>`}
        <div class="small muted">${tr('what it sees')}</div></div>
      <div class="grow" style=${{ whiteSpace: 'pre-wrap', fontWeight: 700 }}>${guess}</div>
    </div>
    <${Bars} preds=${seen && res ? res.preds.map(([l, p]) => [l === NOTHING ? '🤷 nothing' : l, p]) : []} placeholder="draw or upload something ✏️ — its guesses show up here" />
    <div style=${{ marginTop: '10px' }}><${Check} k="brain_train" label="⚡ Help train it (uses a little battery)" onChange=${(v) => { if (v) { ctx.brain && ctx.brain.ensureLoaded(); ctx.lang && ctx.lang.ensureLoaded(); } }} />
      <${Check} k="brain_train_charging_only" label="🔌 Only train while charging" /></div>
    <${Card} title="📈 Community accuracy"><${LineChart} pts=${(st.history || []).map((h) => [h[0], h[1]])} fmt=${(v) => Math.round(v * 100) + '%'} empty="accuracy over time shows up here once the brain has been training a bit" /><//>
    <${Card} title="🖼 Recently fed">${st.recent && st.recent.length ? html`<div class="thumbs">${st.recent.map((r) => html`<div><${PixelCanvas} x=${r.x} size=${32} /><div class="ellipsis">${r.label}</div></div>`)}</div>`
      : html`<div class="muted">${tr('nothing fed yet — upload a picture or draw one!')}</div>`}<//>
    <${Card} title="🔬 What its first layer reacts to"><${Filters} W=${st.filters} /><div class="small muted" style=${{ marginTop: '6px' }}>${tr('16 tiny colour/edge detectors it learned by itself')}</div><//>
    <${Card} title="🏷 Things it knows"><div>${Object.entries(counts).sort((a, c) => c[1] - a[1]).map(([k, v]) => `${k} (${v} ${tr('pics')}${ca[k] !== undefined ? ` · ${tr('gets')} ${Math.round(ca[k] * 100)}% ${tr('right')}` : ''})`).join('  ·  ')
      || tr('nothing yet — switch to 🍎 Feed it, upload or draw something and name it!')}</div><//>
    <${Card} title="🏆 Top trainers"><${Board} contrib=${st.contrib} score=${(c) => c.ex * 50 + c.steps} line=${(c) => `${c.ex} ${tr('fed')} · ${num(c.steps)} ${tr('steps')}`} /><//>
  </div>`;
}
function BrainJobCard({ j }) {
  useBus(['brainjob']);
  const pct = (100 * j.processed) / Math.max(1, j.total);
  const el = (Date.now() - j.t0) / 1000;
  const eta = j.processed ? (el / j.processed) * (j.total - j.processed) : 0;
  return html`<div class="card" style=${{ margin: '6px 0 10px' }}>
    <div>${j.done ? (j.cancelled && j.processed < j.total ? '✋ ' + tr('Import cancelled') : '✅ ' + tr('Import finished')) : '📥 ' + tr('Teaching')} <b>${num(j.total)}</b> ${tr('pictures as')} <b>${j.label}</b></div>
    <div class="progress" style=${{ margin: '8px 0' }}><i style=${{ width: pct + '%' }}></i></div>
    <div class="small muted">${j.paused ? '⏸ ' + tr('paused') + ' · ' : ''}${num(j.processed)} / ${num(j.total)} · ✅ ${num(j.imported)} · ♻ ${num(j.dupes)} · ⚠ ${num(j.failed)}${!j.done && eta ? ` · ~${fmtSecs(eta)} ${tr('left')}` : ''}${j.done ? ` · ${tr('took')} ${fmtSecs(j.elapsed || el)}` : ''}</div>
    ${j.done && j.failures.length ? html`<div class="small muted">${tr("Couldn't use")}: ${j.failures.slice(0, 4).map(([n, e]) => `${n} (${e})`).join('; ')}</div>` : null}
    <div class="row" style=${{ marginTop: '6px' }}>
      ${!j.done ? html`<button class="btn small flat" onClick=${() => { j.paused = !j.paused; ctx.bus.emit('brainjob'); }}>${j.paused ? '▶ ' + tr('Resume') : '⏸ ' + tr('Pause')}</button>
        <button class="btn small flat" onClick=${() => { j.cancelled = true; j.paused = false; }}>${I('✖')} ${tr('Cancel')}</button>`
        : html`<span class="grow"></span><button class="btn small flat" onClick=${() => { ctx.brainJob = null; ctx.bus.emit('brainjob'); }}>OK</button>`}
    </div></div>`;
}

// ===================================================================== language
function LangPage() {
  useBus(['lang', 'langjob']);
  const lg = ctx.lang;
  const st = lg ? lg.st : {};
  const [paste, setPaste] = useState('');
  const [typing, setTyping] = useState('');
  const [next, setNext] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [temp, setTemp] = useState(70);
  const [len, setLen] = useState(300);
  const [out, setOut] = useState(null);
  const [live, setLive] = useState(true);
  const job = lg && (lg.job || lg.lastJob);

  const write = async () => {
    if (!lg || !lg.loaded) return;
    const p = prompt;
    const txt = await lg.write(p, len, temp / 100);
    setOut([p, txt]);
  };
  useEffect(() => {
    const t = setInterval(() => { if (live && !document.hidden) write(); }, 20000);
    return () => clearInterval(t);
  }, [live, prompt, temp, len]);
  useEffect(() => { if (lg && lg.loaded && !out) write(); }, [st.loaded]);
  useEffect(() => {
    let dead = false;
    if (typing && lg && lg.loaded) lg.nextLetters(typing).then((r) => !dead && setNext(r));
    else setNext([]);
    return () => { dead = true; };
  }, [typing, st.totalSteps]);

  const feedDocs = async () => {
    const files = await pickFiles({ accept: '.pdf,.docx,.txt,.md,.markdown,.csv,.log,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    if (!files.length) return;
    if (lg.job) return ctx.toast('Already reading something — wait for it or stop it first');
    const total = files.reduce((s, f) => s + f.size, 0);
    if (!await ctx.confirm(`${files.length} ${tr('document(s)')} · ${(total / 1e6).toFixed(1)} MB\n\n⚠️ ${tr('Everything you feed it is public. Anyone using Smult (and anyone looking at the relays) can read it. Don\'t feed private stuff.')}`, { ok: tr('Feed it 📚') })) return;
    lg.lastJob = lg.startImport(files, 500);
    ctx.bus.emit('langjob');
  };
  const teachPaste = async () => {
    if (paste.trim().length < 20) return ctx.toast('Paste a bit more text first (at least a sentence)');
    if (!await ctx.confirm('This text becomes public for everyone using Smult. Teach it?')) return;
    const t = paste;
    setPaste('');
    ctx.toast(`📚 Teaching ${num(t.length)} characters...`, 'ok');
    await ctx.try(lg.teachText(t));
  };

  const [si, stxt] = stage(st.bpc);
  const me = (st.contrib || {})[st.myPub || ''] || {};
  return html`<div class="pad">
    <div class="muted small">${tr("Feed it PDFs, Word docs and text files. It reads letter by letter and slowly figures out how language works: first common letters, then spaces and syllables, then real words. Everyone's Smult trains it together.")}</div>
    <div style=${{ margin: '10px 0' }}><${Chips} items=${[['📉', st.bpc !== null && st.bpc !== undefined ? st.bpc.toFixed(2) : '—', 'bits per letter'], ['🔤', num(st.chars), 'characters read'],
      ['📄', st.docs || 0, 'documents'], ['⚙', num(st.totalSteps), 'training steps'], ['🖥', (st.online || 0) + (S.get('brain_train') ? 1 : 0), 'devices training now'],
      ['🙋', `${num(me.chars)} chars · ${num(me.steps)} steps`, 'by you']]} /></div>
    <div style=${{ fontWeight: 700, fontSize: '1.08em' }}>${st.bpc !== null && st.bpc !== undefined ? `${tr("Right now it's")} ${tr(stxt.slice(2))} ${stxt.slice(0, 2)}` : tr(stxt)}</div>
    <div class="row" style=${{ gap: '4px', margin: '8px 0', flexWrap: 'wrap' }}>${STAGES.map((s, i) => html`<span class=${'chip' + (i <= si && st.bpc !== null && st.bpc !== undefined ? ' on' : '')} style=${{ fontSize: '0.8em' }}>${tr(s)}</span>`)}</div>
    ${!lg || !lg.loaded ? html`<div class="muted small">⏳ ${tr('Loading the brain...')}</div>` : null}
    <${Card} title="🍎 Feed it">
      <div class="row"><button class="btn primary" onClick=${feedDocs}>${I('📄')} ${tr('Feed documents')}</button><span class="small muted">PDF · DOCX · TXT · MD</span></div>
      ${job ? html`<${LangJobCard} j=${job} />` : null}
      <textarea class="field" rows="4" style=${{ marginTop: '8px' }} placeholder=${tr('...or paste some text here (a story, lyrics you wrote, a wiki article)')} value=${paste} onInput=${(e) => setPaste(e.target.value)}></textarea>
      <div class="row" style=${{ marginTop: '6px' }}><span class="grow"></span><button class="btn" onClick=${teachPaste}>${tr('Teach this text ✨')}</button></div>
    <//>
    <${Card} title="🔮 Next letter guess">
      <input class="field" placeholder=${tr('type something... it guesses the next letter')} value=${typing} onInput=${(e) => setTyping(e.target.value)} />
      <div style=${{ marginTop: '8px' }}><${Bars} preds=${next} placeholder="type above ⌨️ and it shows which letter it thinks comes next" /></div>
    <//>
    <${Card} title="✍️ Let it write">
      <input class="field" placeholder=${tr('start it off (optional): "Once upon a time"')} value=${prompt} onInput=${(e) => setPrompt(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && write()} />
      <div class="row" style=${{ marginTop: '8px' }}><span class="small muted">${tr('creativity')} ${(temp / 100).toFixed(2)}</span>
        <input type="range" class="grow" min="20" max="150" value=${temp} onInput=${(e) => setTemp(+e.target.value)} /></div>
      <div class="row" style=${{ marginTop: '4px' }}><span class="small muted">${tr('letters')}</span>
        <select class="field" style=${{ width: 'auto' }} value=${len} onChange=${(e) => setLen(+e.target.value)}>${[100, 200, 300, 500, 1000, 2000].map((n) => html`<option value=${n}>${n}</option>`)}</select>
        <span class="grow"></span><button class="btn primary" onClick=${write}>${tr('Write!')}</button></div>
      <div class="card" style=${{ marginTop: '8px', minHeight: '90px', whiteSpace: 'pre-wrap', fontSize: '1.05em', background: 'var(--panel)' }}>
        ${out ? html`<b>${out[0]}</b><span style=${{ color: 'var(--accent)' }}>${out[1]}</span>` : html`<span class="muted">${tr('its writing shows up here')}</span>`}</div>
      <label class="check" onClick=${(e) => { e.preventDefault(); setLive(!live); }}><div class="grow">${tr('🔁 Live: write a new sample every 20 s (watch it learn)')}</div><span class=${'switch' + (live ? ' on' : '')}></span></label>
    <//>
    <${Card} title="📉 Learning curve (bits per letter — lower is smarter)"><${LineChart} pts=${(st.history || []).map((h) => [h[0], h[1]])} max=${7} invert=${true} fmt=${(v) => String(v)} empty="its learning curve shows up here once it starts reading" /><//>
    <${Card} title="📖 Library">${(st.library || []).length ? (st.library || []).map((d) => html`<div style=${{ padding: '3px 0' }}>${I('📄')} <b>${d.doc.slice(0, 50)}</b> <span class="muted small">— ${d.name || tr('someone')} · ${num(d.chars)} chars</span></div>`)
      : html`<div class="muted">${tr('empty — feed it a PDF, a Word doc or some text!')}</div>`}<//>
    <${Card} title="🏆 Top trainers"><${Board} contrib=${st.contrib} score=${(c) => c.chars / 100 + c.steps} line=${(c) => `${num(c.chars)} ${tr('chars fed')} · ${num(c.steps)} ${tr('steps')}`} /><//>
  </div>`;
}
function LangJobCard({ j }) {
  useBus(['langjob']);
  const el = (Date.now() - j.t0) / 1000;
  return html`<div class="card" style=${{ margin: '8px 0', background: 'var(--panel)' }}>
    <div>${j.done ? (j.cancelled ? '✋ ' + tr('Stopped') : '✅ ' + tr('Finished')) : '📚 ' + tr('Reading')} <b>${j.file}</b>${j.pages ? ` · ${tr('page')} ${j.page}/${j.pages}` : ''}</div>
    <div class="progress" style=${{ margin: '8px 0' }}><i style=${{ width: (100 * j.filesDone) / Math.max(1, j.files.length) + '%' }}></i></div>
    <div class="small muted">${j.filesDone}/${j.files.length} ${tr('files')} · ✅ ${num(j.sentChars)} ${tr('chars taught')} · ♻ ${j.dupes} · ⚠ ${j.failed.length} · ${fmtSecs(el)}</div>
    ${j.done && j.failed.length ? html`<div class="small muted">${j.failed.slice(0, 4).map(([n, e]) => `${n} (${e})`).join('; ')}</div>` : null}
    <div class="row" style=${{ marginTop: '6px' }}>${!j.done ? html`
      <button class="btn small flat" onClick=${() => { j.paused = !j.paused; ctx.bus.emit('langjob'); }}>${j.paused ? '▶ ' + tr('Resume') : '⏸ ' + tr('Pause')}</button>
      <button class="btn small flat" onClick=${() => { j.cancelled = true; j.paused = false; }}>${I('✖')} ${tr('Cancel')}</button>`
      : html`<span class="grow"></span><button class="btn small flat" onClick=${() => { ctx.lang.lastJob = null; ctx.bus.emit('langjob'); }}>OK</button>`}</div></div>`;
}

// ===================================================================== hub
export function BrainHub() {
  useBus(['brain', 'lang']);
  const [tab, setTab] = useState(ctx.brainTab || 0);
  useEffect(() => {
    const m = tab === 0 ? ctx.brain : ctx.lang;
    if (m) m.ensureLoaded();
    ctx.brainTab = tab;
  }, [tab, !!ctx.brain, !!ctx.lang]);
  return html`<div class="topbar"><h1>${I('🧠')} ${tr('The Smult Brain')}</h1></div>
    <div class="chips" style=${{ paddingTop: 0 }}>
      <button class=${'chip' + (tab === 0 ? ' on' : '')} onClick=${() => setTab(0)}>${I('🖼')} ${tr('Pictures')}</button>
      <button class=${'chip' + (tab === 1 ? ' on' : '')} onClick=${() => setTab(1)}>${I('📚')} ${tr('Language')}</button>
    </div>
    <div class="content">${tab === 0 ? html`<${VisionPage} />` : html`<${LangPage} />`}</div>`;
}
void SIDE;
