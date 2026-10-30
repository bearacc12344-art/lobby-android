// The Coding Cult on the phone: run add-ons (panels + pages), make them (code editor or DOORS blocks), and the Workshop.
import { html, useBus, useEffect, useRef, useState } from './h.js';
import { I } from '../util/icons.js';
import { ctx } from '../ctx.js';
import { S } from '../util/settings.js';
import { tr } from '../util/i18n.js';
import { TopBar } from './common.js';
import { longPress } from './press.js';
import { pickFiles, saveFile } from '../util/files.js';
import { idb } from '../net/idb.js';

let R = null;                                      // the runtime module (loaded when the Cult is first opened)
const rt = async () => (R = R || (await import('../addons/runtime.js')));

function useAddons() {
  const [, set] = useState(0);
  useEffect(() => { let off = null; rt().then((m) => { off = m.addons.on(() => set((x) => x + 1)); set((x) => x + 1); }); return () => off && off(); }, []);
  return R;
}

// ---------------------------------------------------------------- install screen (permissions + safety scan)
export function installSheet(files, note = '') {
  return new Promise((res) => {
    ctx.sheet({ kind: 'custom-install', res: () => res(null), render: (s) => html`<${InstallSheet} s=${s} files=${files} note=${note} done=${res} />` });
  });
}
function InstallSheet({ s, files, note, done }) {
  const m = R.readManifest(files), rep = R.scan(files);
  const col = rep.verdict === 'blocked' ? 'var(--danger)' : rep.verdict === 'caution' ? 'var(--accent)' : 'var(--ok)';
  const vt = { safe: '✅ No problems found', caution: '⚠️ Looks OK, but read the notes', blocked: "⛔ Blocked: it does things Smult doesn't allow" }[rep.verdict];
  async function install() {
    const man = await R.installFiles(files, true);
    ctx.closeSheet(s);
    await R.addons.setEnabled(man.id, true);
    ctx.toast(`🧩 ${man.name} is installed and on`, 'ok');
    done(man);
  }
  return html`<div class="pad">
    <div class="row" style=${{ gap: '12px' }}><span style=${{ fontSize: '2.2em' }} data-raw=${1}>${m.icon}</span>
      <div class="grow"><b style=${{ fontSize: '1.25em' }} data-raw=${1}>${m.name}</b><div class="small muted" data-raw=${1}>by ${m.author} · v${m.version}</div></div></div>
    <p class="small muted" data-raw=${1}>${m.description || tr('No description.')}</p>
    <div class="card"><div class="section" style=${{ margin: 0 }}>${tr('IT WANTS TO')}</div>
      ${m.permissions.length ? m.permissions.map((p) => html`<div class="small">${I(R.PERMISSIONS[p][0])} ${tr(R.PERMISSIONS[p][1])}</div>`) : html`<div class="small muted">${tr('Nothing special - it only keeps its own notes.')}</div>`}</div>
    <div class="card" style=${{ marginTop: '8px' }}><div class="section" style=${{ margin: 0 }}>${tr('SAFETY SCAN')}</div>
      <b style=${{ color: col }}>${tr(vt)}</b>
      ${rep.findings.slice(0, 6).map(([l, t]) => html`<div class="small muted" data-raw=${1}>${l === 'danger' ? '⛔' : '⚠️'} ${t}</div>`)}
      <div class="tiny muted">${rep.files} files · ${(rep.size >> 10) + 1} KB · ${tr("runs locked in Smult's sandbox")}</div></div>
    ${note ? html`<div class="tiny muted" style=${{ marginTop: '6px' }} data-raw=${1}>${note}</div>` : null}
    <div class="row" style=${{ gap: '8px', marginTop: '12px' }}><span class="small muted grow">${tr('Only install add-ons from people you trust.')}</span>
      <button class="btn" onClick=${() => { ctx.closeSheet(s); done(null); }}>${tr('Cancel')}</button>
      <button class="btn primary" disabled=${rep.verdict === 'blocked'} onClick=${install}>${tr('Install')}</button></div></div>`;
}

export async function installFromFile() {
  await rt();
  const [f] = await pickFiles({ accept: '.smultaddon,.zip,application/zip', multiple: false });
  if (!f) return;
  try { await installSheet(await R.unzipAddon(new Uint8Array(await f.arrayBuffer())), `From the file ${f.name}`); } catch (e) { ctx.toast(e.message || String(e), 'error'); }
}

