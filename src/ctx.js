// The app controller (like client.py's App on PC): login, events -> store, notifications, sounds, navigation, calls.
import { P2PNet, Err } from './net/backend.js';
import { Store } from './net/store.js';
import { S } from './util/settings.js';
import { tr } from './util/i18n.js';
import * as sounds from './util/sounds.js';
import { isNative, LobbyNative } from './native.js';

class Bus {
  constructor() { this.l = new Map(); }
  on(ev, fn) { if (!this.l.has(ev)) this.l.set(ev, new Set()); this.l.get(ev).add(fn); return () => this.l.get(ev).delete(fn); }
  emit(ev, ...a) { for (const f of [...(this.l.get(ev) || [])]) { try { f(...a); } catch (e) { console.error(e); } } }
}

export const ctx = {
  bus: new Bus(),
  net: new P2PNet(),
  store: new Store(),
  S,
  authed: false,
  conn: 'offline',
  stack: [],              // pushed screens: {kind, ...props}
  tab: 'chats',
  sheets: [],             // bottom sheets / dialogs
  toasts: [],
  call: null,             // CallSession when in a call
  rings: new Map(),       // call_id -> ring info (incoming)
  current: null,          // open chat id
  foreground: true,
  idle: false,
  brain: null,
  lang: null,
  music: null,
  transfers: {},          // big file uploads/downloads in progress
};

let toastId = 0;
ctx.toast = (text, kind = 'info', ms = 3000) => {
  const t = { id: ++toastId, text: tr(String(text)), kind };
  ctx.toasts = [...ctx.toasts, t].slice(-3);
  ctx.bus.emit('ui');
  setTimeout(() => { ctx.toasts = ctx.toasts.filter((x) => x.id !== t.id); ctx.bus.emit('ui'); }, ms);
};

ctx.api = async (t, d = {}, { quiet = false } = {}) => {
  try {
    return await ctx.net.req(t, d);
  } catch (e) {
    if (!quiet) ctx.toast(e instanceof Err ? e.message : 'Error: ' + (e.message || e), 'error', 4500);
    throw e;
  }
};
ctx.try = (p) => p.catch(() => null);

// ---------------------------------------------------------------- navigation
ctx.push = (screen) => { ctx.stack = [...ctx.stack, screen]; ctx.bus.emit('nav'); };
ctx.pop = () => {
  if (ctx.sheets.length) { ctx.sheets = ctx.sheets.slice(0, -1); ctx.bus.emit('nav'); return true; }
  if (ctx.stack.length) { ctx.stack = ctx.stack.slice(0, -1); ctx.syncCurrent(); ctx.bus.emit('nav'); return true; }
  if (ctx.tab !== 'chats') { ctx.tab = 'chats'; ctx.bus.emit('nav'); return true; }
  return false;
};
ctx.setTab = (t) => { ctx.tab = t; ctx.stack = []; ctx.syncCurrent(); ctx.bus.emit('nav'); };
ctx.sheet = (s) => { ctx.sheets = [...ctx.sheets, s]; ctx.bus.emit('nav'); };
ctx.closeSheet = (s) => { ctx.sheets = s ? ctx.sheets.filter((x) => x !== s) : ctx.sheets.slice(0, -1); ctx.bus.emit('nav'); };
ctx.syncCurrent = () => {
  const top = ctx.stack[ctx.stack.length - 1];
  ctx.current = top && top.kind === 'chat' ? top.cid : null;
};
ctx.openChat = (cid) => {
  ctx.stack = ctx.stack.filter((s) => s.kind !== 'chat');
  ctx.push({ kind: 'chat', cid });
  ctx.current = cid;
  ctx.bus.emit('nav');
  if (ctx.addons) ctx.addons.onChatOpened(cid);
};
ctx.openDm = async (uid) => {
  const ex = ctx.store.dmWith(uid);
  if (ex) return ctx.openChat(ex.id);
  const c = await ctx.api('open_dm', { user_id: uid });
  ctx.store.handle({ t: 'chat', chat: c });
  ctx.openChat(c.id);
};
ctx.profile = (uid) => ctx.sheet({ kind: 'profile', uid });

// simple dialogs as promises
ctx.confirm = (text, { ok = 'OK', danger = false } = {}) => new Promise((res) => ctx.sheet({ kind: 'confirm', text: tr(text), ok: tr(ok), danger, res }));
ctx.prompt = (title, { value = '', placeholder = '', multiline = false } = {}) =>
  new Promise((res) => ctx.sheet({ kind: 'prompt', title: tr(title), value, placeholder: tr(placeholder), multiline, res }));
ctx.menu = (items, title = '') => ctx.sheet({ kind: 'menu', items, title });

// ---------------------------------------------------------------- sounds
ctx.play = (name, { force = false, vol } = {}) => {
  if (!force && !S.get('notify_sounds') && !['ring', 'mute', 'unmute', 'join', 'leave', 'outgoing'].includes(name)) return;
  sounds.play(name, vol);
};

