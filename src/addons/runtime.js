// Smult add-ons on the phone: the same Lua add-ons as PC Smult, running in the same locked sandbox (Lua 5.4 in
// WebAssembly via wasmoon). The sandbox prelude, block definitions and made-by-Smult add-ons come from PC Smult
// (tools/sync_from_pc.py), so an add-on behaves the same on both.
import { ctx } from '../ctx.js';
import { S } from '../util/settings.js';
import { idb } from '../net/idb.js';
import { PRELUDE, PERMISSIONS } from './prelude.js';
import BUNDLED from './bundled.json';
import { palette, THEMES } from '../ui/theme.js';

export { PERMISSIONS };
export const ALLOWED_FILES = ['.lua', '.json', '.txt', '.md'];
export const MAX_TOTAL = 2 * 1024 * 1024;
const CALL_BUDGET = 0.25, LOAD_BUDGET = 2.0;

let factoryP = null;
async function factory() {
  if (!factoryP) {
    factoryP = (async () => {
      const [{ LuaFactory }, wasm] = await Promise.all([import('wasmoon'), import('wasmoon/dist/glue.wasm?url')]);
      return new LuaFactory(wasm.default);
    })();
  }
  return factoryP;
}

export const newGuid = () => '{' + crypto.randomUUID().toUpperCase() + '}';

export function readManifest(files) {
  let m;
  try { m = JSON.parse(files['addon.json'] || ''); } catch (e) { throw new Error('addon.json is missing or broken'); }
  if (!m || !m.id || !m.name) throw new Error('addon.json needs at least an "id" and a "name"');
  return { version: '1.0', author: 'someone', description: '', icon: '🧩', main: 'Base_Plugin.lua', ...m,
    permissions: (m.permissions || []).filter((p) => p in PERMISSIONS) };
}