// ---------------------------------------------------------------- add-on panels / pages
function Widget({ h, w }) {
  if (!w || w.visible === false) return null;
  const txt = String(w.text ?? w.a ?? '');
  if (w.kind === 'label') return html`<div data-raw=${1} style=${{ margin: '4px 0' }}>${txt}</div>`;
  if (w.kind === 'button') return html`<button class="btn" style=${{ margin: '4px 0' }} onClick=${() => w.fn && h.call(w.fn)} data-raw=${1}>${txt || 'Button'}</button>`;
  if (w.kind === 'toggle') return html`<label class="row" style=${{ margin: '6px 0', gap: '8px' }}><span class="grow" data-raw=${1}>${txt}</span>
    <input type="checkbox" checked=${!!w.value} onChange=${(e) => { w.value = e.target.checked; if (w.fn) h.call(w.fn, w.value); }} /></label>`;
  if (w.kind === 'input') return html`<input class="field" style=${{ margin: '4px 0' }} placeholder=${String(w.a || '')}
    onKeyDown=${(e) => { if (e.key === 'Enter' && w.fn) { h.call(w.fn, e.target.value); e.target.value = ''; } }} />`;
  if (w.kind === 'progress') return html`<div class="abar" style=${{ margin: '6px 0' }}><i style=${{ width: Math.max(0, Math.min(100, Number(w.value ?? w.a ?? 0))) + '%' }}></i></div>`;
  if (w.kind === 'canvas') return html`<${AddonCanvas} h=${h} w=${w} />`;
  return null;
}

function AddonCanvas({ h, w }) {
  const ref = useRef(null);
  useEffect(() => {
    const draw = () => {
      const c = ref.current;
      if (!c) return;
      const g = c.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
      const k = c.width / w.w;
      g.scale(k, k);
      for (const op of w.shown || []) {
        try {
          const [n, ...a] = op;
          if (n === 'clear') { g.fillStyle = String(a[0]); g.fillRect(0, 0, w.w, w.h); }
          else if (n === 'rect') { if (a[5]) { g.fillStyle = String(a[4]); g.fillRect(a[0], a[1], a[2], a[3]); } else { g.strokeStyle = String(a[4]); g.lineWidth = 1; g.strokeRect(a[0], a[1], a[2], a[3]); } }
          else if (n === 'line') { g.strokeStyle = String(a[4]); g.lineWidth = Number(a[5]) || 1; g.lineCap = 'round'; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(a[2], a[3]); g.stroke(); }
          else if (n === 'circle') { g.beginPath(); g.arc(a[0], a[1], Math.max(0, a[2]), 0, Math.PI * 2); if (a[4]) { g.fillStyle = String(a[3]); g.fill(); } else { g.strokeStyle = String(a[3]); g.stroke(); } }
          else if (n === 'text') { g.fillStyle = String(a[3]); g.font = `${Math.max(4, Math.min(96, Number(a[4]) || 12))}px sans-serif`; g.textBaseline = 'top'; g.fillText(String(a[2]).slice(0, 200), a[0], a[1]); }
        } catch (e) {}
      }
    };
    draw();
    return R.addons.on((t, d) => { if (t === 'canvas' && d.wid === w.id) draw(); });
  }, [w.id]);
  const pos = (e) => { const r = ref.current.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * w.w / r.width), Math.round((e.clientY - r.top) * w.h / r.height)]; };
  const fire = (n, ...a) => R.addons.canvasEvent(h.id, w.id, n, ...a);
  return html`<canvas ref=${ref} width=${w.w * 2} height=${w.h * 2} style=${{ width: '100%', aspectRatio: `${w.w} / ${w.h}`, borderRadius: '10px', touchAction: 'none', display: 'block', margin: '6px 0' }}
    onPointerDown=${(e) => { e.currentTarget.setPointerCapture(e.pointerId); fire('MouseDown', ...pos(e), 1); }}
    onPointerMove=${(e) => { if (e.buttons || e.pointerType === 'mouse') fire('MouseMove', ...pos(e)); }}
    onPointerUp=${(e) => fire('MouseUp', ...pos(e), 1)} />`;
}