// ---------------------------------------------------------------- login
ctx.relays = () => S.get('relays');
ctx.turn = () => (S.get('turn_url') ? { url: S.get('turn_url'), user: S.get('turn_user'), pass: S.get('turn_pass') } : null);

ctx.login = async (msg, onProgress) => {
  const res = await ctx.net.connect(msg, { relays: ctx.relays(), turn: ctx.turn(), onProgress });
  S.set('token', res.token);
  if (msg.username) S.set('username', msg.username);
  ctx.authed = true;
  ctx.bus.emit('auth');
  ctx.afterLogin();
  return res;
};
ctx.resume = async () => {
  const tok = S.get('token');
  if (!tok) return false;
  try {
    await ctx.login({ t: 'resume', token: tok });
    return true;
  } catch (e) {
    return false;
  }
};
ctx.logout = async () => {
  if (ctx.call) await ctx.leaveCall();
  await ctx.net.close();
  S.set('token', '');
  ctx.authed = false;
  ctx.store.reset();
  ctx.stack = []; ctx.sheets = []; ctx.tab = 'chats';
  keepAlive(false);
  ctx.bus.emit('auth');
};

ctx.afterLogin = () => {
  keepAlive(S.get('keep_alive'));
  import('./brain/vision.js').then((m) => { if (!ctx.brain) ctx.brain = new m.VisionBrain(ctx); ctx.brain.load(); });
  import('./brain/lang.js').then((m) => { if (!ctx.lang) ctx.lang = new m.LangBrain(ctx); ctx.lang.load(); });
  setTimeout(() => seasonHello(), 3000);
  import('./util/updates.js').then((m) => m.startUpdates());                // the owner's phone updates
  setTimeout(() => import('./addons/runtime.js').then((m) => m.addons.startAll()).catch((e) => console.warn('add-ons', e)), 1500);
};

function keepAlive(on) {
  if (!isNative) return;
  LobbyNative.keepAlive({ on: !!on, title: 'Smult', text: tr('Connected — you get messages and calls') }).catch(() => {});
}
S.on((k, v) => { if (k === 'keep_alive' && ctx.authed) keepAlive(v); });

function seasonHello() {
  const s = sounds.currentSeason();
  const key = s ? s + new Date().getFullYear() : '';
  if (s && localStorage.getItem('season_seen') !== key) {
    localStorage.setItem('season_seen', key);
    ctx.toast(`${sounds.SEASON_ICON[s]} ${s === 'halloween' ? 'Halloween' : 'Christmas'} sounds are on! (Settings → Notifications to change)`, 'info', 5000);
    ctx.play('message', { force: true });
  }
}

// ---------------------------------------------------------------- events from the backend
ctx.net.onState((s) => { ctx.conn = s; ctx.bus.emit('conn'); });
ctx.net.on((d) => {
  ctx.store.handle(d);
  const t = d.t;
  if (t === 'message') notifyMessage(d.msg);
  else if (t === 'relation' && d.rel.state === 'in') {
    if (S.get('sound_friend')) ctx.play('friend');
    notify(tr('Friend request'), tr(`${d.rel.user.display} wants to be friends`), { force: true });
  } else if (t === 'nudge') onNudge(d);
  else if (t.startsWith('call_')) import('./media/call.js').then((m) => m.onCallEvent(ctx, d));
  else if (t === 'brain_ex' && ctx.brain) ctx.brain.addExample(d.ex);
  else if (t === 'brain_ckpt' && ctx.brain) ctx.brain.mergeRemote(d.author, d.content, d.created);
  else if (t === 'lang_txt' && ctx.lang) ctx.lang.addChunk(d.chunk);
  else if (t === 'lang_ckpt' && ctx.lang) ctx.lang.mergeRemote(d.author, d.content, d.created);
  else if (t === 'transfer') {
    ctx.transfers[d.id] = d;
    if (d.finished) setTimeout(() => { delete ctx.transfers[d.id]; ctx.bus.emit('transfer'); }, 1500);
    ctx.bus.emit('transfer');
    return;
  }
  ctx.bus.emit('store', t, d);
});
ctx.net.onMedia((uid, kind, bytes) => { if (ctx.call) ctx.call.onMedia(uid, kind, bytes); });

function inQuietHours() {
  if (!S.get('quiet_hours')) return false;
  const n = new Date();
  const cur = n.getHours() * 60 + n.getMinutes();
  const [fh, fm] = S.get('quiet_from').split(':').map(Number), [th, tm] = S.get('quiet_to').split(':').map(Number);
  const f = fh * 60 + fm, to = th * 60 + tm;
  return f <= to ? cur >= f && cur < to : cur >= f || cur < to;
}
ctx.dndBlocks = (uid) => {
  const me = ctx.store.me || {};
  const dnd = (me.privacy || {}).presence === 'dnd' || inQuietHours();
  if (!dnd) return false;
  return !(S.get('dnd_trusted_bypass') && ctx.store.isTrusted(uid));
};