// ---------------------------------------------------------------- the scanner ("antivirus"), same rules as PC
const SUSPICIOUS = [
  [/\bdebug\s*\./, 'danger', "tries to use the 'debug' library (can break out of sandboxes)"],
  [/\bload\s*\(|\bloadstring\s*\(|\bdofile\s*\(|\bloadfile\s*\(/, 'danger', 'builds and runs code from text (a classic way to hide what it does)'],
  [/\bstring\.dump\b|\bsetfenv\b|\bgetfenv\b/, 'danger', 'uses old sandbox-escape tricks'],
  [/\bpython\b|\b__\w+__\b/, 'danger', "pokes at Smult's insides"],
  [/\bos\.(execute|remove|rename|exit|getenv|tmpname)\b|\bio\.\w+/, 'danger', 'tries to run programs or touch files'],
  [/\brequire\s*\(/, 'warn', 'tries to load outside libraries (not available in Smult)'],
  [/\bgetmetatable\s*\(\s*['"]/, 'warn', 'messes with string internals'],
  [/\brawset\s*\(\s*_G|\b_G\s*\[/, 'warn', 'rewrites globals in a sneaky way'],
];
export function scan(files) {
  const findings = [];
  let total = 0, n = 0;
  let man;
  try { man = readManifest(files); } catch (e) { return { verdict: 'blocked', findings: [['danger', e.message]], files: 0, size: 0 }; }
  const used = new Set();
  for (const [name, text] of Object.entries(files)) {
    n++;
    total += new Blob([text]).size;
    if (!ALLOWED_FILES.some((x) => name.toLowerCase().endsWith(x)) || name.includes('/') || name.includes('..')) { findings.push(['danger', `contains a file that isn't code or text: ${name}`]); continue; }
    if (!name.endsWith('.lua')) continue;
    const code = text.replace(/--\[(=*)\[[\s\S]*?\]\1\]|--[^\n]*/g, '');
    for (const [rx, level, msg] of SUSPICIOUS) if (rx.test(code)) findings.push([level, `${name}: ${msg}`]);
    if (/(\\x[0-9a-fA-F]{2}|\\\d{2,3}){40,}/.test(code) || /[A-Za-z0-9+/=]{1500,}/.test(code)) findings.push(['danger', `${name}: has a big scrambled blob (code hiding what it really is)`]);
    for (const [svc, perm] of [['CommandService', 'commands'], ['UIService', 'ui'], ['NotificationService', 'notify'], ['ThemeService', 'theme'],
      ['LayoutService', 'layout'], ['SoundService', 'sound'], ['UserService', 'users']]) if (code.includes(svc)) used.add(perm);
    if (/:Send\s*\(/.test(code)) used.add('chat.send');
  }
  if (total > MAX_TOTAL) findings.push(['danger', `is too big (${total >> 10} KB, the limit is ${MAX_TOTAL >> 10} KB)`]);
  if (!files[man.main]) findings.push(['danger', `its main file ${man.main} is missing`]);
  const missing = [...used].filter((p) => !man.permissions.includes(p)).sort();
  if (missing.length) findings.push(['warn', "uses services it didn't ask permission for (they'll be blocked): " + missing.join(', ')]);
  const verdict = findings.some((f) => f[0] === 'danger') ? 'blocked' : findings.length ? 'caution' : 'safe';
  return { verdict, findings, files: n, size: total };
}

// ---------------------------------------------------------------- storage (IndexedDB)
export async function installedList() {
  const keys = (await idb.keys('kv')).filter((k) => String(k).startsWith('addon:'));
  const out = [];
  for (const k of keys) { const v = await idb.get('kv', k); if (v && v.files) { try { out.push({ man: readManifest(v.files), files: v.files }); } catch (e) {} } }
  return out.sort((a, b) => a.man.name.localeCompare(b.man.name));
}
export async function getInstalled(id) { const v = await idb.get('kv', 'addon:' + id); return v && v.files ? { man: readManifest(v.files), files: v.files } : null; }
export async function installFiles(files, enable = true) {
  const man = readManifest(files);
  await idb.put('kv', 'addon:' + man.id, { files, t: Date.now() });
  const st = { ...(S.get('addons') || {}) };
  st[man.id] = { ...(st[man.id] || {}), enabled: enable };
  S.set('addons', st);
  S.set('addon_perms', { ...(S.get('addon_perms') || {}), [man.id]: [...man.permissions] });
  return man;
}
export async function removeAddon(id) {
  await idb.del('kv', 'addon:' + id).catch(() => {});
  await idb.del('kv', 'addondata:' + id).catch(() => {});
  const st = { ...(S.get('addons') || {}) }; delete st[id]; S.set('addons', st);
  const p = { ...(S.get('addon_perms') || {}) }; delete p[id]; S.set('addon_perms', p);
}
export const bundled = () => Object.values(BUNDLED.bundled);
export const templates = () => Object.values(BUNDLED.templates);

export async function unzipAddon(bytes) {
  const { unzipSync, strFromU8 } = await import('fflate');
  let z;
  try { z = unzipSync(bytes); } catch (e) { throw new Error("that isn't a Smult add-on file"); }
  const names = Object.keys(z).filter((n) => !n.endsWith('/'));
  let prefix = '';
  if (!names.includes('addon.json')) {
    const hit = names.find((n) => n.endsWith('/addon.json') && n.split('/').length === 2);
    if (!hit) throw new Error("there's no addon.json in that file");
    prefix = hit.slice(0, -'addon.json'.length);
  }
  const files = {};
  let total = 0;
  for (const n of names) {
    if (!n.startsWith(prefix)) continue;
    const rel = n.slice(prefix.length);
    if (!rel || rel.includes('/') || rel.includes('..')) continue;
    total += z[n].length;
    if (total > MAX_TOTAL * 2) throw new Error('the add-on file is too big');
    files[rel] = strFromU8(z[n]);
  }
  return files;
}
export async function zipAddon(files) {
  const { zipSync, strToU8 } = await import('fflate');
  return zipSync(Object.fromEntries(Object.entries(files).map(([n, t]) => [n, strToU8(t)])));
}

// ---------------------------------------------------------------- one running add-on
class PermErr extends Error {}
const nn = (v) => (v === null ? undefined : v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null)) : v);

class Host {
  constructor(mgr, man, files, dev) {
    Object.assign(this, { mgr, man, files, dev, id: man.id });
    this.perms = new Set(dev ? man.permissions : (S.get('addon_perms') || {})[man.id] || []);
    for (const p of [...this.perms]) if (!man.permissions.includes(p)) this.perms.delete(p);
    this.timers = []; this.commands = {}; this.panels = {}; this.widgets = {}; this.errors = 0; this.running = false; this.wantHB = false;
    this.data = null;
  }
  log(kind, text) {
    this.mgr.emitLog(this.id, kind, text);
    if (kind === 'error' && ++this.errors >= 25 && !this.dev) this.mgr.crashed(this);
  }
  need(p) { if (!this.perms.has(p)) throw new PermErr(`this add-on didn't get permission for '${p}' (${PERMISSIONS[p][1].toLowerCase()})`); }
  read(rel) {
    if (!/^[\w .-]+\.lua$/.test(rel) || !(rel in this.files)) throw new Error('add-ons can only include their own .lua files');
    return this.files[rel];
  }
  async start() {
    const f = await factory();
    const L = await f.createEngine({ injectObjects: false, enableProxy: false, openStandardLibs: true, traceAllocations: true });
    try { L.global.setMemoryMax(64 * 1024 * 1024); } catch (e) {}
    this.L = L;
    L.global.set('__b', this.bridge(null));
    // Lua's own helpers stay inside Lua (passing them through JavaScript breaks them)
    const prelude = PRELUDE.replace('local bridge, set_hook, clock = ...',
      "local bridge, set_hook, clock = __b, debug.sethook, os.clock; __b = nil\nlocal _load = load\nbridge.compile = function(src, name) return _load(src, '=' .. name, 't') end")
      .replace('    deadline = math.huge\n    return ok, e end,', "    deadline = math.huge\n    if not ok then bridge.log('error', tostring(e)) end\n    return ok end,")
      .replace('    if not f then return false, err end', "    if not f then bridge.log('error', tostring(err)); return false end");
    this.api = L.doStringSync(prelude);
    let src;
    try { src = this.read(this.man.main); } catch (e) { this.log('error', `can't read ${this.man.main}`); return false; }
    const ok = this.api.start(src, this.man.main, LOAD_BUDGET);
    if (!ok) { this.stop(); return false; }
    this.running = true;
    this.log('info', `▶ ${this.man.name} ${this.man.version} started`);
    return true;
  }
  stop() {
    if (this.api && this.running) { try { this.api.stop(); } catch (e) {} }
    this.running = false;
    for (const t of this.timers) clearTimeout(t.h), clearInterval(t.h);
    this.timers = []; this.commands = {};
    for (const pid of Object.keys(this.panels)) this.mgr.emit('panel_removed', { aid: this.id, pid });
    this.panels = {}; this.widgets = {};
    try { this.L && this.L.global.close(); } catch (e) {}
    this.api = null; this.L = null;
  }
  fire(name, ...args) { if (this.running && this.api) { try { this.api.fire(name, ...args.map(nn)); } catch (e) { this.log('error', String(e.message || e)); } } }
  call(fn, ...args) {
    if (!this.running || !this.api) return null;
    try { return this.api.call(fn, ...args.map(nn)); } catch (e) { this.log('error', String(e.message || e)); return null; }
  }
  bridge(compile) {
    const h = this, mgr = this.mgr;
    // (wasmoon can't take a JS null back into Lua: everything goes through clean(), null becomes nil)
    const clean = (v, depth = 0) => {
      if (v === null || v === undefined || depth > 20) return undefined;
      if (Array.isArray(v)) return v.filter((x) => x !== null && x !== undefined).map((x) => clean(x, depth + 1));
      if (typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) if (x !== null && x !== undefined) o[k] = clean(x, depth + 1); return o; }
      return v;
    };
    const wrap = (f) => (...a) => { try { return clean(f(...a)); } catch (e) { if (e instanceof PermErr) { h.log('error', e.message); return undefined; } throw e; } };
    const fns = {
      send(cid, text) { h.need('chat.send'); ctx.api('send', { chat_id: parseInt(cid, 10), body: String(text).slice(0, 4000) }).catch(() => {}); return true; },
      chats() { h.need('chat.read'); const st = ctx.store; return Object.values(st.chats).map((c) => ({ Id: c.id, Name: st.chatTitle(c), Kind: c.kind, Unread: c.unread || 0 })); },
      current_chat() { const top = ctx.stack[ctx.stack.length - 1]; return top && top.kind === 'chat' ? top.cid : null; },
      open_chat(cid) { h.need('chat.read'); ctx.openChat(parseInt(cid, 10)); },
      command(name, desc, fn) { h.need('commands'); const n = '/' + String(name).replace(/^\//, '').split(/\s/)[0].toLowerCase().slice(0, 24); h.commands[n] = [String(desc).slice(0, 80), fn]; return true; },
      panel(title, icon, page) {
        h.need('ui');
        if (Object.keys(h.panels).length >= 8) throw new PermErr('an add-on can have at most 8 panels/pages');
        const pid = `${h.id}:${Object.keys(h.panels).length + 1}`;
        h.panels[pid] = { title: String(title).slice(0, 40), icon: String(icon).slice(0, 4), widgets: [], page: !!page };
        mgr.emit('panel', { aid: h.id, pid });
        return pid;
      },
      widget(pid, kind, a, b, c) {
        h.need('ui');
        if (!h.panels[pid] || Object.keys(h.widgets).length > 300) return null;
        const wid = `${pid}:${Object.keys(h.widgets).length + 1}`;
        const spec = { id: wid, kind, a: typeof a === 'function' ? null : a };
        if (kind === 'button' || kind === 'input') spec.fn = b;
        else if (kind === 'toggle') { spec.value = !!b; spec.fn = c; }
        else if (kind === 'canvas') { spec.w = Math.max(16, Math.min(1280, parseInt(a || 320, 10))); spec.h = Math.max(16, Math.min(960, parseInt(b || 200, 10))); spec.ops = []; spec.shown = []; }
        h.widgets[wid] = spec;
        h.panels[pid].widgets.push(wid);
        mgr.emit('panel', { aid: h.id, pid });
        return wid;
      },
      wset(wid, key, val) { if (h.widgets[wid]) { h.widgets[wid][key] = val; mgr.emit('widget', { aid: h.id, wid }); } },
      pclear(pid) { if (h.panels[pid]) { for (const w of h.panels[pid].widgets) delete h.widgets[w]; h.panels[pid].widgets = []; mgr.emit('panel', { aid: h.id, pid }); } },
      ptitle(pid, t) { if (h.panels[pid]) { h.panels[pid].title = String(t).slice(0, 40); mgr.emit('panel', { aid: h.id, pid }); } },
      pdestroy(pid) { if (h.panels[pid]) { delete h.panels[pid]; mgr.emit('panel_removed', { aid: h.id, pid }); } },
      draw(wid, op, ...a) {
        const w = h.widgets[wid];
        if (!w || w.kind !== 'canvas') return;
        if (op === 'clear') w.ops = [];
        if (w.ops.length < 20000) w.ops.push([op, ...a.map((x) => (['number', 'string', 'boolean'].includes(typeof x) ? x : 0))]);
      },
      present(wid) { const w = h.widgets[wid]; if (w && w.kind === 'canvas') { w.shown = w.ops; w.ops = [...w.ops]; mgr.emit('canvas', { aid: h.id, wid }); } },
      heartbeat(on) { h.wantHB = !!on; mgr.heartbeatWanted(); },
      toast(text, kind) { h.need('notify'); ctx.toast(`${h.man.icon} ${String(text).slice(0, 200)}`, ['info', 'ok', 'error'].includes(kind) ? kind : 'info'); },
      notify(title, body) { h.need('notify'); import('../ctx.js').then(() => ctx.toast(`${title}: ${body}`.slice(0, 200))); },
      theme_get(key) { return palette()[key] ?? null; },
      theme_all() { return { ...palette() }; },
      theme_accent(hex) { h.need('theme'); if (/^#[0-9a-fA-F]{6}$/.test(hex)) S.set('accent', hex); },
      theme_set(name) { h.need('theme'); if (THEMES[name] || (S.get('custom_themes') || {})[name]) { S.set('theme', name); S.set('accent', ''); } },
      theme_list() { return [...Object.keys(THEMES), ...Object.keys(S.get('custom_themes') || {})]; },
      layout_set() { h.need('layout'); /* the phone has one layout */ },
      layout_get() { return 'phone'; },
      layout_list() { return ['phone']; },
      sound(name) { h.need('sound'); try { ctx.play(String(name).slice(0, 30)); } catch (e) {} },
      data_get(key) { return (h.data || {})[key] ?? null; },
      data_set(key, val) {
        h.data = h.data || {};
        if (val === null || val === undefined) delete h.data[key]; else h.data[key] = val;
        const raw = JSON.stringify(h.data);
        if (raw.length > 256 * 1024) throw new PermErr("this add-on's saved data is over 256 KB");
        idb.put('kv', 'addondata:' + h.id, h.data).catch(() => {});
      },
      me() { const u = ctx.store.me || {}; return { Id: u.id, Name: u.display || u.username, Username: u.username }; },
      friends() {
        h.need('users');
        const st = ctx.store;
        return Object.values(st.rels).filter((r) => r.state === 'friend').map((r) => ({ Id: r.user.id, Name: st.name(r.user.id), Username: r.user.username,
          Online: !!r.user.presence && r.user.presence !== 'offline' }));
      },
      json_encode(v) { return JSON.stringify(v ?? null); },
      json_decode(s) { try { return JSON.parse(s); } catch (e) { return null; } },
      timer(sec, repeat, fn) {
        if (h.timers.length > 50) throw new PermErr('too many timers');
        const t = { h: null };
        const run = () => { if (h.running) h.call(fn); };
        t.h = repeat ? setInterval(run, Math.max(100, sec * 1000)) : setTimeout(run, Math.max(0, sec * 1000));
        h.timers.push(t);
        return () => { clearTimeout(t.h); clearInterval(t.h); };
      },
      log(kind, text) { h.log(kind, String(text).slice(0, 2000)); },
      read(rel) { return h.read(rel); },
      budget() { return CALL_BUDGET; },
    };
    const out = Object.fromEntries(Object.entries(fns).map(([k, f]) => [k, wrap(f)]));
    out.version = () => '19.6';
    out.addon_name = () => h.man.name;
    out.addon_id = () => h.id;
    return out;
  }
}

// ---------------------------------------------------------------- all add-ons
class Manager {
  constructor() { this.hosts = {}; this.listeners = new Set(); this.logs = []; this.hb = null; this.lastBeat = 0; this.available = typeof WebAssembly !== 'undefined'; }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(t, d = {}) { for (const f of [...this.listeners]) { try { f(t, d); } catch (e) {} } ctx.bus.emit('addons', t, d); }
  emitLog(aid, kind, text) { this.logs.push({ aid, kind, text, t: Date.now() }); this.logs = this.logs.slice(-300); this.emit('log', { aid, kind, text }); }
  async startAll() {
    for (const a of await installedList()) if ((S.get('addons') || {})[a.man.id]?.enabled) await this.start(a.man, a.files);
  }
  async start(man, files, dev = false) {
    this.stop(man.id);
    const h = new Host(this, man, files, dev);
    h.data = (await idb.get('kv', 'addondata:' + man.id).catch(() => null)) || {};
    this.hosts[man.id] = h;
    let ok = false;
    try { ok = await h.start(); } catch (e) { h.log('error', "couldn't start: " + (e.message || e)); }
    if (!ok) {
      delete this.hosts[man.id];
      if (!dev) ctx.toast(`🧩 ${man.name} didn't start — open it in the Coding Cult to see why`, 'error');
    }
    this.emit('changed');
    return ok ? h : null;
  }
  stop(id) {
    const h = this.hosts[id];
    if (!h) return;
    h.stop();
    delete this.hosts[id];
    this.heartbeatWanted();
    this.emit('changed');
  }
  async setEnabled(id, on) {
    const st = { ...(S.get('addons') || {}) };
    st[id] = { ...(st[id] || {}), enabled: !!on };
    S.set('addons', st);
    if (on) { const a = await getInstalled(id); if (a) await this.start(a.man, a.files); } else this.stop(id);
  }
  crashed(h) { ctx.toast(`🧩 ${h.man.name} kept crashing and was switched off`, 'error'); setTimeout(() => this.setEnabled(h.id, false), 0); }
  heartbeatWanted() {
    const on = Object.values(this.hosts).some((h) => h.wantHB);
    if (on && !this.hb) { this.lastBeat = performance.now(); this.hb = setInterval(() => this.beat(), 33); }
    else if (!on && this.hb) { clearInterval(this.hb); this.hb = null; }
  }
  beat() {
    const t = performance.now(), dt = (t - this.lastBeat) / 1000;
    this.lastBeat = t;
    for (const h of Object.values(this.hosts)) if (h.wantHB) h.fire('Heartbeat', dt);
  }
  canvasEvent(aid, wid, name, ...args) { const h = this.hosts[aid]; if (h) h.fire(`c:${wid}:${name}`, ...args); }
  fire(name, payload, perm = 'chat.read') {
    for (const h of Object.values(this.hosts)) if (!perm || h.perms.has(perm)) payload === undefined ? h.fire(name) : h.fire(name, payload);
  }
  onMessage(m) {
    if (!Object.keys(this.hosts).length || m.kind === 'system') return;
    const st = ctx.store;
    const p = { Id: m.id, ChatId: m.chat_id, Text: m.body || '', Kind: m.kind, Sender: { Id: m.sender, Name: st.name(m.sender) }, Mine: m.sender === st.myId, Time: m.created };
    this.fire(p.Mine ? 'MessageSent' : 'MessageReceived', p);
  }
  onChatOpened(cid) {
    const c = ctx.store.chats[cid];
    if (c && Object.keys(this.hosts).length) this.fire('ChatOpened', { Id: cid, Name: ctx.store.chatTitle(c), Kind: c.kind });
  }
  commands() {
    const out = {};
    for (const h of Object.values(this.hosts)) for (const [n, [d]] of Object.entries(h.commands)) out[n] = [d, h.man.name];
    return out;
  }
  runCommand(name, args, cid) {
    for (const h of Object.values(this.hosts)) {
      if (h.commands[name]) {
        const c = ctx.store.chats[cid] || {};
        h.call(h.commands[name][1], args, { Id: cid, Name: c.id ? ctx.store.chatTitle(c) : '', Kind: c.kind });
        return true;
      }
    }
    return false;
  }
  // Lua compile check for the editor (never runs anything)
  async check(src, name = 'file.lua') {
    if (!this.checker) {
      const f = await factory();
      const L = await f.createEngine({ injectObjects: false, enableProxy: false });
      this.checker = L.doStringSync("return function(src, name) local f, e = load(src, '=' .. name, 't', {}); return e end");
    }
    const err = this.checker(src, name);
    if (!err) return null;
    const m = /^[^:]*:(\d+):\s*([\s\S]*)$/.exec(String(err));
    return m ? [parseInt(m[1], 10), m[2]] : [1, String(err)];
  }
}

export const addons = new Manager();
ctx.addons = addons;
globalThis.smultAddons = addons;   // (handy for debugging in the dev tools)
ctx.net.on((d) => { if (d.t === 'message') addons.onMessage(d.msg); });