function PanelCard({ h, pid }) {
  const p = h.panels[pid];
  if (!p) return null;
  return html`<div class="card" style=${{ marginBottom: '10px' }}>
    <div class="section" style=${{ margin: '0 0 6px' }} data-raw=${1}>${(p.icon || h.man.icon) + ' ' + p.title}</div>
    ${p.widgets.map((wid) => html`<${Widget} key=${wid} h=${h} w=${h.widgets[wid]} />`)}</div>`;
}

function AddonPageScreen({ aid, pid }) {
  const A = useAddons();
  const h = A && A.addons.hosts[aid];
  const p = h && h.panels[pid];
  return html`<${TopBar} title=${p ? (p.icon || h.man.icon) + ' ' + p.title : tr('Add-on page')} />
    <div class="content pad">${p ? html`<div class="small muted" data-raw=${1}>from ${h.man.name} by ${h.man.author}</div>
      ${p.widgets.map((wid) => html`<${Widget} key=${wid} h=${h} w=${h.widgets[wid]} />`)}` : html`<div class="muted">${tr('This add-on stopped.')}</div>`}</div>`;
}

// ---------------------------------------------------------------- the tab
export function CultTab() {
  const [seg, setSeg] = useState(S.get('cult_seg') || 'addons');
  const set = (x) => { setSeg(x); S.set('cult_seg', x); };
  return html`<div class="topbar"><h1>${tr('Coding Cult')}</h1></div>
    <div class="chips" style=${{ padding: '4px 12px' }}>${[['addons', '🧩', 'Add-ons'], ['projects', '💻', 'Projects'], ['workshop', '🌍', 'Workshop']].map(([k, ic, l]) =>
      html`<button class=${'chip' + (seg === k ? ' on' : '')} onClick=${() => set(k)}>${I(ic)} ${tr(l)}</button>`)}</div>
    <div class="content">${seg === 'addons' ? html`<${AddonsPane} />` : seg === 'projects' ? html`<${ProjectsPane} />` : html`<${WorkshopPane} />`}</div>`;
}

function AddonsPane() {
  const A = useAddons();
  const [list, setList] = useState(null);
  const reload = () => rt().then((m) => m.installedList()).then(setList);
  useEffect(() => { reload(); }, []);
  useBus(['addons'], (ev, t) => t === 'changed');
  if (!A) return html`<div class="pad muted">${tr('loading…')}</div>`;
  const hosts = Object.values(A.addons.hosts);
  const panels = hosts.flatMap((h) => Object.entries(h.panels).filter(([, p]) => !p.page).map(([pid]) => [h, pid]));
  const pages = hosts.flatMap((h) => Object.entries(h.panels).filter(([, p]) => p.page).map(([pid, p]) => [h, pid, p]));
  const enabled = S.get('addons') || {};
  return html`<div class="pad">
    ${pages.length ? html`<div class="section">${tr('ADD-ON PAGES')}</div><div class="list" style=${{ marginBottom: '10px' }}>${pages.map(([h, pid, p]) => html`
      <div class="item" onClick=${() => ctx.push({ kind: 'custom', render: () => html`<${AddonPageScreen} aid=${h.id} pid=${pid} />` })}>
        <span style=${{ fontSize: '1.4em' }} data-raw=${1}>${p.icon || h.man.icon}</span><span class="grow" data-raw=${1}>${p.title}</span><span class="muted">›</span></div>`)}</div>` : null}
    ${panels.map(([h, pid]) => html`<${PanelCard} key=${pid} h=${h} pid=${pid} />`)}
    <div class="section">${tr('INSTALLED')}</div>
    ${list && !list.length ? html`<div class="small muted">${tr('No add-ons yet. Get some in the Workshop tab, or make your own in Projects.')}</div>` : null}
    <div class="list">${(list || []).map(({ man }) => html`<div class="item" key=${man.id} ...${longPress(() => ctx.menu([
        { ic: '🗑️', label: 'Remove', danger: true, fn: async () => { if (await ctx.confirm(`Remove ${man.name}?`)) { R.addons.stop(man.id); await R.removeAddon(man.id); reload(); } } }], man.name))}>
      <span style=${{ fontSize: '1.4em' }} data-raw=${1}>${man.icon}</span>
      <div class="grow"><b data-raw=${1}>${man.name}</b><div class="tiny muted" data-raw=${1}>v${man.version} · ${man.permissions.map((p) => R.PERMISSIONS[p][0]).join(' ')} ${A.addons.hosts[man.id] ? '· ● running' : ''}</div></div>
      <input type="checkbox" checked=${!!(enabled[man.id] || {}).enabled} onClick=${(e) => e.stopPropagation()}
        onChange=${async (e) => { await A.addons.setEnabled(man.id, e.target.checked); reload(); }} /></div>`)}</div>
    <div class="row" style=${{ gap: '8px', marginTop: '12px' }}><button class="btn" onClick=${() => installFromFile().then(reload)}>${I('📥')} ${tr('Install a .smultaddon file')}</button></div>
    <p class="tiny muted">${tr('Every add-on runs locked in its own sandbox: no files, no internet, no apps — only the Smult features you allowed when installing. Long-press an add-on to remove it.')}</p>
  </div>`;
}