function notifyMessage(m) {
  const st = ctx.store;
  if (m.sender === st.myId || m.sender === 0 || ['system', 'call', 'nudge'].includes(m.kind)) return;
  const c = st.chats[m.chat_id];
  if (!c) return;
  const body0 = m.body || '';
  const mention = st.me && (body0.toLowerCase().includes('@' + st.me.username.toLowerCase()) || body0.includes('@everyone'));
  const focused = ctx.foreground && ctx.current === m.chat_id;
  if (focused || m.silent) return;
  if (c.my.muted && !mention) return;
  if (c.kind === 'group' && S.get('notify_only_mentions_groups') && !mention) return;
  if (ctx.dndBlocks(m.sender)) return;
  if (S.get(mention ? 'sound_mention' : 'sound_message')) ctx.play(mention ? 'mention' : 'message');
  if (S.get('vibrate') && isNative) import('@capacitor/haptics').then((h) => h.Haptics.vibrate({ duration: 120 })).catch(() => {});
  const title = st.name(m.sender) + (c.kind === 'group' ? `  ·  ${st.chatTitle(c)}` : '');
  let body;
  if (S.get('notify_preview') && !S.get('streamer_mode')) {
    body = m.body || { image: '🖼️ Photo', file: '📎 File', voice: '🎤 Voice message', poll: '📊 Poll' }[m.kind] || 'New message';
  } else body = 'New message';
  notify(title, tr(body).slice(0, 200), { chatId: m.chat_id });
}

let notifId = 1;
export async function notify(title, body, { force = false, chatId = null } = {}) {
  if (!(S.get('notify_desktop') || force)) return;
  if (ctx.foreground && !force) {
    // in the app already: a little banner instead of a system notification
    if (chatId && ctx.current !== chatId) ctx.bus.emit('banner', { title, body, chatId });
    return;
  }
  if (isNative) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      await LocalNotifications.schedule({ notifications: [{ id: notifId++ % 100000, title, body, channelId: 'messages',
        smallIcon: 'ic_stat_lobby', extra: { chat_id: chatId } }] });
    } catch (e) {}
  } else if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(title, { body });
    n.onclick = () => { window.focus(); if (chatId) ctx.openChat(chatId); };
  }
}
ctx.notify = notify;

function onNudge(d) {
  if (!S.get('nudges') || ctx.dndBlocks(d.from)) return;
  ctx.play('nudge');
  if (isNative) import('@capacitor/haptics').then((h) => h.Haptics.vibrate({ duration: 400 })).catch(() => {});
  ctx.bus.emit('nudge', d);
  notify(ctx.store.name(d.from), tr(`${ctx.store.name(d.from)} sent a nudge!`), { chatId: d.chat_id });
}

// ---------------------------------------------------------------- calls (logic lives in media/call.js)
ctx.startCall = (cid, video = false) => import('./media/call.js').then((m) => m.startCall(ctx, cid, video));
ctx.joinCall = (callId, opts) => import('./media/call.js').then((m) => m.joinCall(ctx, callId, opts));
ctx.leaveCall = () => import('./media/call.js').then((m) => m.leaveCall(ctx));

// ---------------------------------------------------------------- app lifecycle (Android)
let idleTimer = null;
function setForeground(on) {
  ctx.foreground = on;
  if (!ctx.authed) return;
  clearTimeout(idleTimer);
  if (on) {
    if (ctx.idle) { ctx.idle = false; ctx.try(ctx.api('activity', { idle: false }, { quiet: true })); }
  } else {
    ctx.net.save();
    const mins = S.get('idle_minutes');
    if (mins > 0) idleTimer = setTimeout(() => { ctx.idle = true; ctx.try(ctx.api('activity', { idle: true }, { quiet: true })); }, mins * 60000);
  }
  ctx.bus.emit('foreground', on);
}
document.addEventListener('visibilitychange', () => setForeground(!document.hidden));

export async function initNative() {
  if (!isNative) return;
  const { App } = await import('@capacitor/app');
  App.addListener('backButton', () => { if (!ctx.pop()) App.minimizeApp(); });
  App.addListener('pause', () => setForeground(false));
  App.addListener('resume', () => setForeground(true));
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const p = await LocalNotifications.checkPermissions();
    if (p.display !== 'granted') await LocalNotifications.requestPermissions();
    await LocalNotifications.createChannel({ id: 'messages', name: 'Messages', importance: 4, sound: undefined, vibration: true });
    await LocalNotifications.createChannel({ id: 'calls', name: 'Calls', importance: 5, vibration: true });
    LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
      const cid = a.notification?.extra?.chat_id;
      if (cid) ctx.openChat(cid);
    });
  } catch (e) {}
  LobbyNative.addListener('callAction', (e) => import('./media/call.js').then((m) => m.onNativeCallAction(ctx, e))).catch(() => {});
}