// ---------------------------------------------------------------- projects
async function projects() {
  const keys = (await idb.keys('kv')).filter((k) => String(k).startsWith('cultproj:'));
  const out = [];
  for (const k of keys) { const v = await idb.get('kv', k); if (v && v.files) out.push({ key: k, files: v.files, t: v.t || 0 }); }
  return out.sort((a, b) => b.t - a.t);
}
export const saveProject = (key, files) => idb.put('kv', key, { files, t: Date.now() });

async function newProject(tpl, name) {
  const files = { ...tpl.files };
  const m = JSON.parse(files['addon.json']);
  m.id = R.newGuid(); m.name = name; m.author = (ctx.store.me || {}).username || 'me';
  files['addon.json'] = JSON.stringify(m, null, 2);
  const key = 'cultproj:' + m.id;
  await saveProject(key, files);
  return key;
}

function ProjectsPane() {
  const [list, setList] = useState(null);
  const reload = () => rt().then(() => projects()).then(setList);
  useEffect(() => { reload(); }, []);
  useBus(['nav'], () => { reload(); return false; });
  async function create() {
    await rt();
    ctx.menu(R.templates().map((t) => ({ ic: t.man.icon, label: `${t.man.name} — ${t.man.description}`.slice(0, 70), fn: async () => {
      const name = await ctx.prompt(tr('Name your add-on'), { value: t.man.name });
      if (!name) return;
      const key = await newProject(t, name.slice(0, 40));
      reload();
      ctx.push({ kind: 'custom', render: () => html`<${ProjectScreen} pkey=${key} />` });
    } })), tr('New project from a template'));
  }
  return html`<div class="pad">
    <button class="btn primary block" onClick=${create}>${I('➕')} ${tr('New project')}</button>
    <div class="list" style=${{ marginTop: '10px' }}>${(list || []).map((p) => {
      let m = {};
      try { m = JSON.parse(p.files['addon.json']); } catch (e) {}
      return html`<div class="item" key=${p.key} ...${longPress(() => ctx.menu([{ ic: '🗑️', label: 'Delete project', danger: true, fn: async () => {
        if (await ctx.confirm(`Delete ${m.name}?`)) { await idb.del('kv', p.key); reload(); } } }], m.name), () => ctx.push({ kind: 'custom', render: () => html`<${ProjectScreen} pkey=${p.key} />` }))}>
        <span style=${{ fontSize: '1.4em' }} data-raw=${1}>${m.icon || '🧩'}</span>
        <div class="grow"><b data-raw=${1}>${m.name || '?'}</b><div class="tiny muted">${p.files['blocks.json'] ? '🧱 ' + tr('blocks') : '📜 Lua'} · v${m.version || '?'}</div></div><span class="muted">›</span></div>`;
    })}</div>
    ${list && !list.length ? html`<p class="small muted">${tr('Make your first add-on: tap New project. The "Blocks" template needs no typing at all.')}</p>` : null}</div>`;
}

const KEYS = ['local', 'function', 'end', 'if', 'then', 'else', 'for', 'do', 'return', '"', '(', ')', '{', '}', '=', '..', ':', 'Smult:GetService("', 'print(', 'Chat:Send(', ':Connect(function(', 'task.delay('];

function ProjectScreen({ pkey }) {
  const [files, setFiles] = useState(null);
  const [cur, setCur] = useState('Base_Plugin.lua');
  const [mode, setMode] = useState('code');
  const [err, setErr] = useState(null);
  const [logs, setLogs] = useState([]);
  const [, force] = useState(0);
  const ta = useRef(null);
  useEffect(() => {
    rt().then(async () => {
      const v = await idb.get('kv', pkey);
      setFiles(v.files);
      const m = JSON.parse(v.files['addon.json']);
      setCur(m.main || 'Base_Plugin.lua');
      if (v.files['blocks.json']) setMode('blocks');
    });
  }, []);
  useEffect(() => { if (R) return R.addons.on((t, d) => { if (t === 'log') setLogs((l) => [...l.slice(-150), d]); if (t === 'changed') force((x) => x + 1); }); }, [!!files]);
  if (!files) return html`<${TopBar} title=${tr('Project')} /><div class="pad muted">${tr('loading…')}</div>`;
  let man = {};
  try { man = R.readManifest(files); } catch (e) { man = { id: '?', name: '?', icon: '⚠️', main: 'Base_Plugin.lua', permissions: [], version: '?' }; }
  const running = !!R.addons.hosts[man.id];
  const save = async (f = files) => { await saveProject(pkey, f); };
  const edit = async (name, text) => {
    const f = { ...files, [name]: text };
    setFiles(f);
    clearTimeout(edit.t);
    edit.t = setTimeout(async () => { await save(f); if (name.endsWith('.lua')) setErr(await R.addons.check(text, name)); }, 400);
  };
  const insert = (s) => {
    const el = ta.current;
    if (!el) return;
    const a = el.selectionStart, b = el.selectionEnd, v = el.value;
    const nv = v.slice(0, a) + s + v.slice(b);
    el.value = nv;
    el.selectionStart = el.selectionEnd = a + s.length;
    el.focus();
    edit(cur, nv);
  };
  async function run() {
    await save();
    for (const [n, t] of Object.entries(files)) {
      if (!n.endsWith('.lua')) continue;
      const e = await R.addons.check(t, n);
      if (e) { setCur(n); setMode('code'); setErr(e); return ctx.toast(`${n}:${e[0]} ${e[1]}`, 'error'); }
    }
    const rep = R.scan(files);
    for (const [, t] of rep.findings) setLogs((l) => [...l, { aid: man.id, kind: 'warn', text: 'scan: ' + t }]);
    await R.addons.start(man, files, true);
  }
  const mine = logs.filter((l) => !l.aid || l.aid === man.id);
  return html`<${TopBar} title=${(man.icon || '') + ' ' + man.name}>
      <button class="iconbtn" onClick=${() => ctx.menu([
        { ic: '📦', label: 'Install it (runs every time)', fn: async () => { await save(); R.addons.stop(man.id); await installSheet(files, 'From your Coding Cult project'); } },
        { ic: '🌍', label: 'Publish to the Workshop', fn: () => publish(files) },
        { ic: '📤', label: 'Share as a .smultaddon file', fn: async () => saveFile(man.name + '.smultaddon', await R.zipAddon(files)) },
        { ic: '➕', label: 'New .lua file', fn: async () => { let n = await ctx.prompt('File name', { value: 'helpers.lua' }); if (!n) return; n = n.replace(/[^\w.-]/g, ''); if (!n.endsWith('.lua')) n += '.lua';
          const f = { ...files, [n]: `-- ${n}: load it with  local M = include("${n}")\nlocal M = {}\n\nreturn M\n` }; setFiles(f); setCur(n); save(f); } },
      ])}>⋯</button>
      <button class=${'btn small ' + (running ? '' : 'primary')} onClick=${run}>${I(running ? '🔄' : '▶️')} ${tr(running ? 'Restart' : 'Run')}</button>
      ${running ? html`<button class="iconbtn" onClick=${() => R.addons.stop(man.id)}>${I('⏹')}</button>` : null}
    </${TopBar}>
    <div class="chips" style=${{ padding: '4px 10px' }}>
      <button class=${'chip' + (mode === 'code' ? ' on' : '')} onClick=${() => setMode('code')}>${I('📜')} ${tr('Code')}</button>
      <button class=${'chip' + (mode === 'blocks' ? ' on' : '')} onClick=${async () => {
        if (!files['blocks.json']) {
          if (!(await ctx.confirm(tr('Make this project with blocks? Base_Plugin.lua will be written from the blocks from now on.')))) return;
          const { STARTER } = await import('../addons/blocksdef.js');
          const f = { ...files, 'blocks.json': JSON.stringify(STARTER), [man.main.replace('.lua', '.before-blocks.lua')]: files[man.main] || '' };
          setFiles(f); save(f);
        }
        setMode('blocks');
      }}>${I('🧱')} ${tr('Blocks')}</button>
      ${mode === 'code' ? Object.keys(files).filter((n) => /\.(lua|json|md|txt)$/.test(n)).map((n) => html`<button class=${'chip' + (cur === n ? ' on' : '')} onClick=${() => setCur(n)}>${n}</button>`) : null}
    </div>
    ${mode === 'blocks' ? html`<${BlocksLoader} files=${files} man=${man} onCode=${(lua, perms, data) => {
        const m2 = JSON.parse(files['addon.json']);
        m2.permissions = perms;
        const f = { ...files, 'blocks.json': data, [man.main]: lua, 'addon.json': JSON.stringify(m2, null, 2) };
        setFiles(f); save(f);
      }} />`
      : html`<div style=${{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '0 10px' }}>
        <div class="codewrap" style=${{ flex: 1 }}>
          <div class="gutter">${(files[cur] || '').split('\n').map((_, i) => html`<div class=${err && err[0] === i + 1 && cur.endsWith('.lua') ? 'bad' : ''}>${i + 1}</div>`)}</div>
          <textarea ref=${ta} class="code" spellcheck="false" autocapitalize="off" autocomplete="off" value=${files[cur] || ''} onInput=${(e) => edit(cur, e.target.value)}
            onScroll=${(e) => { const g = e.target.previousSibling; if (g) g.scrollTop = e.target.scrollTop; }}
            onKeyDown=${(e) => { if (e.key === 'Tab') { e.preventDefault(); insert('    '); } }}></textarea>
        </div>
        ${err && cur.endsWith('.lua') ? html`<div class="small" style=${{ color: 'var(--danger)', padding: '4px 2px' }} data-raw=${1}>⛔ ${tr('line')} ${err[0]}: ${err[1]}</div>` : null}
        <div class="keybar">${KEYS.map((k) => html`<button onClick=${() => insert(k === '"' ? '""' : k === '(' ? '()' : k === '{' ? '{}' : k)}>${k}</button>`)}</div>
      </div>`}
    <div class="console">${mine.slice(-40).map((l) => html`<div class=${'log ' + l.kind} data-raw=${1}>${l.text}</div>`)}${!mine.length ? html`<div class="log muted">${tr('console — press Run')}</div>` : null}</div>`;
}

function BlocksLoader(props) {
  const [Comp, setComp] = useState(null);
  useEffect(() => { import('./BlocksEditor.js').then((m) => setComp(() => m.BlocksEditor)); }, []);
  return Comp ? html`<${Comp} ...${props} />` : html`<div class="pad muted">${tr('loading blocks…')}</div>`;
}

async function publish(files) {
  await rt();
  const rep = R.scan(files);
  if (rep.verdict === 'blocked') return ctx.toast(tr('⛔ The safety scan blocks this add-on — fix it first'), 'error');
  const man = R.readManifest(files);
  const notes = await ctx.prompt(tr("What's new? (optional)"), { value: '' });
  if (notes === null) return;
  ctx.toast(tr('🌍 Publishing to the Workshop…'));
  try {
    await ctx.api('workshop_publish', { manifest: man, zip: await R.zipAddon(files), notes, tags: [] });
    ctx.toast(`🌍 ${man.name} ${man.version} ${tr('is on the Workshop!')}`, 'ok');
  } catch (e) {}
}

// ---------------------------------------------------------------- the Workshop
function WorkshopPane() {
  const A = useAddons();
  const [items, setItems] = useState(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(0);
  const [have, setHave] = useState({});
  const load = async () => {
    await rt();
    setHave(Object.fromEntries((await R.installedList()).map((a) => [a.man.id, a.man])));
    try { setItems(await ctx.net.req('workshop_list', {})); } catch (e) { setItems([]); }
  };
  useEffect(() => { load(); }, []);
  if (!A) return html`<div class="pad muted">${tr('loading…')}</div>`;
  const { newer } = { newer: (a, b) => { const x = String(a).match(/\d+/g) || [0], y = String(b).match(/\d+/g) || [0]; for (let i = 0; i < Math.max(x.length, y.length); i++) if ((+x[i] || 0) !== (+y[i] || 0)) return (+x[i] || 0) > (+y[i] || 0); return false; } };
  const ql = q.toLowerCase();
  const off = R.bundled().filter((b) => !ql || (b.man.name + b.man.description).toLowerCase().includes(ql));
  let list = (items || []).filter((x) => !ql || (x.name + ' ' + x.description + ' ' + x.by + ' ' + x.tags.join(' ')).toLowerCase().includes(ql));
  list = [...list].sort([(a, b) => (b.installs * 2 + b.likes * 3) - (a.installs * 2 + a.likes * 3), (a, b) => b.updated - a.updated, (a, b) => b.likes - a.likes][sort]);
  async function wsInstall(x) {
    ctx.toast(`⬇ ${tr('Getting')} ${x.name}…`);
    try {
      const r = await ctx.api('workshop_get', { author: x.author, id: x.id });
      const man = await installSheet(await R.unzipAddon(r.zip), `From the Workshop · by ${x.by}#${x.code} · ❤️ ${x.likes} · ⬇ ${x.installs}`);
      if (man) { ctx.net.req('workshop_act', { key: x.key, act: 'install' }).catch(() => {}); load(); }
    } catch (e) {}
  }
  const card = (icon, name, by, desc, stats, buttons) => html`<div class="card" style=${{ marginBottom: '10px' }}>
    <div class="row" style=${{ gap: '10px' }}><span style=${{ fontSize: '1.8em' }} data-raw=${1}>${icon}</span><div class="grow"><b data-raw=${1}>${name}</b><div class="tiny muted" data-raw=${1}>${by}</div></div></div>
    <div class="small muted" style=${{ margin: '6px 0' }} data-raw=${1}>${desc}</div><div class="row" style=${{ gap: '6px' }}><span class="tiny muted grow">${stats}</span>${buttons}</div></div>`;
  return html`<div class="pad">
    <div class="row" style=${{ gap: '6px' }}><input class="field" placeholder=${tr('🔍 Search the Workshop')} value=${q} onInput=${(e) => setQ(e.target.value)} />
      <button class="btn small" onClick=${() => setSort((sort + 1) % 3)}>${['🔥', '🆕', '❤️'][sort]}</button></div>
    <div class="section">${tr('MADE BY SMULT')}</div>
    ${off.map((b) => card(b.man.icon, b.man.name, 'by Smult ✔', b.man.description, b.man.permissions.map((p) => R.PERMISSIONS[p][0]).join(' '),
      have[b.man.id] ? html`<button class="btn small" disabled>${tr('✓ Installed')}</button>` : html`<button class="btn small primary" onClick=${() => installSheet(b.files, 'Made by Smult').then(load)}>${tr('Install')}</button>`))}
    <div class="section">${tr('COMMUNITY WORKSHOP')} ${items ? html`<span class="tiny muted">· ${items.length}</span>` : null}</div>
    ${items === null ? html`<div class="small muted">${tr('loading the Workshop…')}</div>` : !list.length ? html`<div class="small muted">${tr('Nothing here yet — make an add-on in Projects and publish it!')}</div>` : null}
    ${list.slice(0, 120).map((x) => {
      const inst = have[x.id];
      const btn = inst && !newer(x.version, inst.version) ? html`<button class="btn small" disabled>${tr('✓ Installed')}</button>`
        : html`<button class="btn small primary" onClick=${() => wsInstall(x)}>${tr(inst ? '⬆ Update' : 'Install')}</button>`;
      const like = html`<button class="btn small" onClick=${() => { x.liked = !x.liked; x.likes += x.liked ? 1 : -1; setItems([...items]); ctx.net.req('workshop_act', { key: x.key, act: x.liked ? 'like' : 'unlike' }).catch(() => {}); }}>${x.liked ? '❤️' : '🤍'} ${x.likes}</button>`;
      return card(x.icon, x.name, `by ${x.by}#${x.code}${x.mine ? ' (you)' : ''}`, x.description, `⬇ ${x.installs} · v${x.version}`, html`${like}${btn}`);
    })}</div>`;
}
