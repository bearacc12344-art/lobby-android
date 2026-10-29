// Smult P2P backend - a faithful JavaScript port of p2p.py's Backend, so phones and PCs share the same chats,
// friends, groups, calls and community brains. No server: Nostr relays carry signed, end-to-end encrypted events.
import { Keys, enc, dec, encBytes, decBytes, encPart, decPart, b64, unb64, hex, unhex, randBytes, sha256hex, te } from './crypto.js';
import { RelayPool } from './relay.js';
import { LocalDB } from './db.js';
import { idb } from './idb.js';
import * as badges from './badges.js';
import { httpGet, httpPost } from './http.js';

export const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://offchain.pub',
  'wss://nostr.mom', 'wss://relay.nostr.net'];
const BLOSSOM = globalThis.LOBBY_BLOSSOM || ['https://blossom.nostr.build', 'https://blossom.primal.net', 'https://nostr.download'];
const STUN = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];

export const K_DIRECT = 4444, K_GROUP = 4445, K_EPH = 24444, K_GEPH = 24445, K_REPL = 30078, K_AUTH = 24242;
export const K_BRAIN = 4446, K_LANG = 4447, K_STATUS = 4448;   // 4448: 24h status posts, encrypted to each friend
const STATUS_TTL = 24 * 3600;
export const D_PROFILE = 'lobby-profile', D_STATE = 'lobby-state', D_BRAIN = 'lobby-brain-ckpt', D_LANG = 'lobby-lang-ckpt';
const LANG_CHUNK_MAX = 8000;
export const MAX_FILE = 200 * 1024 * 1024;
const PART = 8 * 1024 * 1024, PARTS_OVER = 20 * 1024 * 1024, PAR = 4;   // big files: parallel 8 MB parts (same as PC)
const INLINE_MAX = 32 * 1024;
const ONLINE_WINDOW = 100;
const RING_TIMEOUT = 45;
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const DEFAULT_PRIVACY = { friend_requests: 'everyone', calls_from: 'friends', group_invites: 'friends',
  last_seen: 'friends', read_receipts: true, typing: true, presence: 'online' };
const COLORS = ['#e0a94a', '#d0473a', '#c46bd9', '#6a8cff', '#3fb6c9', '#5ec26a'];

export class Err extends Error {}

const now = () => Date.now() / 1000;
const ms = () => Date.now();
const newMid = (tms) => (tms || ms()) * 4096 + Math.floor(Math.random() * 4096);
const tag = (ev, name) => { for (const t of ev.tags || []) if (t.length >= 2 && t[0] === name) return t[1]; return null; };
const ext = (name) => { const i = name.lastIndexOf('.'); return i >= 0 ? name.slice(i).toLowerCase() : ''; };
const basename = (p) => String(p).split(/[\\/]/).pop();
const isHex64 = (s) => /^[0-9a-f]{64}$/.test(String(s || ''));
const fire = (p) => { if (p && p.catch) p.catch((e) => console.warn('bg task', e)); };
const sleep = (t) => new Promise((r) => setTimeout(r, t));
const jsonOr = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const cleanStr = (v, n) => String(v ?? '').slice(0, n);

class CallInfo {
  constructor(gcid, id, chatId, started, starter) {
    Object.assign(this, { gcid, id, chatId, started, starter });
    this.parts = new Map();     // uid -> {muted, deaf, cam, screen, seen}
    this.ringing = new Map();   // uid -> ts
    this.ever = new Set();
  }
}

export class Backend {
  constructor(net, keys, username, relays, turn) {
    this.net = net;          // {emit(obj), state(str), media(uid, kind, bytes), bytes}
    this.k = keys;
    this.username = username;
    this.turn = turn;
    this.relayUrls = relays;
    this.syncing = true;
    this.syncBuf = [];
    this.eose = new Set();
    this.idle = false;
    this.calls = new Map();
    this.callByLocal = new Map();
    this.nextCall = 1;
    this.myCall = null;
    this.myState = { muted: false, deaf: false, cam: false, screen: false };
    this.peers = new Map();
    this.rings = new Map();
    this.nudgeT = 0;
    this.readPending = new Map();
    this.stateDirty = false;
    this.hbReplied = new Map();
    this.bcache = null;
    this.timers = [];
    this.procQueue = [];
    this.processing = false;
    this.stopped = false;
    this.pool = new RelayPool(relays, {
      onEvent: (ev) => this.onEvent(ev),
      onEose: (url, sid) => { if (sid === 'main') this.eose.add(url); },
      onStatus: () => this.net.state(this.pool.connected() ? 'online' : 'reconnecting'),
    });
  }

  async init() {
    this.db = await LocalDB.open('lobby_' + this.k.pub.slice(0, 16));
    this.me = this.uid(this.k.pub);
  }

  // ------------------------------------------------------------------ helpers
  q(sql, ...a) { return this.db.q(sql, ...a); }
  q1(sql, ...a) { return this.db.q1(sql, ...a); }
  x(sql, ...a) { return this.db.x(sql, ...a); }
  kv(k, d = null) { return this.db.kv(k, d); }
  setKv(k, v) { this.db.setKv(k, v); }
  emit(obj) { if (!this.syncing || obj.t === 'init') this.net.emit(obj); }
  uid(pub) {
    const r = this.q1('SELECT id FROM users WHERE pubkey=?', pub);
    if (r) return r.id;
    return this.x('INSERT INTO users(pubkey, display) VALUES(?,?)', pub, 'user ' + pub.slice(0, 6));
  }
  pub(uid) {
    const r = this.q1('SELECT pubkey FROM users WHERE id=?', uid);
    if (!r) throw new Err('Unknown user');
    return r.pubkey;
  }
  privacy() { return { ...DEFAULT_PRIVACY, ...this.kv('privacy', {}) }; }
  rel(uid) { return this.q1('SELECT * FROM relations WHERE user_id=?', uid); }
  isFriend(uid) { const r = this.rel(uid); return !!(r && r.state === 'friend'); }
  trusted(uid) { const r = this.rel(uid); return !!(r && r.state === 'friend' && r.trusted); }
  blocked(uid) { const r = this.rel(uid); return !!(r && r.state === 'blocked'); }
  name(uid) { const r = this.q1('SELECT display, username FROM users WHERE id=?', uid); return r ? (r.display || r.username) : 'someone'; }
  friendUids() { return this.q("SELECT user_id FROM relations WHERE state='friend'").map((r) => r.user_id); }
  chatMembers(cid) { return this.q('SELECT user_id FROM members WHERE chat_id=?', cid).map((r) => r.user_id); }
  chat(cid) {
    const c = this.q1('SELECT * FROM chats WHERE id=? AND left=0', cid);
    if (!c) throw new Err('Chat not found');
    return c;
  }
  gkey(gid, ver = null) {
    const r = ver === null || ver === undefined
      ? this.q1('SELECT ver, key FROM gkeys WHERE gid=? ORDER BY ver DESC LIMIT 1', gid)
      : this.q1('SELECT ver, key FROM gkeys WHERE gid=? AND ver=?', gid, parseInt(ver, 10));
    return r ? [r.ver, unb64(r.key)] : [null, null];
  }
  gids() { return this.q("SELECT ckey FROM chats WHERE kind='group' AND left=0").map((r) => r.ckey.slice(2)); }

  // ------------------------------------------------------------------ publishing
  async sendDirect(toUid, payload, store = true) {
    const topub = this.pub(toUid);
    if (payload.ms === undefined) payload.ms = ms();
    const ev = this.k.sign(K_DIRECT, [['p', topub]], await enc(this.k.shared(topub), payload));
    this.pool.publish(ev, store);
  }
  async sendGroup(cid, payload) {
    const c = this.chat(cid);
    const gid = c.ckey.slice(2);
    const [ver, key] = this.gkey(gid);
    if (!key) throw new Err('Missing group key');
    if (payload.ms === undefined) payload.ms = ms();
    const ev = this.k.sign(K_GROUP, [['g', gid], ['v', String(ver)]], await enc(key, payload));
    this.pool.publish(ev);
  }
  async sendChat(cid, payload) {
    const c = this.chat(cid);
    if (c.kind === 'group') await this.sendGroup(cid, payload);
    else await this.sendDirect(this.dmOther(c), payload);
  }
  async sendEph(uids, payload, perUser = null) {
    const r = {}, ptags = [];
    for (const u of new Set(uids)) {
      if (u === this.me) continue;
      let pk;
      try { pk = this.pub(u); } catch (e) { continue; }
      const pl = perUser ? perUser(u) : payload;
      if (!pl) continue;
      r[pk.slice(0, 16)] = await enc(this.k.shared(pk), pl);
      ptags.push(['p', pk]);
    }
    if (!ptags.length) return;
    this.pool.publish(this.k.sign(K_EPH, ptags, JSON.stringify({ r })), false);
  }
  async sendGeph(cid, payload) {
    const c = this.chat(cid);
    const gid = c.ckey.slice(2);
    const [ver, key] = this.gkey(gid);
    if (!key) return;
    this.pool.publish(this.k.sign(K_GEPH, [['g', gid], ['v', String(ver)]], await enc(key, payload)), false);
  }
  async sendChatEph(cid, payload, only = null) {
    const c = this.chat(cid);
    if (c.kind === 'group' && !only) await this.sendGeph(cid, payload);
    else await this.sendEph(only || [this.dmOther(c)], payload);
  }
  async publishProfile() {
    const u = this.q1('SELECT * FROM users WHERE id=?', this.me);
    const body = { username: u.username, display: u.display, avatar: u.avatar, color: u.color, bio: u.bio,
      status_msg: u.status_msg, reg: u.reg, pic: u.pic || '', pic_url: u.pic_url || '' };
    const ev = this.k.sign(K_REPL, [['d', D_PROFILE], ['u', u.username.toLowerCase()], ['t', 'lobby']], JSON.stringify(body));
    this.x('UPDATE users SET profile_ts=? WHERE id=?', ev.created_at, this.me);
    this.pool.publish(ev);
  }
  markState() { this.stateDirty = true; }
  async publishState() {
    const rels = {};
    for (const r of this.q('SELECT r.*, u.pubkey FROM relations r JOIN users u ON u.id=r.user_id')) {
      rels[r.pubkey] = { state: r.state, trusted: r.trusted, nickname: r.nickname, note: r.note, since: r.since, ts: r.ts };
    }
    const chats = {};
    for (const c of this.q('SELECT * FROM chats')) {
      chats[c.ckey] = { muted: c.muted, pinned: c.pinned, archived: c.archived, last_read: c.last_read, left: c.left, ts: c.prefs_ts };
    }
    const body = { rels, chats, privacy: this.privacy(), privacy_ts: this.kv('privacy_ts', 0) };
    this.pool.publish(this.k.sign(K_REPL, [['d', D_STATE]], await enc(this.k.selfKey, body)));
  }

  // ------------------------------------------------------------------ views
  presenceOf(uid) {
    if (uid === this.me) {
      const p = this.privacy().presence;
      return p === 'online' && this.idle ? 'idle' : p;
    }
    const u = this.q1('SELECT hb, presence FROM users WHERE id=?', uid);
    if (!u || now() - (u.hb || 0) > ONLINE_WINDOW) return 'offline';
    return u.presence || 'online';
  }
  userPub(uid) {
    const u = this.q1('SELECT * FROM users WHERE id=?', uid);
    if (!u) return null;
    const d = { id: uid, username: u.username || u.pubkey.slice(0, 8), display: u.display || u.username || 'user',
      avatar: u.avatar, color: u.color, status_msg: u.status_msg, bio: u.bio, presence: this.presenceOf(uid),
      last_seen: u.show_ls && u.hb ? u.hb : null, in_call: null, friend_code: `${u.username}#${u.pubkey.slice(0, 4)}`,
      pubkey: u.pubkey, pic: u.pic || '', pic_url: u.pic_url || '', badges: this.badgesOf(u.pubkey), role: this.roleOf(u.pubkey) };
    for (const c of this.calls.values()) if (c.parts.has(uid)) d.in_call = c.chatId;
    if (uid === this.me) {
      d.privacy = this.privacy();
      if (this.myCall) d.in_call = this.calls.has(this.myCall) ? this.calls.get(this.myCall).chatId : null;
    }
    return d;
  }
  relView(uid) {
    const r = this.rel(uid);
    return { user: this.userPub(uid), state: r ? r.state : null, trusted: !!(r && r.trusted), nickname: r ? r.nickname : '',
      note: r ? r.note : '', since: r ? r.since : null, trusts_me: !!(r && r.trusts_me) };
  }
  dmOther(c) { return this.uid(c.ckey.slice(3)); }
  msgView(m) {
    const d = { id: m.id, chat_id: m.chat_id, sender: m.sender, kind: m.kind, body: m.body, reply_to: m.reply_to,
      created: m.created, edited: null, deleted: false, silent: !!m.silent, file: null, reactions: {}, poll: null };
    const dl = this.q1('SELECT author FROM deletes WHERE msg_id=?', m.id);
    if (dl && (dl.author === m.sender || ['owner', 'admin'].includes(this.role(m.chat_id, dl.author)))) {
      d.deleted = true; d.body = ''; return d;
    }
    const e = this.q1('SELECT * FROM edits WHERE msg_id=?', m.id);
    if (e && e.author === m.sender) { d.body = e.body; d.edited = e.ts; }
    if (m.file) {
      const f = jsonOr(m.file, {});
      d.file = { id: m.fid, name: f.name || 'file', size: f.size || 0 };
    }
    for (const r of this.q('SELECT user_id, emoji FROM reactions WHERE msg_id=? AND on_=1', m.id)) {
      (d.reactions[r.emoji] = d.reactions[r.emoji] || []).push(r.user_id);
    }
    if (m.kind === 'poll') {
      const p = this.q1('SELECT * FROM polls WHERE msg_id=?', m.id);
      if (p) {
        const opts = jsonOr(p.options, []);
        const votes = {};
        opts.forEach((_, i) => { votes[i] = []; });
        for (const v of this.q('SELECT user_id, opts FROM votes WHERE msg_id=?', m.id)) {
          for (const o of jsonOr(v.opts, [])) if (o >= 0 && o < opts.length) votes[o].push(v.user_id);
        }
        d.poll = { options: opts, multi: !!p.multi, votes };
      }
    }
    if (m.reply_to) {
      const r = this.q1('SELECT * FROM messages WHERE id=?', m.reply_to);
      if (r) d.reply = { id: r.id, sender: r.sender, body: this.msgViewLight(r).slice(0, 120) };
    }
    return d;
  }
  msgViewLight(r) {
    if (this.q1('SELECT 1 FROM deletes WHERE msg_id=?', r.id)) return '(deleted)';
    const e = this.q1('SELECT body FROM edits WHERE msg_id=?', r.id);
    let body = e ? e.body : r.body;
    if (!body && r.file) body = jsonOr(r.file, {}).name || 'file';
    return body || r.kind;
  }
  role(cid, uid) { const r = this.q1('SELECT role FROM members WHERE chat_id=? AND user_id=?', cid, uid); return r ? r.role : null; }
  chatView(cid) {
    const c = this.q1('SELECT * FROM chats WHERE id=? AND left=0', cid);
    if (!c) return null;
    let mem;
    if (c.kind === 'dm') {
      const other = this.dmOther(c);
      mem = [{ id: this.me, role: 'member' }].concat(other !== this.me ? [{ id: other, role: 'member' }] : []);
    } else {
      mem = this.q('SELECT * FROM members WHERE chat_id=?', cid).map((r) => ({ id: r.user_id, role: r.role }));
    }
    const last = this.q1('SELECT * FROM messages WHERE chat_id=? AND shown=1 ORDER BY id DESC LIMIT 1', cid);
    let unread = this.q("SELECT id, body FROM messages WHERE chat_id=? AND shown=1 AND id>? AND sender!=? AND kind NOT IN ('system','call','nudge')",
      cid, c.last_read, this.me);
    const deleted = new Set(this.q('SELECT msg_id FROM deletes WHERE msg_id IN (SELECT id FROM messages WHERE chat_id=? AND id>?)', cid, c.last_read).map((r) => r.msg_id));
    unread = unread.filter((r) => !deleted.has(r.id));
    const meName = (this.q1('SELECT username FROM users WHERE id=?', this.me).username || '').toLowerCase();
    const mentions = unread.filter((r) => (r.body || '').toLowerCase().includes('@' + meName) || (r.body || '').includes('@everyone')).length;
    const reads = {};
    for (const r of this.q('SELECT * FROM reads WHERE chat_id=? AND user_id!=?', cid, this.me)) reads[r.user_id] = r.msg_id;
    let call = null;
    for (const cl of this.calls.values()) if (cl.chatId === cid && (cl.parts.size || this.myCall === cl.gcid)) call = this.callView(cl);
    const pins = this.q('SELECT msg_id FROM pins WHERE chat_id=? AND on_=1 ORDER BY ts', cid).map((r) => r.msg_id);
    const myRole = (mem.find((m) => m.id === this.me) || {}).role || 'member';
    const users = {};
    for (const m of mem) users[m.id] = this.userPub(m.id);
    return { id: cid, kind: c.kind, name: c.name, icon: c.icon, topic: c.topic, pic: c.pic || '', pic_url: c.pic_url || '', created_by: c.created_by, created: c.created || 0,
      members: mem, users, my: { role: myRole, last_read: c.last_read, muted: !!c.muted, pinned: !!c.pinned, archived: !!c.archived },
      last: last ? this.msgView(last) : null, unread: unread.length, mentions, reads, call, pins };
  }
  pushChat(cid) { const v = this.chatView(cid); if (v) this.emit({ t: 'chat', chat: v }); }
  pushUser(uid) { this.emit({ t: 'user', user: this.userPub(uid) }); }
  pushRel(uid) { this.emit({ t: 'relation', rel: this.relView(uid) }); }
  initPayload() {
    const rels = this.q('SELECT user_id FROM relations').map((r) => this.relView(r.user_id));
    const chats = this.q('SELECT id FROM chats WHERE left=0').map((r) => this.chatView(r.id)).filter(Boolean);
    return { t: 'init', me: this.userPub(this.me), relations: rels, chats, server: { max_file: MAX_FILE, p2p: true, relays: this.pool.connected() } };
  }

  // ------------------------------------------------------------------ lifecycle
  async start(mode, profile = null) {
    this.pool.start();
    const ok = await this.pool.waitConnected(12000);
    if (mode !== 'resume' && !ok) throw new Err("Can't reach any relay - check your internet connection");
    if (mode === 'register') {
      const name = profile.username;
      const evs = await this.pool.query([{ kinds: [K_REPL], '#d': [D_PROFILE], '#u': [name.toLowerCase()] }]);
      if (evs.some((e) => e.pubkey !== this.k.pub)) throw new Err('That username is taken');
      if (!evs.some((e) => e.pubkey === this.k.pub)) {
        this.x('UPDATE users SET username=?, display=?, reg=?, color=? WHERE id=?', name, profile.display, now(),
          COLORS[Math.floor(Math.random() * COLORS.length)], this.me);
        await this.publishProfile();
      } else {
        await this.loadMyProfile(evs);
      }
    } else if (mode === 'login') {
      const evs = await this.pool.query([{ kinds: [K_REPL], authors: [this.k.pub], '#d': [D_PROFILE] }], 6000);
      if (!evs.length) throw new Err('Wrong username or password');
      await this.loadMyProfile(evs);
    }
    const u = this.q1('SELECT username FROM users WHERE id=?', this.me);
    if (!u.username) this.x('UPDATE users SET username=? WHERE id=?', this.username, this.me);
    fire(this.afterStart(mode));
  }
  async loadMyProfile(evs) {
    const mine = evs.filter((e) => e.pubkey === this.k.pub).sort((a, b) => b.created_at - a.created_at)[0];
    this.applyProfile(mine);
    await this.publishProfile();
  }
  async afterStart() {
    this.syncing = true;
    this.emit(this.initPayload());
    const before = new Set(this.gids());
    this.resubscribe(true);
    const t0 = now();
    while (now() - t0 < 8 && this.eose.size < Math.max(1, this.pool.connected())) await sleep(100);
    await this.drain();
    const buf = this.syncBuf;
    this.syncBuf = [];
    buf.sort((a, b) => a.created_at - b.created_at);
    for (const ev of buf) await this.process(ev);
    await this.processStash();
    this.syncing = false;
    this.setKv('sync_ts', Math.floor(now()));
    const fresh = this.gids().filter((g) => !before.has(g));
    if (fresh.length) {
      this.resubscribe();
      for (const g of fresh) await this.fetchGroupHistory(g);
    }
    this.emit(this.initPayload());
    this.net.emit({ t: 'synced' });
    await this.sendPresence(null, false, true);
    this.timers.push(setInterval(() => fire(this.presenceTick()), 15000));
    this.timers.push(setInterval(() => fire(this.housekeepingTick()), 3000));
    this.timers.push(setInterval(() => fire(this.callTick()), 3000));
  }
  async stop() {
    this.stopped = true;
    try {
      if (this.myCall) await this.leaveCall();
      await this.sendPresence(null, true);
      if (this.stateDirty) await this.publishState();
      await sleep(300);
    } catch (e) {}
    for (const t of this.timers) clearInterval(t);
    this.pool.stop();
    await this.db.save();
  }
  resubscribe(initial = false) {
    const since = initial ? Math.max(0, (this.kv('sync_ts', 0) || 0) - 3600) : Math.floor(now()) - 120;
    const known = this.q('SELECT pubkey FROM users').map((r) => r.pubkey);
    const f = [
      { kinds: [K_DIRECT], '#p': [this.k.pub], since, limit: 5000 },
      { kinds: [K_DIRECT], authors: [this.k.pub], since, limit: 5000 },
      { kinds: [K_REPL], authors: known.slice(0, 500), '#d': [D_PROFILE, D_STATE] },
      { kinds: [K_EPH], '#p': [this.k.pub], since: Math.floor(now()) - 20 },
      { kinds: [K_REPL], '#d': [badges.D_BADGES], limit: 300 },
      { kinds: [K_REPL], '#d': [D_PROFILE], '#u': [badges.ADMIN_USERNAME.toLowerCase()], limit: 50 },
    ];
    const admins = [...this.bstate()[1]].sort();
    if (admins.length) f.push({ kinds: [K_REPL], '#d': [badges.D_BADGES], authors: admins.slice(0, 100) });
    f.push({ kinds: [K_BRAIN], '#t': ['lobby-brain'], limit: 4000 });
    f.push({ kinds: [K_REPL], '#d': [D_BRAIN], limit: 60 });
    f.push({ kinds: [K_LANG], '#t': ['lobby-lang'], limit: 4000 });
    f.push({ kinds: [K_REPL], '#d': [D_LANG], limit: 60 });
    f.push({ kinds: [K_STATUS], '#p': [this.k.pub], since: Math.floor(now()) - STATUS_TTL });
    f.push({ kinds: [K_STATUS], authors: [this.k.pub], since: Math.floor(now()) - STATUS_TTL });
    const g = this.gids();
    if (g.length) {
      f.push({ kinds: [K_GROUP], '#g': g, since, limit: 5000 });
      f.push({ kinds: [K_GEPH], '#g': g, since: Math.floor(now()) - 20 });
    }
    if (initial) this.eose.clear();
    this.pool.subscribe('main', f);
  }
  async fetchGroupHistory(gid) {
    const evs = await this.pool.query([{ kinds: [K_GROUP], '#g': [gid], limit: 5000 }], 6000);
    evs.sort((a, b) => a.created_at - b.created_at);
    for (const ev of evs) await this.process(ev, false);
    const c = this.q1('SELECT id FROM chats WHERE ckey=?', 'g:' + gid);
    if (c) this.pushChat(c.id);
  }

  // ------------------------------------------------------------------ incoming (processed one at a time, in order)
  onEvent(ev) {
    if (this.syncing && [K_DIRECT, K_GROUP, K_REPL, K_BRAIN, K_LANG, K_STATUS].includes(ev.kind)) { this.syncBuf.push(ev); return; }
    this.procQueue.push(ev);
    if (!this.processing) fire(this.drain());
  }
  async drain() {
    if (this.processing) { while (this.processing) await sleep(20); return; }
    this.processing = true;
    try {
      while (this.procQueue.length) {
        const ev = this.procQueue.shift();
        try { await this.process(ev); } catch (e) { console.warn('event error', e); }
      }
    } finally { this.processing = false; }
  }
  async process(ev, live = null) {
    live = live === null ? !this.syncing : live;
    const k = ev.kind;
    if (k === K_STATUS) return this.applyStatus(ev, live);
    if (k === K_BRAIN) return this.applyBrainEx(ev, live);
    if (k === K_LANG) return this.applyLangTxt(ev, live);
    if (k === K_REPL) {
      const d = tag(ev, 'd');
      if (d === D_BRAIN) return this.applyBrainCkpt(ev, live);
      if (d === D_LANG) return this.applyLangCkpt(ev, live);
      if (d === badges.D_BADGES) return this.applyBadges(ev, live);
      if (d === D_PROFILE) {
        this.bcache = null;
        const uid = this.applyProfile(ev);
        if (uid && live) this.pushUser(uid);
      } else if (d === D_STATE && ev.pubkey === this.k.pub) {
        await this.applyState(ev, live);
      }
    } else if (k === K_DIRECT) {
      const author = ev.pubkey;
      let other;
      if (author === this.k.pub) other = tag(ev, 'p');
      else {
        other = author;
        if (tag(ev, 'p') !== this.k.pub) return;
      }
      if (!other || other.length !== 64) return;
      let pl;
      try { pl = await dec(this.k.shared(other), ev.content); } catch (e) { return; }
      this.applyDirect(this.uid(author), this.uid(other), pl, live);
    } else if (k === K_GROUP) {
      const gid = tag(ev, 'g'), ver = tag(ev, 'v');
      const [, key] = this.gkey(gid, ver);
      if (!key) { this.x('INSERT OR IGNORE INTO stash VALUES(?,?,?,?)', ev.id, gid, ev.created_at, JSON.stringify(ev)); return; }
      let pl;
      try { pl = await dec(key, ev.content); } catch (e) { return; }
      const c = this.q1('SELECT * FROM chats WHERE ckey=?', 'g:' + gid);
      if (!c) return;
      const author = this.uid(ev.pubkey);
      if (this.blocked(author)) return;
      this.applyChatOp(c.id, author, pl, live);
    } else if (k === K_EPH || k === K_GEPH) {
      if (now() - ev.created_at > 60 || ev.pubkey === this.k.pub) return;
      const author = this.uid(ev.pubkey);
      if (this.blocked(author)) return;
      let pl, cid = null;
      try {
        if (k === K_EPH) {
          const r = JSON.parse(ev.content).r[this.k.pub.slice(0, 16)];
          if (!r) return;
          pl = await dec(this.k.shared(ev.pubkey), r);
        } else {
          const [, key] = this.gkey(tag(ev, 'g'), tag(ev, 'v'));
          if (!key) return;
          pl = await dec(key, ev.content);
          const c = this.q1('SELECT id FROM chats WHERE ckey=? AND left=0', 'g:' + tag(ev, 'g'));
          if (!c) return;
          cid = c.id;
        }
      } catch (e) { return; }
      fire(this.applyEph(author, pl, cid));
    }
  }

  // ------------------------------------------------------------------ community brains (kept in IndexedDB: big)
  async applyBrainEx(ev, live) {
    let p, label, pxLen;
    try {
      p = JSON.parse(ev.content);
      label = String(p.label).replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 16);
      pxLen = unb64(p.px).length;
      if (!label || (pxLen !== 400 && pxLen !== 3072)) return;
    } catch (e) { return; }
    if (await idb.has('brain_ex', ev.id)) return;
    const ex = { id: ev.id, author: ev.pubkey, name: String(p.name || '').slice(0, 32), label, px: p.px, created: ev.created_at };
    await idb.put('brain_ex', ev.id, ex);
    if (live) this.emit({ t: 'brain_ex', ex });
  }
  async applyBrainCkpt(ev, live) {
    const cur = await idb.get('brain_ckpt', ev.pubkey);
    if ((cur && cur.created >= ev.created_at) || ev.content.length > 200000) return;
    await idb.put('brain_ckpt', ev.pubkey, { author: ev.pubkey, created: ev.created_at, content: ev.content });
    if (live && ev.pubkey !== this.k.pub) this.emit({ t: 'brain_ckpt', author: ev.pubkey, created: ev.created_at, content: ev.content });
  }
  async on_brain_load() {
    const ex = (await idb.all('brain_ex')).sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1));
    const all = await idb.all('brain_ckpt');
    const mine = all.find((c) => c.author === this.k.pub);
    return { examples: ex, ckpts: all.filter((c) => c.author !== this.k.pub), mine: mine ? mine.content : null, me: this.k.pub };
  }
  async on_brain_feed(d) {
    const label = String(d.label || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 16);
    let n = 0;
    try { n = unb64(d.px || '').length; } catch (e) {}
    if (!label || (n !== 400 && n !== 3072)) throw new Err('Draw something and give it a name');
    const ev = this.k.sign(K_BRAIN, [['t', 'lobby-brain']], JSON.stringify({ label, px: d.px, name: this.name(this.me) }));
    await this.applyBrainEx(ev, true);
    this.pool.publish(ev);
    return true;
  }
  async on_brain_publish(d) {
    const content = String(d.content || '');
    if (content.length > 120000) throw new Err('checkpoint too big');
    const ev = this.k.sign(K_REPL, [['d', D_BRAIN], ['t', 'lobby-brain']], content);
    await idb.put('brain_ckpt', this.k.pub, { author: this.k.pub, created: ev.created_at, content });
    this.pool.publish(ev);
    return true;
  }
  async applyLangTxt(ev, live) {
    let p, text;
    try { p = JSON.parse(ev.content); text = String(p.t); } catch (e) { return; }
    if (!text.trim() || text.length > LANG_CHUNK_MAX) return;
    if (await idb.has('lang_txt', ev.id)) return;
    const chunk = { id: ev.id, author: ev.pubkey, name: String(p.name || '').slice(0, 32), doc: String(p.doc || '').slice(0, 80), text, created: ev.created_at };
    await idb.put('lang_txt', ev.id, chunk);
    if (live) this.emit({ t: 'lang_txt', chunk });
  }
  async applyLangCkpt(ev, live) {
    const cur = await idb.get('lang_ckpt', ev.pubkey);
    if ((cur && cur.created >= ev.created_at) || ev.content.length > 200000) return;
    await idb.put('lang_ckpt', ev.pubkey, { author: ev.pubkey, created: ev.created_at, content: ev.content });
    if (live && ev.pubkey !== this.k.pub) this.emit({ t: 'lang_ckpt', author: ev.pubkey, created: ev.created_at, content: ev.content });
  }
  async on_lang_load() {
    const chunks = (await idb.all('lang_txt')).sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1));
    const all = await idb.all('lang_ckpt');
    const mine = all.find((c) => c.author === this.k.pub);
    return { chunks, ckpts: all.filter((c) => c.author !== this.k.pub), mine: mine ? mine.content : null, me: this.k.pub };
  }
  async on_lang_feed(d) {
    const text = String(d.text || '');
    if (!text.trim() || text.length > LANG_CHUNK_MAX) throw new Err('empty or too long text chunk');
    const ev = this.k.sign(K_LANG, [['t', 'lobby-lang']], JSON.stringify({ t: text, doc: String(d.doc || '').slice(0, 80), name: this.name(this.me) }));
    await this.applyLangTxt(ev, true);
    this.pool.publish(ev);
    return true;
  }
  async on_lang_publish(d) {
    const content = String(d.content || '');
    if (content.length > 120000) throw new Err('checkpoint too big');
    const ev = this.k.sign(K_REPL, [['d', D_LANG], ['t', 'lobby-lang']], content);
    await idb.put('lang_ckpt', this.k.pub, { author: this.k.pub, created: ev.created_at, content });
    this.pool.publish(ev);
    return true;
  }

  async processStash(gid = null) {
    const rows = gid ? this.q('SELECT * FROM stash WHERE gid=? ORDER BY created', gid) : this.q('SELECT * FROM stash ORDER BY created');
    for (const r of rows) {
      const ev = JSON.parse(r.raw);
      if (this.gkey(r.gid, tag(ev, 'v'))[1]) {
        this.x('DELETE FROM stash WHERE id=?', r.id);
        await this.process(ev, !this.syncing);
      }
    }
  }

  applyProfile(ev) {
    let p;
    try { p = JSON.parse(ev.content); } catch (e) { return null; }
    if (!p || typeof p !== 'object') return null;
    this.bcache = null;
    const uid = this.uid(ev.pubkey);
    const u = this.q1('SELECT profile_ts FROM users WHERE id=?', uid);
    if (u.profile_ts && ev.created_at < u.profile_ts) return null;
    const col = /^#[0-9a-fA-F]{6}$/.test(String(p.color || '')) ? p.color : '#d9a441';
    let pic = String(p.pic || '');
    pic = pic.length <= 48000 && /^[A-Za-z0-9+/=]*$/.test(pic) ? pic : '';
    let picUrl = String(p.pic_url || '');
    picUrl = picUrl.startsWith('https://') && picUrl.length < 400 ? picUrl : '';
    this.x('UPDATE users SET username=?, display=?, avatar=?, color=?, bio=?, status_msg=?, reg=?, profile_ts=?, pic=?, pic_url=? WHERE id=?',
      cleanStr(p.username, 20), cleanStr(p.display, 32) || cleanStr(p.username, 20), cleanStr(p.avatar, 16), col, cleanStr(p.bio, 500),
      cleanStr(p.status_msg, 120), parseFloat(p.reg || 0) || 0, ev.created_at, pic, picUrl, uid);
    return uid;
  }
  async applyState(ev, live) {
    let st;
    try { st = await dec(this.k.selfKey, ev.content); } catch (e) { return; }
    for (const [pub, r] of Object.entries(st.rels || {})) {
      if (!isHex64(pub)) continue;
      const uid = this.uid(pub);
      const cur = this.rel(uid);
      if (cur && cur.ts >= (r.ts || 0)) continue;
      if (r.state === null || r.state === undefined) this.x('DELETE FROM relations WHERE user_id=?', uid);
      else {
        this.x('INSERT OR REPLACE INTO relations(user_id, state, trusted, nickname, note, since, trusts_me, ts) ' +
          'VALUES(?,?,?,?,?,?,COALESCE((SELECT trusts_me FROM relations WHERE user_id=?),0),?)',
        uid, r.state, r.trusted || 0, r.nickname || '', r.note || '', r.since ?? null, uid, r.ts || 0);
      }
      if (live) this.pushRel(uid);
    }
    for (const [ckey, c] of Object.entries(st.chats || {})) {
      const row = this.q1('SELECT * FROM chats WHERE ckey=?', ckey);
      if (row && row.prefs_ts < (c.ts || 0)) {
        this.x('UPDATE chats SET muted=?, pinned=?, archived=?, last_read=MAX(last_read, ?), prefs_ts=? WHERE id=?',
          c.muted || 0, c.pinned || 0, c.archived || 0, c.last_read || 0, c.ts || 0, row.id);
        if (live) this.pushChat(row.id);
      }
    }
    if ((st.privacy_ts || 0) > this.kv('privacy_ts', 0)) {
      this.setKv('privacy', st.privacy || {});
      this.setKv('privacy_ts', st.privacy_ts);
      if (live) this.pushUser(this.me);
    }
  }

  // ------------------------------------------------------------------ admins & badges
  bstate() {
    if (this.bcache) return this.bcache;
    const evs = {};
    for (const r of this.q('SELECT pubkey, body FROM badge_ev')) {
      try { evs[r.pubkey] = badges.cleanBody(JSON.parse(r.body)); } catch (e) {}
    }
    let root = badges.HEX64.test((badges.ADMIN_PUBKEY || '').toLowerCase()) ? badges.ADMIN_PUBKEY.toLowerCase() : '';
    if (!root) root = this.kv('admin_pin', '') || '';
    if (!root) {
      const r = this.q1('SELECT pubkey FROM users WHERE lower(username)=? AND pubkey LIKE ? ORDER BY CASE WHEN reg>0 THEN reg ELSE 9e18 END LIMIT 1',
        badges.ADMIN_USERNAME.toLowerCase(), badges.ADMIN_CODE.toLowerCase() + '%');
      if (r) { root = r.pubkey; this.setKv('admin_pin', root); }
    }
    this.bcache = [root, badges.trustedAdmins(root, evs), evs];
    return this.bcache;
  }
  badgesOf(pub) { const [root, admins, evs] = this.bstate(); return badges.badgesOf(pub, root, admins, evs); }
  roleOf(pub) { const [root, admins] = this.bstate(); return root && pub === root ? 'owner' : admins.has(pub) ? 'admin' : ''; }
  applyBadges(ev, live) {
    let body;
    try { body = JSON.parse(ev.content); } catch (e) { return; }
    const cur = this.q1('SELECT created FROM badge_ev WHERE pubkey=?', ev.pubkey);
    if ((cur && cur.created >= ev.created_at) || ev.content.length > 120000) return;
    this.x('INSERT OR REPLACE INTO badge_ev VALUES(?,?,?)', ev.pubkey, ev.created_at, JSON.stringify(badges.cleanBody(body)));
    this.bcache = null;
    if (live) for (const r of this.q('SELECT id FROM users')) this.pushUser(r.id);
  }
  myBadgeBody() {
    const r = this.q1('SELECT body FROM badge_ev WHERE pubkey=?', this.k.pub);
    return r ? badges.cleanBody(JSON.parse(r.body)) : { admins: [], grants: {}, custom: {} };
  }
  needAdmin(owner = false) {
    const role = this.roleOf(this.k.pub);
    if (!role || (owner && role !== 'owner')) throw new Err(owner ? 'Only the owner can do that' : 'Only admins can do that');
  }
  async saveBadgeBody(body) {
    const cur = this.q1('SELECT created FROM badge_ev WHERE pubkey=?', this.k.pub);
    const ev = this.k.sign(K_REPL, [['d', badges.D_BADGES], ['t', 'lobby-badges']], JSON.stringify(body), Math.max(now(), (cur ? cur.created : 0) + 1));
    this.applyBadges(ev, true);
    this.pool.publish(ev);
  }
  async on_badge_state() {
    const [root, admins, evs] = this.bstate();
    const mine = this.myBadgeBody();
    const cat = badges.catalog(admins, evs);
    const r = this.q1("SELECT id FROM users WHERE reg>0 AND username!='' ORDER BY reg ASC LIMIT 1");
    return { role: this.roleOf(this.k.pub), catalog: Object.values(cat).map((b) => ({ ...badges.badgeView(b), auto: !!b.auto, custom: !!b.custom })),
      my_grants: mine.grants, admins: [...admins].filter((a) => a !== root).sort(), owner: root, my_pub: this.k.pub, earliest: r ? r.id : null };
  }
  async on_badge_grant(d) {
    this.needAdmin();
    const pub = this.pub(parseInt(d.user_id, 10));
    const bid = String(d.badge);
    const [, admins, evs] = this.bstate();
    const cat = badges.catalog(admins, evs);
    if (!(bid in cat) || cat[bid].auto) throw new Err('Unknown badge');
    const body = this.myBadgeBody();
    const ids = (body.grants[pub] || []).filter((i) => i !== bid);
    if (d.on) ids.push(bid);
    if (ids.length) body.grants[pub] = ids; else delete body.grants[pub];
    await this.saveBadgeBody(body);
    return this.userPub(parseInt(d.user_id, 10));
  }
  async on_badge_make(d) {
    this.needAdmin();
    const body = this.myBadgeBody();
    if (Object.keys(body.custom).length >= badges.MAX_CUSTOM) throw new Err('Too many custom badges');
    const name = String(d.name || '').trim().slice(0, 24);
    if (!name) throw new Err('Give the badge a name');
    const bid = 'c_' + hex(randBytes(3));
    body.custom[bid] = { name, emoji: String(d.emoji || '🏅').trim().slice(0, 8) || '🏅', color: badges.cleanColor(d.color), desc: String(d.desc || '').slice(0, 80) };
    await this.saveBadgeBody(badges.cleanBody(body));
    return bid;
  }
  async on_badge_delete(d) {
    this.needAdmin();
    const body = this.myBadgeBody();
    const bid = String(d.badge);
    delete body.custom[bid];
    for (const pub of Object.keys(body.grants)) {
      body.grants[pub] = body.grants[pub].filter((i) => i !== bid);
      if (!body.grants[pub].length) delete body.grants[pub];
    }
    await this.saveBadgeBody(body);
    return true;
  }
  async on_badge_admin(d) {
    this.needAdmin(true);
    const pub = this.pub(parseInt(d.user_id, 10));
    if (pub === this.k.pub) throw new Err("You're already the owner");
    const body = this.myBadgeBody();
    body.admins = body.admins.filter((a) => a !== pub);
    if (d.on) body.admins.push(pub);
    await this.saveBadgeBody(body);
    return this.userPub(parseInt(d.user_id, 10));
  }

  // ------------------------------------------------------------------ direct (1:1) payloads
  async fetchProfile(uid) {
    const evs = await this.pool.query([{ kinds: [K_REPL], authors: [this.pub(uid)], '#d': [D_PROFILE] }], 4000);
    if (evs.length) {
      this.applyProfile(evs.sort((a, b) => b.created_at - a.created_at)[0]);
      this.pushUser(uid);
      if (this.rel(uid)) this.pushRel(uid);
    }
  }
  applyDirect(author, other, pl, live) {
    const t = pl.type;
    if (live && !this.q1('SELECT username FROM users WHERE id=?', other).username) fire(this.fetchProfile(other));
    const ts = (pl.ms || 0) / 1000;
    const mine = author === this.me;
    if (this.blocked(other) && !mine) return;
    const r = this.rel(other);
    if (['friend_request', 'friend_accept', 'friend_remove', 'trust'].includes(t)) {
      if (r && r.ts >= ts && t !== 'trust') return;
      const st = r ? r.state : null;
      if (t === 'friend_request') {
        let nw;
        if (mine) nw = st === 'in' ? 'friend' : (st !== 'friend' && st !== 'blocked' ? 'out' : st);
        else {
          if (st === 'blocked') return;
          nw = st === 'out' || st === 'friend' ? 'friend' : 'in';
        }
        this.setRel(other, nw, ts);
        if (nw === 'friend' && !mine && st === 'out' && live) fire(this.sendDirect(other, { type: 'friend_accept' }));
      } else if (t === 'friend_accept') {
        if ((mine && st === 'in') || (!mine && st === 'out') || st === 'friend') this.setRel(other, 'friend', ts);
      } else if (t === 'friend_remove') {
        if (st !== 'blocked') this.x('DELETE FROM relations WHERE user_id=?', other);
      } else if (t === 'trust') {
        if (mine) this.x('UPDATE relations SET trusted=? WHERE user_id=?', pl.on ? 1 : 0, other);
        else this.x('UPDATE relations SET trusts_me=? WHERE user_id=?', pl.on ? 1 : 0, other);
      }
      if (live) {
        this.pushRel(other);
        if (t === 'friend_request' || t === 'friend_accept') {
          this.resubscribe();
          fire(this.sendPresence([other]));
        }
      }
      return;
    }
    if (t === 'group_invite') return this.applyInvite(author, pl, live);
    if (t === 'group_rekey') {
      if (author !== this.me && !this.q1('SELECT 1 FROM chats WHERE ckey=?', 'g:' + (pl.gid || ''))) return;
      this.x('INSERT OR IGNORE INTO gkeys VALUES(?,?,?)', pl.gid, parseInt(pl.ver, 10), pl.key);
      if (live) fire(this.processStash(pl.gid));
      return;
    }
    if (!mine && !(r && r.state === 'friend') && !this.q1('SELECT 1 FROM chats WHERE ckey=?', 'dm:' + this.pub(other))) return;
    const cid = this.dmChat(other, true);
    this.applyChatOp(cid, author, pl, live);
  }
  setRel(uid, state, ts) {
    const r = this.rel(uid);
    if (r) {
      this.x('UPDATE relations SET state=?, ts=?, since=COALESCE(since, ?) WHERE user_id=?', state, ts, ts, uid);
      if (state === 'friend' && r.state !== 'friend') this.x('UPDATE relations SET since=? WHERE user_id=?', ts, uid);
    } else {
      this.x('INSERT INTO relations(user_id, state, since, ts) VALUES(?,?,?,?)', uid, state, ts, ts);
    }
  }
  dmChat(other, create = false) {
    const key = 'dm:' + this.pub(other);
    const c = this.q1('SELECT id, left FROM chats WHERE ckey=?', key);
    if (c) {
      if (c.left) this.x('UPDATE chats SET left=0 WHERE id=?', c.id);
      return c.id;
    }
    if (!create) return null;
    return this.x("INSERT INTO chats(kind, ckey, created, created_by) VALUES('dm',?,?,?)", key, now(), this.me);
  }
  applyInvite(author, pl, live) {
    const gid = pl.gid;
    if (!gid || !/^[0-9a-f]{32}$/.test(gid)) return;
    if (author !== this.me) {
      if (!this.isFriend(author)) return;
      if (this.privacy().group_invites === 'trusted' && !this.trusted(author)) return;
    }
    for (const [ver, key] of Object.entries(pl.keys || {})) this.x('INSERT OR IGNORE INTO gkeys VALUES(?,?,?)', gid, parseInt(ver, 10), key);
    const members = pl.members || {};
    if (!(this.k.pub in members)) return;
    const c = this.q1('SELECT * FROM chats WHERE ckey=?', 'g:' + gid);
    const ts = (pl.ms || 0) / 1000;
    if (c && c.joined_ts >= ts) return;
    let cid;
    if (c) {
      cid = c.id;
      this.x('UPDATE chats SET left=0, joined_ts=?, name=?, icon=?, topic=? WHERE id=?', ts, cleanStr(pl.name, 48), cleanStr(pl.icon, 16), cleanStr(pl.topic, 200), cid);
    } else {
      let creator;
      try { creator = this.uid(isHex64(pl.created_by) ? pl.created_by : this.pub(author)); } catch (e) { creator = author; }
      cid = this.x("INSERT INTO chats(kind, ckey, name, icon, topic, created_by, created, joined_ts) VALUES('group',?,?,?,?,?,?,?)",
        'g:' + gid, cleanStr(pl.name || 'Group', 48), cleanStr(pl.icon, 16), cleanStr(pl.topic, 200), creator, pl.created ?? ts, ts);
    }
    this.x('DELETE FROM members WHERE chat_id=?', cid);
    for (const [pub, role] of Object.entries(members)) {
      if (isHex64(pub)) this.x('INSERT OR REPLACE INTO members VALUES(?,?,?,?)', cid, this.uid(pub), role, ts);
    }
    if (pl.pic !== undefined) {
      const pic = String(pl.pic || ''), url = String(pl.pic_url || '');
      this.x('UPDATE chats SET pic=?, pic_url=? WHERE id=?', pic.length <= 48000 ? pic : '', url.startsWith('https://') ? url : '', cid);
    }
    if (live) {
      fire((async () => {
        this.resubscribe();
        await this.processStash(gid);
        await this.fetchGroupHistory(gid);
        this.pushChat(cid);
      })());
    }
  }

  // ------------------------------------------------------------------ chat ops (DM or group)
  applyChatOp(cid, author, pl, live) {
    const t = pl.type;
    const ts = (pl.ms || 0) / 1000;
    if (t === 'msg') {
      const mid = parseInt(pl.mid || 0, 10);
      if (!mid || this.q1('SELECT 1 FROM messages WHERE id=?', mid)) return;
      let kind = pl.kind || 'text';
      if (!['text', 'image', 'file', 'voice', 'poll', 'system', 'call', 'nudge'].includes(kind)) kind = 'text';
      const file = pl.file && typeof pl.file === 'object' ? pl.file : null;
      let fid = null;
      if (file) fid = sha256hex(te.encode(String(file.url || file.inline || (Array.isArray(file.parts) ? file.parts[0] || '' : '')).slice(0, 4096) + String(file.k || ''))).slice(0, 32);
      const created = Math.floor(mid / 4096) / 1000;
      const shown = created <= now() + 5 ? 1 : 0;
      const reply = pl.reply_to;
      this.x('INSERT INTO messages(id, chat_id, sender, kind, body, reply_to, created, file, fid, silent, shown) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        mid, cid, author, kind, String(pl.body ?? '').slice(0, 8000), reply ? parseInt(reply, 10) : null, created,
        file ? JSON.stringify(file) : null, fid, pl.silent ? 1 : 0, shown);
      if (kind === 'poll' && pl.poll) {
        const opts = (pl.poll.options || []).map((o) => String(o).slice(0, 100)).slice(0, 10);
        this.x('INSERT OR IGNORE INTO polls VALUES(?,?,?)', mid, JSON.stringify(opts), pl.poll.multi ? 1 : 0);
      }
      if (author === this.me) this.x('UPDATE chats SET last_read=MAX(last_read, ?) WHERE id=?', mid, cid);
      if (live && shown) {
        this.x('UPDATE chats SET archived=0 WHERE id=? AND muted=0', cid);
        if (!this.chatView(cid)) return;
        this.pushChatIfNew(cid);
        this.emit({ t: 'message', msg: this.msgView(this.q1('SELECT * FROM messages WHERE id=?', mid)) });
      }
      return;
    }
    const mid = parseInt(pl.mid || 0, 10) || 0;
    if (t === 'edit') {
      const cur = this.q1('SELECT ts FROM edits WHERE msg_id=?', mid);
      if (!cur || cur.ts < ts) this.x('INSERT OR REPLACE INTO edits VALUES(?,?,?,?)', mid, author, String(pl.body ?? '').slice(0, 8000), ts);
    } else if (t === 'delete') {
      this.x('INSERT OR REPLACE INTO deletes VALUES(?,?,?)', mid, author, ts);
    } else if (t === 'react') {
      const e = String(pl.emoji || '').slice(0, 16);
      const cur = this.q1('SELECT ts FROM reactions WHERE msg_id=? AND user_id=? AND emoji=?', mid, author, e);
      if (!cur || cur.ts < ts) this.x('INSERT OR REPLACE INTO reactions VALUES(?,?,?,?,?)', mid, author, e, pl.on ? 1 : 0, ts);
    } else if (t === 'vote') {
      const cur = this.q1('SELECT ts FROM votes WHERE msg_id=? AND user_id=?', mid, author);
      if (!cur || cur.ts < ts) this.x('INSERT OR REPLACE INTO votes VALUES(?,?,?,?)', mid, author, JSON.stringify((pl.opts || []).map((o) => parseInt(o, 10)).slice(0, 10)), ts);
    } else if (t === 'pin') {
      const cur = this.q1('SELECT ts FROM pins WHERE chat_id=? AND msg_id=?', cid, mid);
      if (!cur || cur.ts < ts) this.x('INSERT OR REPLACE INTO pins VALUES(?,?,?,?,?)', cid, mid, author, pl.on ? 1 : 0, ts);
      if (live) this.pushChat(cid);
      return;
    } else if (t === 'read') {
      const r = this.q1('SELECT msg_id FROM reads WHERE chat_id=? AND user_id=?', cid, author);
      if (!r || r.msg_id < mid) {
        this.x('INSERT OR REPLACE INTO reads VALUES(?,?,?)', cid, author, mid);
        if (author === this.me) this.x('UPDATE chats SET last_read=MAX(last_read, ?) WHERE id=?', mid, cid);
        if (live) this.emit({ t: 'read', chat_id: cid, user_id: author, msg_id: mid });
      }
      return;
    } else if (t === 'meta') {
      return this.applyMeta(cid, author, pl, live);
    } else {
      return;
    }
    if (live) {
      const m = this.q1('SELECT * FROM messages WHERE id=? AND chat_id=?', mid, cid);
      if (m && m.shown) this.emit({ t: 'message_update', msg: this.msgView(m) });
    }
  }
  pushChatIfNew(cid) {
    if (!this.kv('announced:' + cid)) { this.setKv('announced:' + cid, true); this.pushChat(cid); }
  }
  applyMeta(cid, author, pl, live) {
    const op = pl.op;
    const role = this.role(cid, author);
    const admin = role === 'owner' || role === 'admin';
    const tgt = isHex64(pl.pub) ? this.uid(pl.pub) : null;
    const t = (pl.ms || 0) / 1000;
    if (op === 'update' && admin) {
      for (const [k, n] of [['name', 48], ['icon', 16], ['topic', 200]]) if (k in pl) this.x(`UPDATE chats SET ${k}=? WHERE id=?`, String(pl[k]).slice(0, n), cid);
      if ('pic' in pl) {
        const pic = String(pl.pic || ''), url = String(pl.pic_url || '');
        this.x('UPDATE chats SET pic=?, pic_url=? WHERE id=?', pic.length <= 48000 ? pic : '', url.startsWith('https://') && url.length < 400 ? url : '', cid);
      }
    } else if (op === 'add' && admin && tgt) {
      this.x("INSERT OR IGNORE INTO members VALUES(?,?,?,?)", cid, tgt, 'member', t);
    } else if (op === 'kick' && admin && tgt && this.role(cid, tgt) !== 'owner') {
      this.x('DELETE FROM members WHERE chat_id=? AND user_id=?', cid, tgt);
      if (tgt === this.me) {
        this.x('UPDATE chats SET left=1, joined_ts=? WHERE id=?', t, cid);
        if (live) this.emit({ t: 'chat_removed', chat_id: cid });
        return;
      }
    } else if (op === 'role' && role === 'owner' && tgt && ['owner', 'admin', 'member'].includes(pl.role)) {
      if (pl.role === 'owner') this.x("UPDATE members SET role='admin' WHERE chat_id=? AND user_id=?", cid, author);
      this.x('UPDATE members SET role=? WHERE chat_id=? AND user_id=?', pl.role, cid, tgt);
    } else if (op === 'leave') {
      this.x('DELETE FROM members WHERE chat_id=? AND user_id=?', cid, author);
      if (author === this.me) {
        this.x('UPDATE chats SET left=1, joined_ts=? WHERE id=?', t, cid);
        if (live) this.emit({ t: 'chat_removed', chat_id: cid });
        return;
      }
      if (role === 'owner') {
        const nxt = this.q1("SELECT user_id FROM members WHERE chat_id=? ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, user_id LIMIT 1", cid);
        if (nxt) this.x("UPDATE members SET role='owner' WHERE chat_id=? AND user_id=?", cid, nxt.user_id);
      }
      if (live && this.role(cid, this.me) === 'owner') fire(this.rekey(cid));
    }
    if (live) this.pushChat(cid);
  }
  async rekey(cid) {
    const c = this.chat(cid);
    const gid = c.ckey.slice(2);
    const ver = ms(), key = b64(randBytes(32));
    this.x('INSERT OR IGNORE INTO gkeys VALUES(?,?,?)', gid, ver, key);
    for (const u of this.chatMembers(cid)) await this.sendDirect(u, { type: 'group_rekey', gid, ver, key });
  }

  // ------------------------------------------------------------------ ephemeral
  async applyEph(author, pl, cid) {
    const t = pl.type;
    if (t === 'presence') {
      if (!this.isFriend(author) && !this.q1('SELECT 1 FROM members WHERE user_id=?', author)) return;
      const was = this.presenceOf(author);
      const p = pl.p || 'online';
      if (p === 'offline') {
        this.x("UPDATE users SET hb=?, presence='offline', show_ls=? WHERE id=?", now() - ONLINE_WINDOW - 1, pl.ls !== false ? 1 : 0, author);
      } else {
        this.x('UPDATE users SET hb=?, presence=?, show_ls=? WHERE id=?', now(), ['online', 'idle', 'dnd', 'invisible'].includes(p) ? p : 'online',
          pl.ls !== false ? 1 : 0, author);
      }
      if (pl.hi && now() - (this.hbReplied.get(author) || 0) > 20) {
        this.hbReplied.set(author, now());
        await this.sendPresence([author]);
      }
      if (this.presenceOf(author) !== was || pl.hi) this.pushUser(author);
    } else if (t === 'status_seen' && !cid) {
      const sid = String(pl.id || '').slice(0, 64);
      if (this.q1('SELECT 1 FROM statuses WHERE id=? AND author=?', sid, this.me)) {
        this.x('INSERT OR IGNORE INTO status_views VALUES(?,?,?)', sid, author, now());
        this.emit({ t: 'status_views', id: sid, views: this.statusViews(sid) });
      }
    } else if (t === 'typing') {
      const c = cid || this.dmChat(author);
      if (c) this.emit({ t: 'typing', chat_id: c, user_id: author });
    } else if (t === 'nudge') {
      const c = cid || this.dmChat(author);
      if (c) this.emit({ t: 'nudge', chat_id: c, from: author });
    } else if ((t && t.startsWith('call_')) || t === 'rtc_offer' || t === 'rtc_answer') {
      await this.applyCallSignal(author, pl, cid);
    }
  }

  // ------------------------------------------------------------------ presence & loops
  async sendPresence(only = null, offline = false, reply = false) {
    const priv = this.privacy();
    const p = offline ? 'offline' : this.presenceOf(this.me);
    const targets = only || this.friendUids();
    const payload = (u) => {
      const ls = priv.last_seen === 'friends' || (priv.last_seen === 'trusted' && this.trusted(u));
      if (p === 'invisible') {
        if (!this.trusted(u)) return offline ? { type: 'presence', p: 'offline', ls } : null;
        return { type: 'presence', p: 'invisible', ls, hi: reply };
      }
      return { type: 'presence', p, ls, hi: reply };
    };
    await this.sendEph(targets, null, payload);
  }
  async presenceTick() {
    this._pt = (this._pt || 0) + 1;
    if (this._pt % 3 === 0) await this.sendPresence();
    for (const r of this.q("SELECT id FROM users WHERE hb>? AND hb<? AND presence!='offline'", now() - ONLINE_WINDOW - 16, now() - ONLINE_WINDOW)) this.pushUser(r.id);
    if (this.stateDirty) { this.stateDirty = false; await this.publishState(); }
  }
  async housekeepingTick() {
    this.hkN = (this.hkN || 0) + 1;
    if (this.hkN % 20 === 1) {                    // statuses vanish after 24 h
      const gone = this.q('SELECT id FROM statuses WHERE expires<?', Math.floor(now())).map((r) => r.id);
      if (gone.length) {
        for (const i of gone) this.x('DELETE FROM status_views WHERE status_id=?', i);
        this.x('DELETE FROM statuses WHERE expires<?', Math.floor(now()));
        this.emit({ t: 'status_removed', ids: gone });
      }
    }
    for (const m of this.q('SELECT * FROM messages WHERE shown=0 AND created<=?', now())) {
      this.x('UPDATE messages SET shown=1 WHERE id=?', m.id);
      if (!this.q1('SELECT 1 FROM deletes WHERE msg_id=?', m.id)) this.emit({ t: 'message', msg: this.msgView({ ...m, shown: 1 }) });
    }
    for (const [cid, mid] of [...this.readPending]) {
      this.readPending.delete(cid);
      try { if (this.privacy().read_receipts) await this.sendChat(cid, { type: 'read', mid }); } catch (e) {}
    }
  }

  // ------------------------------------------------------------------ request handlers (same API as PC)
  async handle(t, d) {
    const h = this['on_' + t];
    if (typeof h !== 'function') throw new Err('Not available in P2P mode');
    return h.call(this, d || {});
  }
  async on_update_profile(d) {
    const fields = {};
    if ('display' in d) {
      const v = String(d.display).trim().slice(0, 32);
      if (!v) throw new Err("Display name can't be empty");
      fields.display = v;
    }
    for (const [k, n] of [['status_msg', 120], ['bio', 500], ['avatar', 16]]) if (k in d) fields[k] = String(d[k]).slice(0, n);
    if ('color' in d && /^#[0-9a-fA-F]{6}$/.test(String(d.color))) fields.color = d.color;
    for (const [k, v] of Object.entries(fields)) this.x(`UPDATE users SET ${k}=? WHERE id=?`, v, this.me);
    if (Object.keys(fields).length) await this.publishProfile();
    if (d.privacy && typeof d.privacy === 'object') {
      const p = this.privacy();
      for (const [k, v] of Object.entries(d.privacy)) if (k in DEFAULT_PRIVACY && typeof v === typeof DEFAULT_PRIVACY[k]) p[k] = v;
      this.setKv('privacy', p);
      this.setKv('privacy_ts', now());
      this.markState();
      if ('presence' in d.privacy) await this.sendPresence();
    }
    this.pushUser(this.me);
    return this.userPub(this.me);
  }
  async on_set_avatar(d) {
    if (d.kind === 'none') this.x("UPDATE users SET pic='', pic_url='' WHERE id=?", this.me);
    else {
      const still = String(d.still || '');
      if (!still || still.length > 48000) throw new Err('Picture is too big');
      let url = '';
      if (d.kind === 'gif') {
        const raw = unb64(d.data || '');
        if (raw.length > 3 * 1024 * 1024) throw new Err('GIF is too big for a profile picture (max 3 MB after shrinking)');
        url = await this.upload(raw);
      }
      this.x('UPDATE users SET pic=?, pic_url=? WHERE id=?', still, url, this.me);
    }
    await this.publishProfile();
    this.pushUser(this.me);
    return this.userPub(this.me);
  }
  async on_activity(d) {
    const was = this.presenceOf(this.me);
    this.idle = !!d.idle;
    if (this.presenceOf(this.me) !== was) { this.pushUser(this.me); await this.sendPresence(); }
  }
  async on_logout() { return true; }
  async findUser(text) {
    text = String(text).trim().replace(/^@+/, '');
    const i = text.indexOf('#');
    const name = i >= 0 ? text.slice(0, i) : text, code = i >= 0 ? text.slice(i + 1) : '';
    if (!/^[A-Za-z0-9_.]{3,20}$/.test(name)) throw new Err('No user with that name');
    const evs = await this.pool.query([{ kinds: [K_REPL], '#d': [D_PROFILE], '#u': [name.toLowerCase()] }], 5000);
    const latest = {};
    for (const e of evs) if (!latest[e.pubkey] || latest[e.pubkey].created_at < e.created_at) latest[e.pubkey] = e;
    const cands = Object.entries(latest).filter(([p]) => !code || p.startsWith(code.toLowerCase())).map(([, e]) => e);
    if (!cands.length) {
      const r = this.q1('SELECT id FROM users WHERE lower(username)=? AND pubkey LIKE ?', name.toLowerCase(), (code.toLowerCase() || '') + '%');
      if (r) return r.id;
      throw new Err('No user with that name (they need to have opened Smult at least once)');
    }
    if (cands.length > 1) throw new Err(`Several people are called ${name} — ask for their friend code (like ${name}#ab12)`);
    return this.applyProfile(cands[0]) || this.uid(cands[0].pubkey);
  }
  async on_lookup(d) { return this.userPub(await this.findUser(d.username || '')); }
  async on_friend_request(d) {
    const other = await this.findUser(d.username || '');
    if (other === this.me) throw new Err("You can't add yourself (sadly)");
    const r = this.rel(other);
    if (r && r.state === 'friend') throw new Err("You're already friends");
    if (r && r.state === 'blocked') throw new Err('You blocked them — unblock first');
    if (r && r.state === 'in') return this.on_friend_respond({ user_id: other, accept: true });
    this.setRel(other, 'out', now());
    await this.sendDirect(other, { type: 'friend_request' });
    this.markState();
    this.pushRel(other);
    this.resubscribe();
    return true;
  }
  async on_friend_respond(d) {
    const other = parseInt(d.user_id, 10);
    const r = this.rel(other);
    if (!r || r.state !== 'in') throw new Err('No request from them');
    if (d.accept) {
      this.setRel(other, 'friend', now());
      await this.sendDirect(other, { type: 'friend_accept' });
      await this.sendPresence([other], false, true);
    } else {
      this.x('DELETE FROM relations WHERE user_id=?', other);
      await this.sendDirect(other, { type: 'friend_remove' });
    }
    this.markState();
    this.pushRel(other);
    return true;
  }
  async on_friend_remove(d) {
    const other = parseInt(d.user_id, 10);
    this.x("DELETE FROM relations WHERE user_id=? AND state!='blocked'", other);
    await this.sendDirect(other, { type: 'friend_remove' });
    this.markState();
    this.pushRel(other);
    return true;
  }
  async on_block(d) {
    const other = parseInt(d.user_id, 10);
    if (this.rel(other)) this.x("UPDATE relations SET state='blocked', trusted=0, ts=? WHERE user_id=?", now(), other);
    else this.x('INSERT INTO relations(user_id, state, since, ts) VALUES(?,?,?,?)', other, 'blocked', now(), now());
    await this.sendDirect(other, { type: 'friend_remove' });
    this.markState();
    this.pushRel(other);
    return true;
  }
  async on_unblock(d) {
    const other = parseInt(d.user_id, 10);
    this.x("DELETE FROM relations WHERE user_id=? AND state='blocked'", other);
    this.markState();
    this.pushRel(other);
    return true;
  }
  async on_set_trusted(d) {
    const other = parseInt(d.user_id, 10);
    if (!this.isFriend(other)) throw new Err('You can only trust friends');
    const on = !!d.trusted;
    this.x('UPDATE relations SET trusted=?, ts=? WHERE user_id=?', on ? 1 : 0, now(), other);
    await this.sendDirect(other, { type: 'trust', on });
    this.markState();
    this.pushRel(other);
    await this.sendPresence([other]);
    return true;
  }
  async on_set_nick(d) {
    const other = parseInt(d.user_id, 10);
    if (!this.rel(other)) throw new Err('Not in your friends list');
    if ('nickname' in d) this.x('UPDATE relations SET nickname=?, ts=? WHERE user_id=?', String(d.nickname).slice(0, 32), now(), other);
    if ('note' in d) this.x('UPDATE relations SET note=?, ts=? WHERE user_id=?', String(d.note).slice(0, 1000), now(), other);
    this.markState();
    this.pushRel(other);
    return true;
  }
  async on_open_dm(d) {
    const other = parseInt(d.user_id, 10);
    if (other !== this.me && !this.isFriend(other) && !this.dmChat(other)) throw new Err('You need to be friends first');
    const cid = this.dmChat(other, true);
    this.setKv('announced:' + cid, true);
    return this.chatView(cid);
  }
  async on_create_group(d) {
    const ids = new Set((d.members || []).map((x) => parseInt(x, 10)));
    ids.delete(this.me);
    for (const u of ids) if (!this.isFriend(u)) throw new Err('You can only add friends to groups');
    const gid = hex(randBytes(16));
    const ver = ms(), key = b64(randBytes(32));
    this.x('INSERT INTO gkeys VALUES(?,?,?)', gid, ver, key);
    const name = String(d.name || '').trim().slice(0, 48) || 'New group';
    const cid = this.x("INSERT INTO chats(kind, ckey, name, icon, topic, created_by, created, joined_ts) VALUES('group',?,?,?,?,?,?,?)",
      'g:' + gid, name, String(d.icon || '').slice(0, 16), String(d.topic || '').slice(0, 200), this.me, now(), now());
    this.x('INSERT INTO members VALUES(?,?,?,?)', cid, this.me, 'owner', now());
    for (const u of ids) this.x('INSERT INTO members VALUES(?,?,?,?)', cid, u, 'member', now());
    this.setKv('announced:' + cid, true);
    await this.inviteAll(cid, [...ids, this.me]);
    this.resubscribe();
    await this.postSystem(cid, `${this.name(this.me)} created the group`);
    return this.chatView(cid);
  }
  groupSnapshot(cid) {
    const c = this.chat(cid);
    const gid = c.ckey.slice(2);
    const keys = {};
    for (const r of this.q('SELECT ver, key FROM gkeys WHERE gid=?', gid)) keys[String(r.ver)] = r.key;
    const mem = {};
    for (const r of this.q('SELECT * FROM members WHERE chat_id=?', cid)) mem[this.pub(r.user_id)] = r.role;
    return { type: 'group_invite', gid, keys, members: mem, name: c.name, icon: c.icon, topic: c.topic, pic: c.pic || '', pic_url: c.pic_url || '',
      created_by: c.created_by ? this.pub(c.created_by) : this.k.pub, created: c.created };
  }
  async inviteAll(cid, uids) {
    const snap = this.groupSnapshot(cid);
    for (const u of uids) await this.sendDirect(u, { ...snap });
  }
  async postSystem(cid, text, kind = 'system') {
    const pl = { type: 'msg', mid: newMid(), kind, body: text };
    this.applyChatOp(cid, this.me, { ...pl }, true);
    await this.sendChat(cid, pl);
  }
  async on_group_update(d) {
    const cid = parseInt(d.chat_id, 10);
    if (!['owner', 'admin'].includes(this.role(cid, this.me))) throw new Err('Only group admins can do that');
    const pl = { type: 'meta', op: 'update' };
    for (const k of ['name', 'icon', 'topic']) if (k in d) pl[k] = String(d[k]);
    if ('pic' in d) {
      const pic = String(d.pic || '');
      if (pic.length > 48000) throw new Err('Picture is too big');
      pl.pic = pic; pl.pic_url = '';
      if (d.gif) {
        const raw = d.gif instanceof Uint8Array ? d.gif : unb64(d.gif);
        if (raw.length > 3 * 1024 * 1024) throw new Err('GIF is too big (max 3 MB after shrinking)');
        pl.pic_url = await this.upload(raw);
      }
    }
    this.applyMeta(cid, this.me, { ...pl }, true);
    await this.sendGroup(cid, pl);
    if ('name' in d) await this.postSystem(cid, `${this.name(this.me)} updated the group`);
    else if ('pic' in d) await this.postSystem(cid, d.pic ? `${this.name(this.me)} changed the group photo` : `${this.name(this.me)} removed the group photo`);
    return true;
  }
  async on_group_add(d) {
    const cid = parseInt(d.chat_id, 10), u = parseInt(d.user_id, 10);
    if (!['owner', 'admin'].includes(this.role(cid, this.me))) throw new Err('Only group admins can do that');
    if (this.role(cid, u)) throw new Err('Already in the group');
    if (!this.isFriend(u)) throw new Err('You can only add friends to groups');
    const pl = { type: 'meta', op: 'add', pub: this.pub(u) };
    this.applyMeta(cid, this.me, { ...pl, ms: ms() }, true);
    await this.sendGroup(cid, pl);
    await this.inviteAll(cid, [u]);
    await this.postSystem(cid, `${this.name(this.me)} added ${this.name(u)}`);
    return true;
  }
  async on_group_kick(d) {
    const cid = parseInt(d.chat_id, 10), u = parseInt(d.user_id, 10);
    const my = this.role(cid, this.me), their = this.role(cid, u);
    if (!['owner', 'admin'].includes(my) || their === 'owner' || (their === 'admin' && my !== 'owner')) throw new Err("You can't remove them");
    await this.postSystem(cid, `${this.name(this.me)} removed ${this.name(u)}`);
    const pl = { type: 'meta', op: 'kick', pub: this.pub(u) };
    await this.sendGroup(cid, pl);
    this.applyMeta(cid, this.me, { ...pl, ms: ms() }, true);
    await this.rekey(cid);
    return true;
  }
  async on_group_role(d) {
    const cid = parseInt(d.chat_id, 10), u = parseInt(d.user_id, 10), role = d.role;
    if (this.role(cid, this.me) !== 'owner') throw new Err('Only the owner can change roles');
    const pl = { type: 'meta', op: 'role', pub: this.pub(u), role };
    this.applyMeta(cid, this.me, { ...pl }, true);
    await this.sendGroup(cid, pl);
    await this.postSystem(cid, `${this.name(u)} is now ${role}`);
    return true;
  }
  async on_group_leave(d) {
    const cid = parseInt(d.chat_id, 10);
    const c = this.chat(cid);
    if (c.kind !== 'group') throw new Err("You can't leave a DM, archive it instead");
    await this.postSystem(cid, `${this.name(this.me)} left`);
    const pl = { type: 'meta', op: 'leave' };
    await this.sendGroup(cid, pl);
    this.applyMeta(cid, this.me, { ...pl, ms: ms() }, true);
    this.markState();
    return true;
  }
  async on_chat_prefs(d) {
    const cid = parseInt(d.chat_id, 10);
    this.chat(cid);
    for (const k of ['muted', 'pinned', 'archived']) if (k in d) this.x(`UPDATE chats SET ${k}=?, prefs_ts=? WHERE id=?`, d[k] ? 1 : 0, now(), cid);
    this.markState();
    this.pushChat(cid);
    return true;
  }
  checkCanSend(cid) {
    const c = this.chat(cid);
    if (c.kind === 'dm') {
      const o = this.dmOther(c);
      if (o !== this.me && this.blocked(o)) throw new Err("You can't message this person");
    }
    return c;
  }
  async upload(blob, first = 0) {
    const sha = sha256hex(blob);
    const errors = [];
    let servers = [...BLOSSOM];
    if (this.goodHost && servers.includes(this.goodHost)) servers = [this.goodHost, ...servers.filter((x) => x !== this.goodHost)];
    if (first) servers = [...servers.slice(first % servers.length), ...servers.slice(0, first % servers.length)];
    for (const server of servers) {
      const auth = this.k.sign(K_AUTH, [['t', 'upload'], ['x', sha], ['expiration', String(Math.floor(now()) + 600)]], 'Upload file');
      try {
        const r = await fetch(server + '/upload', { method: 'PUT', body: blob,
          headers: { Authorization: 'Nostr ' + btoa(JSON.stringify(auth)), 'Content-Type': 'application/octet-stream', 'X-SHA-256': sha } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const res = await r.json();
        if (res.url) { this.goodHost = server; return res.url; }
      } catch (e) { errors.push(`${server}: ${e.message || e}`); }
    }
    try {   // last resort: catbox.moe (anonymous). The blob is encrypted so they can't see anything.
      const url = (await httpPost('https://catbox.moe/user/api.php', { reqtype: 'fileupload' }, { field: 'fileToUpload', name: 'blob.bin', data: blob })).trim();
      if (url.startsWith('http')) return url;
      errors.push(url);
    } catch (e) { errors.push('catbox: ' + (e.message || e)); }
    throw new Err('Upload failed: ' + errors.join('; ').slice(0, 300));
  }
  async on_send(d) {
    const cid = parseInt(d.chat_id, 10);
    this.checkCanSend(cid);
    const body = String(d.body || '').slice(0, 8000);
    const pl = { type: 'msg', kind: 'text', body };
    const at = parseFloat(d.send_at || 0);
    pl.mid = newMid(at ? Math.floor(at * 1000) : ms());
    pl.ms = ms();
    if (d.file) {
      const raw = d.file.bytes || unb64(d.file.data);
      if (raw.length > MAX_FILE) throw new Err(`File too big (max ${MAX_FILE / 1024 / 1024} MB)`);
      const fkey = randBytes(32);
      const fname = basename(d.file.name || 'file').slice(0, 120);
      const meta = { name: fname, size: raw.length, k: b64(fkey) };
      const tid = d.file.tid || hex(randBytes(4));
      if (raw.length > PARTS_OVER) {
        meta.parts = await this.uploadParts(raw, fkey, fname, tid);
        meta.psize = PART;
      } else {
        const blob = await encBytes(fkey, raw);
        if (raw.length <= INLINE_MAX) meta.inline = b64(blob);
        else {
          const t0 = Date.now();
          this.transfer('up', fname, 0, raw.length, t0, tid);
          meta.url = await this.upload(blob);
          this.transfer('up', fname, raw.length, raw.length, t0, tid);
        }
      }
      pl.file = meta;
      pl.kind = d.file.voice ? 'voice' : IMAGE_EXT.has(ext(fname)) ? 'image' : 'file';
    } else if (d.poll) {
      const opts = (d.poll.options || []).map((o) => String(o).slice(0, 100)).filter((o) => o.trim()).slice(0, 10);
      if (opts.length < 2) throw new Err('A poll needs at least 2 options');
      pl.kind = 'poll';
      pl.poll = { options: opts, multi: !!d.poll.multi };
    } else if (!body.trim()) throw new Err('Empty message');
    if (d.reply_to) pl.reply_to = parseInt(d.reply_to, 10);
    if (d.silent) pl.silent = true;
    if (['call', 'nudge', 'system'].includes(d.kind)) pl.kind = d.kind;
    this.applyChatOp(cid, this.me, { ...pl }, true);
    await this.sendChat(cid, pl);
    return { id: pl.mid };
  }
  async on_history(d) {
    const cid = parseInt(d.chat_id, 10);
    this.chat(cid);
    const before = d.before ? Number(d.before) : 2 ** 62;
    const lim = Math.max(1, Math.min(parseInt(d.limit || 60, 10), 200));
    return this.q('SELECT * FROM messages WHERE chat_id=? AND shown=1 AND id<? ORDER BY id DESC LIMIT ?', cid, before, lim).reverse().map((r) => this.msgView(r));
  }
  async on_around(d) {
    const m = this.q1('SELECT * FROM messages WHERE id=?', Number(d.msg_id));
    if (!m) throw new Err('Message not found');
    const rows = this.q('SELECT * FROM messages WHERE chat_id=? AND shown=1 AND id>=? ORDER BY id LIMIT 200', m.chat_id, m.id);
    const older = this.q('SELECT * FROM messages WHERE chat_id=? AND shown=1 AND id<? ORDER BY id DESC LIMIT 30', m.chat_id, m.id);
    return older.reverse().concat(rows).map((r) => this.msgView(r));
  }
  async on_get_messages(d) {
    return (d.ids || []).slice(0, 100).map((mid) => this.q1('SELECT * FROM messages WHERE id=?', Number(mid))).filter(Boolean).map((m) => this.msgView(m));
  }
  ownMsg(mid) {
    const m = this.q1('SELECT * FROM messages WHERE id=?', Number(mid));
    if (!m) throw new Err('Message not found');
    return m;
  }
  async on_edit(d) {
    const m = this.ownMsg(d.msg_id);
    if (m.sender !== this.me) throw new Err('You can only edit your own messages');
    const body = String(d.body || '').slice(0, 8000);
    if (!body.trim()) throw new Err('Empty message');
    const pl = { type: 'edit', mid: m.id, body, ms: ms() };
    this.applyChatOp(m.chat_id, this.me, { ...pl }, true);
    await this.sendChat(m.chat_id, pl);
    return true;
  }
  async on_delete(d) {
    const m = this.ownMsg(d.msg_id);
    if (m.sender !== this.me && !['owner', 'admin'].includes(this.role(m.chat_id, this.me))) throw new Err("You can't delete that");
    const pl = { type: 'delete', mid: m.id, ms: ms() };
    this.applyChatOp(m.chat_id, this.me, { ...pl }, true);
    await this.sendChat(m.chat_id, pl);
    return true;
  }
  async on_react(d) {
    const m = this.ownMsg(d.msg_id);
    const e = String(d.emoji || '').slice(0, 16);
    const cur = this.q1('SELECT on_ FROM reactions WHERE msg_id=? AND user_id=? AND emoji=?', m.id, this.me, e);
    const pl = { type: 'react', mid: m.id, emoji: e, on: !(cur && cur.on_), ms: ms() };
    this.applyChatOp(m.chat_id, this.me, { ...pl }, true);
    await this.sendChat(m.chat_id, pl);
    return true;
  }
  async on_vote(d) {
    const m = this.ownMsg(d.msg_id);
    const p = this.q1('SELECT * FROM polls WHERE msg_id=?', m.id);
    if (!p) throw new Err('Not a poll');
    const opt = parseInt(d.option, 10);
    const cur = this.q1('SELECT opts FROM votes WHERE msg_id=? AND user_id=?', m.id, this.me);
    let mine = new Set(cur ? JSON.parse(cur.opts) : []);
    if (mine.has(opt)) mine.delete(opt);
    else mine = p.multi ? new Set([...mine, opt]) : new Set([opt]);
    const pl = { type: 'vote', mid: m.id, opts: [...mine].sort((a, b) => a - b), ms: ms() };
    this.applyChatOp(m.chat_id, this.me, { ...pl }, true);
    await this.sendChat(m.chat_id, pl);
    return true;
  }
  async on_pin(d) {
    const m = this.ownMsg(d.msg_id);
    const cur = this.q1('SELECT on_ FROM pins WHERE chat_id=? AND msg_id=?', m.chat_id, m.id);
    const on = !(cur && cur.on_);
    const pl = { type: 'pin', mid: m.id, on, ms: ms() };
    this.applyChatOp(m.chat_id, this.me, { ...pl }, true);
    await this.sendChat(m.chat_id, pl);
    if (on) await this.postSystem(m.chat_id, `${this.name(this.me)} pinned a message`);
    return true;
  }
  async on_read(d) {
    const cid = parseInt(d.chat_id, 10), mid = Number(d.msg_id);
    const c = this.chat(cid);
    if (mid > c.last_read) {
      this.x('UPDATE chats SET last_read=?, prefs_ts=? WHERE id=?', mid, now(), cid);
      this.readPending.set(cid, mid);
      this.markState();
    }
    this.emit({ t: 'read', chat_id: cid, user_id: this.me, msg_id: mid });
    return true;
  }
  async on_typing(d) { if (this.privacy().typing) await this.sendChatEph(parseInt(d.chat_id, 10), { type: 'typing' }); }
  async on_nudge(d) {
    const cid = parseInt(d.chat_id, 10);
    if (now() - this.nudgeT < 10) throw new Err('Slow down, wait a few seconds between nudges');
    this.nudgeT = now();
    await this.postSystem(cid, `${this.name(this.me)} sent a nudge!`, 'nudge');
    await this.sendChatEph(cid, { type: 'nudge' });
    return true;
  }
  async on_search(d) {
    const cid = parseInt(d.chat_id, 10);
    const q = String(d.q || '').trim();
    if (!q) return [];
    const like = '%' + q.replace(/%/g, '\\%').replace(/_/g, '\\_') + '%';
    const rows = this.q("SELECT m.* FROM messages m LEFT JOIN edits e ON e.msg_id=m.id WHERE m.chat_id=? AND m.shown=1 AND " +
      "(COALESCE(e.body, m.body) LIKE ? ESCAPE '\\' OR m.file LIKE ? ESCAPE '\\') ORDER BY m.id DESC LIMIT 60", cid, like, like);
    return rows.map((r) => this.msgView(r)).filter((v) => !v.deleted);
  }
  async on_media(d) {
    return this.q('SELECT * FROM messages WHERE chat_id=? AND shown=1 AND file IS NOT NULL ORDER BY id DESC LIMIT 200', parseInt(d.chat_id, 10))
      .map((r) => this.msgView(r)).filter((v) => !v.deleted);
  }
  transfer(kind, name, done, total, t0, id) {
    const el = Math.max(0.001, (Date.now() - t0) / 1000);
    this.emit({ t: 'transfer', id, kind, name, done, total, speed: done / el, finished: done >= total });
  }
  async pool4(n, fn) {
    let next = 0;
    const worker = async () => { while (next < n) { const i = next++; await fn(i); } };
    await Promise.all(Array.from({ length: Math.min(PAR, n) }, worker));
  }
  async uploadParts(raw, fkey, name, tid) {
    const n = Math.ceil(raw.length / PART);
    const urls = new Array(n);
    let sent = 0, last = 0;
    const t0 = Date.now();
    this.transfer('up', name, 0, raw.length, t0, tid);
    await this.pool4(n, async (i) => {
      const chunk = raw.subarray(i * PART, (i + 1) * PART);
      urls[i] = await this.upload(await encPart(fkey, chunk, i), i);
      sent += chunk.length;
      if (Date.now() - last > 400 || sent >= raw.length) { last = Date.now(); this.transfer('up', name, sent, raw.length, t0, tid); }
    });
    return urls;
  }
  // ------------------------------------------------------------------ status (24 h posts, same format as PC Smult)
  async applyStatus(ev, live) {
    const exp = tag(ev, 'expiration');
    let expires = exp ? parseInt(exp, 10) : ev.created_at + STATUS_TTL;
    if (!Number.isFinite(expires)) return;
    expires = Math.min(expires, ev.created_at + STATUS_TTL);
    if (expires < now() || this.q1('SELECT 1 FROM statuses WHERE id=?', ev.id)) return;
    const author = this.uid(ev.pubkey);
    if (author !== this.me && (this.blocked(author) || !this.isFriend(author))) return;
    const t = (ev.tags || []).find((x) => x.length >= 3 && x[0] === 'k' && x[1] === this.k.pub.slice(0, 16));
    if (!t) return;
    let body;
    try {
      const ckey = unb64((await dec(this.k.shared(ev.pubkey), t[2])).c);
      body = await dec(ckey, ev.content);
    } catch (e) { return; }
    const kind = body.kind === 'image' ? 'image' : 'text';
    const clean = { kind, text: String(body.text || '').slice(0, 700), bg: String(body.bg || '').slice(0, 9), font: String(body.font || '').slice(0, 12) };
    const f = body.file;
    if (kind === 'image' && f && String(f.url || '').startsWith('http')) clean.file = { url: String(f.url).slice(0, 400), k: String(f.k || '').slice(0, 64), size: parseInt(f.size || 0, 10) };
    this.x('INSERT OR IGNORE INTO statuses(id, author, created, expires, body) VALUES(?,?,?,?,?)', ev.id, author, ev.created_at, expires, JSON.stringify(clean));
    if (live) this.emit({ t: 'status', status: this.statusView(this.q1('SELECT * FROM statuses WHERE id=?', ev.id)) });
  }
  statusViews(sid) { return this.q('SELECT * FROM status_views WHERE status_id=? ORDER BY ts', sid).map((r) => ({ user_id: r.user_id, ts: r.ts })); }
  statusView(r) {
    const b = JSON.parse(r.body);
    const v = { id: r.id, user_id: r.author, created: r.created, expires: r.expires, seen: !!r.seen, kind: b.kind || 'text', text: b.text || '',
      bg: b.bg || '', font: b.font || '', has_file: !!b.file };
    if (r.author === this.me) v.views = this.statusViews(r.id);
    return v;
  }
  async on_status_list() {
    const by = new Map();
    for (const r of this.q('SELECT * FROM statuses WHERE expires>=? ORDER BY created', Math.floor(now()))) {
      if (r.author !== this.me && (this.blocked(r.author) || !this.isFriend(r.author))) continue;
      if (!by.has(r.author)) by.set(r.author, []);
      by.get(r.author).push(this.statusView(r));
    }
    const out = [...by].map(([u, items]) => ({ user_id: u, items, unseen: u === this.me ? 0 : items.filter((i) => !i.seen).length, latest: items[items.length - 1].created }));
    out.sort((a, b) => (a.user_id !== this.me) - (b.user_id !== this.me) || (a.unseen === 0) - (b.unseen === 0) || b.latest - a.latest);
    return out;
  }
  async on_status_post(d) {
    const kind = d.kind === 'image' ? 'image' : 'text';
    const body = { kind, text: String(d.text || '').slice(0, 700), bg: String(d.bg || '#29e0ff').slice(0, 9), font: String(d.font || '').slice(0, 12) };
    if (kind === 'text' && !body.text.trim()) throw new Err('Write something first');
    if (kind === 'image') {
      const raw = d.bytes || unb64(d.data || '');
      if (!raw.length || raw.length > 15 * 1024 * 1024) throw new Err('Picture is too big (max 15 MB)');
      const fkey = randBytes(32);
      const url = await this.upload(await encBytes(fkey, raw));
      body.file = { url, k: b64(fkey), size: raw.length };
    }
    const ckey = randBytes(32);
    const pubs = this.q("SELECT user_id FROM relations WHERE state='friend'").map((r) => this.pub(r.user_id)).concat([this.k.pub]);
    const tags = [['t', 'lobby-status'], ['expiration', String(Math.floor(now()) + STATUS_TTL)]];
    for (const pk of pubs) {
      tags.push(['p', pk]);
      tags.push(['k', pk.slice(0, 16), await enc(this.k.shared(pk), { c: b64(ckey) })]);
    }
    const ev = this.k.sign(K_STATUS, tags, await enc(ckey, body));
    await this.applyStatus(ev, false);
    this.pool.publish(ev);
    const v = this.statusView(this.q1('SELECT * FROM statuses WHERE id=?', ev.id));
    this.emit({ t: 'status', status: v });
    return v;
  }
  async on_status_seen(d) {
    const r = this.q1('SELECT * FROM statuses WHERE id=?', String(d.id || ''));
    if (!r || r.seen) return true;
    this.x('UPDATE statuses SET seen=1 WHERE id=?', r.id);
    if (r.author !== this.me) await this.sendEph([r.author], { type: 'status_seen', id: r.id });
    return true;
  }
  async on_status_views(d) { return this.statusViews(String(d.id || '')); }
  async on_status_media(d) {
    const r = this.q1('SELECT * FROM statuses WHERE id=?', String(d.id || ''));
    if (!r) throw new Err('That status is gone');
    const f = JSON.parse(r.body).file;
    if (!f) throw new Err('No picture');
    let blob;
    try { blob = await httpGet(f.url); } catch (e) { throw new Err('Download failed: ' + (e.message || e)); }
    try { return { bytes: await decBytes(unb64(f.k), blob) }; } catch (e) { throw new Err('File is corrupted'); }
  }
  async on_status_delete(d) {
    const sid = String(d.id || '');
    if (!this.q1('SELECT 1 FROM statuses WHERE id=? AND author=?', sid, this.me)) throw new Err('You can only delete your own status');
    this.pool.publish(this.k.sign(5, [['e', sid], ['k', String(K_STATUS)]], 'deleted'));
    this.x('DELETE FROM statuses WHERE id=?', sid);
    this.x('DELETE FROM status_views WHERE status_id=?', sid);
    this.emit({ t: 'status_removed', ids: [sid] });
    return true;
  }
  async on_get_file(d) {
    const m = this.q1('SELECT file FROM messages WHERE fid=?', String(d.file_id || ''));
    if (!m) throw new Err('File not found');
    const meta = JSON.parse(m.file);
    if (Array.isArray(meta.parts) && meta.parts.length) {
      const key = unb64(meta.k), size = meta.size || 0, out = new Array(meta.parts.length);
      const t0 = Date.now(), tid = 'dl' + String(d.file_id).slice(0, 8);
      let got = 0, last = 0;
      this.transfer('down', meta.name || 'file', 0, size || 1, t0, tid);
      await this.pool4(meta.parts.length, async (i) => {
        let blob, err;
        for (let a = 0; a < 3 && !blob; a++) {
          try { blob = await httpGet(meta.parts[i]); } catch (e) { err = e; await new Promise((r) => setTimeout(r, 1000 * (a + 1))); }
        }
        if (!blob) throw new Err('Download failed: ' + ((err && err.message) || err));
        try { out[i] = await decPart(key, blob, i); } catch (e) { throw new Err('File is corrupted'); }
        got += out[i].length;
        if (Date.now() - last > 400 || got >= size) { last = Date.now(); this.transfer('down', meta.name || 'file', got, size || got, t0, tid); }
      });
      const raw = new Uint8Array(got);
      let o = 0;
      for (const p of out) { raw.set(p, o); o += p.length; }
      return { name: meta.name || 'file', bytes: raw };
    }
    let blob;
    if (meta.inline) blob = unb64(meta.inline);
    else {
      try { blob = await httpGet(meta.url); } catch (e) { throw new Err('Download failed: ' + (e.message || e)); }
    }
    let raw;
    try { raw = await decBytes(unb64(meta.k), blob); } catch (e) { throw new Err('File is corrupted'); }
    return { name: meta.name || 'file', bytes: raw };
  }
  async on_schedule(d) {
    const at = parseFloat(d.send_at);
    if (at < now() - 5) throw new Err('That time is in the past');
    if (!String(d.body || '').trim()) throw new Err('Empty message');
    return this.on_send({ chat_id: d.chat_id, body: d.body, send_at: at });
  }
  async on_list_scheduled() {
    return this.q('SELECT * FROM messages WHERE sender=? AND shown=0 AND id NOT IN (SELECT msg_id FROM deletes)', this.me)
      .map((r) => ({ id: r.id, chat_id: r.chat_id, body: r.body, send_at: r.created }));
  }
  async on_cancel_scheduled(d) { return this.on_delete({ msg_id: d.id }); }

  // ------------------------------------------------------------------ calls (signalling over relays, media over WebRTC data channels)
  callView(c) {
    const members = [];
    for (const [u, st] of c.parts) members.push({ user_id: u, muted: !!st.muted, deaf: !!st.deaf, cam: !!st.cam, screen: !!st.screen });
    if (this.myCall === c.gcid && !c.parts.has(this.me)) members.push({ user_id: this.me, ...this.myState });
    return { id: c.id, chat_id: c.chatId, started: c.started, members, ringing: [...c.ringing.keys()].filter((u) => !c.parts.has(u)) };
  }
  getCall(gcid, chatId, started, starter) {
    let c = this.calls.get(gcid);
    if (!c) {
      c = new CallInfo(gcid, this.nextCall++, chatId, started, starter);
      this.calls.set(gcid, c);
      this.callByLocal.set(c.id, c);
    }
    return c;
  }
  callChanged(c) {
    this.emit({ t: 'call_update', chat_id: c.chatId, call: c.parts.size || this.myCall === c.gcid ? this.callView(c) : null });
  }
  callAudience(c) {
    const ch = this.q1('SELECT * FROM chats WHERE id=?', c.chatId);
    if (!ch) return [];
    if (ch.kind === 'dm') return [this.dmOther(ch)];
    return this.chatMembers(c.chatId).filter((u) => u !== this.me);
  }
  async callSignal(c, payload, to = null) {
    const ch = this.q1('SELECT ckey, kind FROM chats WHERE id=?', c.chatId);
    payload = { ...payload, cid: c.gcid, chat: ch.ckey.split(':')[0], started: c.started, starter: this.pub(c.starter) };
    if (!to && ch.kind === 'group') await this.sendGeph(c.chatId, payload);
    else await this.sendEph(to || this.callAudience(c), payload);
  }
  async applyCallSignal(author, pl, cid) {
    const t = pl.type, gcid = pl.cid;
    if (!gcid) return;
    if (cid === null || cid === undefined) {
      cid = this.dmChat(author, this.isFriend(author));
      if (!cid) return;
    }
    let starter = author;
    try { if (isHex64(pl.starter)) starter = this.uid(pl.starter); } catch (e) {}
    const c = this.getCall(gcid, cid, parseFloat(pl.started || now()), starter);
    if (t === 'call_ring') {
      if (this.myCall === gcid) return;
      if (this.privacy().calls_from === 'trusted' && !this.trusted(author)) return;
      const st = c.parts.get(author) || {};
      st.seen = now();
      c.parts.set(author, st);
      if (!this.rings.has(gcid)) {
        this.rings.set(gcid, now());
        this.emit({ t: 'call_ring', call: this.callView(c), from: author, video: !!pl.video, trusted: this.trusted(author) });
      }
      this.callChanged(c);
    } else if (t === 'call_presence') {
      const fresh = !c.parts.has(author);
      const prev = c.parts.get(author) || {};
      const st = {};
      for (const k of ['muted', 'deaf', 'cam', 'screen']) st[k] = !!(pl.st || {})[k];
      st.seen = now();
      const links = (pl.st || {}).links;
      st.links = Array.isArray(links) ? links.slice(0, 32).map((x) => String(x).slice(0, 16)) : [];
      c.parts.set(author, st);
      c.ever.add(author);
      c.ringing.delete(author);
      if (fresh || ['muted', 'deaf', 'cam', 'screen'].some((k) => prev[k] !== st[k])) {
        this.callChanged(c);
        if (fresh) this.pushUser(author);
      }
      const joining = !!(pl.st || {}).joining, dialing = (pl.st || {}).dialing || [];
      if (this.myCall === gcid && !this.peers.has(author)) {
        if (joining) { if (!dialing.includes(this.k.pub.slice(0, 16))) await this.connectPeer(author, c); }   // joined right when I did
        else if (this.k.pub < this.pub(author)) await this.connectPeer(author, c);
      }
    } else if (t === 'call_leave') {
      if (c.parts.has(author)) {
        c.parts.delete(author);
        this.closePeer(author);
        this.callMaybeEnd(c);
        this.callChanged(c);
        this.pushUser(author);
      }
    } else if (t === 'call_decline') {
      c.ringing.delete(author);
      if (this.myCall === gcid) {
        this.emit({ t: 'call_declined', call_id: c.id, user_id: author, reason: String(pl.reason || '').slice(0, 100) });
        const ch = this.q1('SELECT kind FROM chats WHERE id=?', c.chatId);
        if (ch.kind === 'dm' && !c.parts.size) {
          await this.postSystem(c.chatId, JSON.stringify({ event: 'missed', by: this.me }), 'call');
          await this.leaveCall();
        }
      }
      this.callChanged(c);
    } else if (t === 'call_end_ring') {
      if (this.rings.has(gcid)) { this.rings.delete(gcid); this.emit({ t: 'call_ring_stop', call_id: c.id }); }
      c.parts.delete(author);
      this.callChanged(c);
    } else if (t === 'call_react') {
      if (this.myCall === gcid) this.emit({ t: 'call_react', from: author, emoji: String(pl.emoji || '').slice(0, 16), sound: String(pl.sound || '').slice(0, 60) });
    } else if (t === 'rtc_offer' && this.myCall === gcid) {
      await this.acceptOffer(author, c, pl.sdp || '');
    } else if (t === 'rtc_answer' && this.myCall === gcid) {
      const p = this.peers.get(author);
      if (p && p.pc.signalingState === 'have-local-offer') {
        try { await p.pc.setRemoteDescription({ type: 'answer', sdp: pl.sdp || '' }); } catch (e) { console.warn('answer error', e); }
      }
    }
  }
  callMaybeEnd(c) { if (!c.parts.size && this.myCall !== c.gcid) this.calls.delete(c.gcid); }
  async callTick() {
    const t = now();
    for (const c of [...this.calls.values()]) {
      let changed = false;
      for (const [u, st] of [...c.parts]) if (t - (st.seen || t) > 12) { c.parts.delete(u); changed = true; this.closePeer(u); }
      for (const [u, ts] of [...c.ringing]) if (t - ts > RING_TIMEOUT) { c.ringing.delete(u); changed = true; }
      if (this.myCall === c.gcid) {
        await this.callSignal(c, { type: 'call_presence', st: this.presenceSt() });
        await this.healLinks(c);
        const ch = this.q1('SELECT kind FROM chats WHERE id=?', c.chatId);
        if (ch && ch.kind === 'dm' && !c.parts.size && !c.ever.size && t - c.started > RING_TIMEOUT) {
          await this.postSystem(c.chatId, JSON.stringify({ event: 'missed', by: this.me }), 'call');
          await this.leaveCall();
          continue;
        }
        if (ch && ch.kind === 'dm' && c.ever.size && !c.parts.size) { await this.leaveCall(); continue; }
      }
      if (changed) this.callChanged(c);
      if (!c.parts.size && this.myCall !== c.gcid) { this.calls.delete(c.gcid); this.callByLocal.delete(c.id); }
    }
    for (const [gcid, ts] of [...this.rings]) {
      const c = this.calls.get(gcid);
      if (t - ts > RING_TIMEOUT || !c || !c.parts.size) { this.rings.delete(gcid); this.emit({ t: 'call_ring_stop', call_id: c ? c.id : 0 }); }
    }
  }
  async on_call_start(d) {
    const cid = parseInt(d.chat_id, 10);
    this.checkCanSend(cid);
    for (const c of this.calls.values()) if (c.chatId === cid && c.parts.size) return this.on_call_join({ call_id: c.id });
    if (this.myCall) await this.leaveCall();
    const c = this.getCall(hex(randBytes(8)), cid, now(), this.me);
    this.myCall = c.gcid;
    this.myState = { muted: false, deaf: false, cam: false, screen: false };
    for (const u of this.callAudience(c)) if (this.presenceOf(u) !== 'offline') c.ringing.set(u, now());
    await this.callSignal(c, { type: 'call_ring', video: !!d.video });
    await this.callSignal(c, { type: 'call_presence', st: this.presenceSt() });
    this.callChanged(c);
    this.pushUser(this.me);
    return this.callView(c);
  }
  async on_call_join(d) {
    const c = this.callByLocal.get(parseInt(d.call_id, 10));
    if (!c) throw new Err('That call already ended');
    if (this.myCall === c.gcid) return this.callView(c);
    if (this.myCall) await this.leaveCall();
    this.myCall = c.gcid;
    this.myState = { muted: !!d.muted, deaf: false, cam: false, screen: false };
    if (this.rings.has(c.gcid)) { this.rings.delete(c.gcid); this.emit({ t: 'call_ring_stop', call_id: c.id }); }
    // the one joining dials everyone at once (and says so, so nobody dials back = no glare)
    const targets = [...c.parts.keys()].filter((u) => !this.peers.has(u) && u !== this.me);
    await this.callSignal(c, { type: 'call_presence', st: { ...this.presenceSt(), joining: true, dialing: targets.map((u) => this.pub(u).slice(0, 16)) } });
    await Promise.all(targets.map((u) => this.connectPeer(u, c).catch(() => null)));
    this.callChanged(c);
    this.pushUser(this.me);
    return this.callView(c);
  }
  async on_call_decline(d) {
    const c = this.callByLocal.get(parseInt(d.call_id, 10));
    if (!c) return true;
    this.rings.delete(c.gcid);
    this.emit({ t: 'call_ring_stop', call_id: c.id });
    await this.callSignal(c, { type: 'call_decline', reason: String(d.reason || '').slice(0, 100) }, c.parts.size ? [...c.parts.keys()] : null);
    return true;
  }
  async leaveCall() {
    const gcid = this.myCall;
    const c = this.calls.get(gcid);
    this.myCall = null;
    for (const u of [...this.peers.keys()]) this.closePeer(u);
    if (!c) return;
    await this.callSignal(c, { type: 'call_leave' });
    if (c.ringing.size) await this.callSignal(c, { type: 'call_end_ring' }, [...c.ringing.keys()]);
    if (!c.parts.size) {
      const dur = Math.floor(now() - c.started);
      if (c.ever.size) await this.postSystem(c.chatId, JSON.stringify({ event: 'ended', by: c.starter, duration: dur }), 'call');
      this.calls.delete(gcid);
    }
    this.emit({ t: 'call_update', chat_id: c.chatId, call: c.parts.size ? this.callView(c) : null });
    this.pushUser(this.me);
  }
  async on_call_leave() { await this.leaveCall(); return true; }
  async on_call_state(d) {
    const c = this.calls.get(this.myCall);
    if (!c) throw new Err('Not in a call');
    for (const k of ['muted', 'deaf', 'cam', 'screen']) if (k in d) this.myState[k] = !!d[k];
    await this.callSignal(c, { type: 'call_presence', st: this.presenceSt() });
    this.callChanged(c);
    return true;
  }
  async on_call_react(d) {
    const c = this.calls.get(this.myCall);
    if (!c) throw new Err('Not in a call');
    const pl = { type: 'call_react', emoji: String(d.emoji || '').slice(0, 16), sound: String(d.sound || '').slice(0, 60) };
    const sent = new Set();
    const msg = te.encode(JSON.stringify(pl));
    for (const [u, p] of this.peers) {
      const ch = p.ch.c;
      if (ch && ch.readyState === 'open') { try { ch.send(msg); sent.add(u); } catch (e) {} }
    }
    const rest = [...c.parts.keys()].filter((u) => !sent.has(u));
    if (rest.length) await this.callSignal(c, pl, rest);
    this.emit({ ...pl, t: 'call_react', from: this.me });
    return true;
  }
  async on_call_ring(d) {
    const c = this.calls.get(this.myCall);
    if (!c) throw new Err('Not in a call');
    const u = parseInt(d.user_id, 10);
    if (c.parts.has(u)) throw new Err('Already in the call');
    c.ringing.set(u, now());
    await this.callSignal(c, { type: 'call_ring', video: false }, [u]);
    this.callChanged(c);
    return true;
  }
  rtcConfig() {
    const iceServers = [{ urls: STUN }];
    if (this.turn && this.turn.url) iceServers.push({ urls: [this.turn.url], username: this.turn.user || undefined, credential: this.turn.pass || undefined });
    return { iceServers };
  }
  // ---- keeping everyone connected (same rules as PC Smult v16)
  presenceSt() { return { ...this.myState, links: this.myLinks() }; }
  linkOk(uid) { const p = this.peers.get(uid); return !!(p && p.ch.a && p.ch.a.readyState === 'open'); }
  myLinks() { const out = []; for (const u of this.peers.keys()) if (this.linkOk(u)) { try { out.push(this.pub(u).slice(0, 16)); } catch (e) {} } return out; }
  relayFor(c, uid) {
    let target;
    try { target = this.pub(uid).slice(0, 16); } catch (e) { return null; }
    let best = null;
    for (const [r, st] of c.parts) {
      if (r === uid || !this.linkOk(r) || !(st.links || []).includes(target)) continue;
      const k = this.pub(r);
      if (!best || k < best[0]) best = [k, r];
    }
    return best ? best[1] : null;
  }
  async healLinks(c) {
    const t = Date.now() / 1000;
    this.dial = this.dial || new Map();
    this.warned = this.warned || new Set();
    for (const u of [...c.parts.keys()]) {
      if (u === this.me || this.linkOk(u)) { this.dial.delete(u); continue; }
      const p = this.peers.get(u);
      const [first, last, n] = this.dial.get(u) || [t, 0, 0];
      this.dial.set(u, [first, last, n]);
      const lower = this.k.pub < this.pub(u);
      const stuck = !p || (t - p.born > 7 && !this.linkOk(u)) || ['failed', 'closed'].includes(p.pc.connectionState);
      if (stuck && t - last > (lower ? 6 : 14) && (lower || t - first > 12)) {
        this.dial.set(u, [first, t, n + 1]);
        this.closePeer(u);
        await this.connectPeer(u, c, true);
      }
      if (t - first > 30 && !this.warned.has(u) && !this.relayFor(c, u)) {
        this.warned.add(u);
        this.emit({ t: 'call_declined', call_id: c.id, user_id: u,
          reason: "can't connect to them directly (strict network/NAT). If nobody else in the call can pass their audio along, adding a TURN server in Settings → Advanced fixes it" });
      }
    }
    for (const u of [...this.dial.keys()]) if (!c.parts.has(u)) this.dial.delete(u);
  }
  sendVia(relay, dest, kind, payload) {
    const p = this.peers.get(relay);
    if (!p) return;
    const pre = new Uint8Array(9);
    pre[0] = 0xf0; pre.set(unhex(this.pub(dest).slice(0, 16)), 1);
    if (kind === 1 || kind === 4) {
      const ch = p.ch.a;
      if (!ch || ch.readyState !== 'open') return;
      const pkt = new Uint8Array(10 + payload.length);
      pkt.set(pre); pkt[9] = kind; pkt.set(payload, 10);
      try { ch.send(pkt); this.net.bytes.up += pkt.length; } catch (e) {}
      return;
    }
    const ch = p.ch.v;
    if (!ch || ch.readyState !== 'open' || ch.bufferedAmount > 1500000) return;
    p.fidVia = p.fidVia || {};
    const key = dest + ':' + kind;
    p.fidVia[key] = ((p.fidVia[key] || 0) + 1) % 65536;
    const size = 30000, n = Math.max(1, Math.ceil(payload.length / size));
    if (n > 255) return;
    for (let i = 0; i < n; i++) {
      const chunk = payload.subarray(i * size, (i + 1) * size);
      const pkt = new Uint8Array(chunk.length + 14);
      pkt.set(pre); pkt[9] = kind; pkt[10] = p.fidVia[key] >> 8; pkt[11] = p.fidVia[key] & 255; pkt[12] = i; pkt[13] = n;
      pkt.set(chunk, 14);
      try { ch.send(pkt); } catch (e) {}
    }
    this.net.bytes.up += payload.length;
  }
  setupChannel(peer, ch) {
    ch.binaryType = 'arraybuffer';
    peer.ch[ch.label] = ch;
    ch.onmessage = (e) => this.onPeerData(peer, ch.label, e.data);
  }
  watchPc(peer, c) {
    peer.pc.onconnectionstatechange = async () => {
      if (peer.pc.connectionState !== 'failed' || this.peers.get(peer.uid) !== peer) return;
      if (!peer.retried && this.k.pub < this.pub(peer.uid) && this.myCall === c.gcid) {
        this.closePeer(peer.uid);
        await sleep(2000);
        if (this.myCall === c.gcid && c.parts.has(peer.uid)) {
          const np = await this.connectPeer(peer.uid, c);
          if (np) np.retried = true;
        }
        return;
      }
      // (no toast here: healLinks keeps redialling and can route through another member)
    };
  }
  async gathered(pc) {
    // aiortc (PC Smult) doesn't do trickle ICE: candidates must be in the SDP. Don't wait for every last one though:
    // once a public (srflx/relay) address is in, give it 300 ms more; never more than 1.5 s (was up to 3.5 s)
    if (pc.iceGatheringState === 'complete') return;
    await new Promise((res) => {
      let done = false, soon = null;
      const fin = () => { if (!done) { done = true; clearTimeout(cap); clearTimeout(soon); res(); } };
      const cap = setTimeout(fin, this.turn && this.turn.url ? 3000 : 1500);
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') fin(); });
      pc.addEventListener('icecandidate', (e) => {
        if (!e.candidate) return fin();
        if (/ typ (srflx|relay)/.test(e.candidate.candidate) && !soon && !(this.turn && this.turn.url && !/ typ relay/.test(e.candidate.candidate))) soon = setTimeout(fin, 300);
      });
    });
  }
  async connectPeer(uid, c, force = false) {
    const cur = this.peers.get(uid);
    if (cur && !force && !['failed', 'closed'].includes(cur.pc.connectionState) && Date.now() / 1000 - cur.born < 8) return cur;
    const pc = new RTCPeerConnection(this.rtcConfig());
    const peer = { uid, pc, ch: {}, frames: new Map(), fid: { 2: 0, 3: 0 }, retried: false, born: Date.now() / 1000, offering: true };
    this.peers.set(uid, peer);
    this.watchPc(peer, c);
    this.setupChannel(peer, pc.createDataChannel('a', { ordered: false, maxRetransmits: 0 }));
    this.setupChannel(peer, pc.createDataChannel('v', { ordered: false, maxRetransmits: 1 }));
    this.setupChannel(peer, pc.createDataChannel('c'));
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await this.gathered(pc);
      await this.callSignal(c, { type: 'rtc_offer', sdp: pc.localDescription.sdp }, [uid]);
    } catch (e) { console.warn('offer failed', e); }
    return peer;
  }
  async acceptOffer(uid, c, sdp) {
    const cur = this.peers.get(uid);
    if (cur && cur.offering && !['failed', 'closed'].includes(cur.pc.connectionState) && this.k.pub < this.pub(uid) && Date.now() / 1000 - cur.born < 10) return;   // glare (even mid-gathering): lower key's offer wins
    this.closePeer(uid);
    const pc = new RTCPeerConnection(this.rtcConfig());
    const peer = { uid, pc, ch: {}, frames: new Map(), fid: { 2: 0, 3: 0 }, retried: false, born: Date.now() / 1000 };
    this.peers.set(uid, peer);
    this.watchPc(peer, c);
    pc.ondatachannel = (e) => this.setupChannel(peer, e.channel);
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await this.gathered(pc);
      await this.callSignal(c, { type: 'rtc_answer', sdp: pc.localDescription.sdp }, [uid]);
    } catch (e) { console.warn('answer failed', e); }
  }
  closePeer(uid) {
    const p = this.peers.get(uid);
    if (p) { this.peers.delete(uid); try { p.pc.close(); } catch (e) {} }
  }
  onPeerData(peer, label, data) {
    const c = this.calls.get(this.myCall);
    if (!c) return;
    let b = typeof data === 'string' ? te.encode(data) : new Uint8Array(data);
    this.net.bytes.down += b.length;
    if (label === 'c') {
      let pl;
      try { pl = JSON.parse(new TextDecoder().decode(b)); } catch (e) { return; }
      if (pl.type === 'call_react') this.emit({ t: 'call_react', from: peer.uid, emoji: String(pl.emoji || '').slice(0, 16), sound: String(pl.sound || '').slice(0, 60) });
      return;
    }
    if (!b.length) return;
    let kind = b[0];
    if (kind === 0xf0 && b.length > 9) {           // pass this on to <dest> (they can't reach each other directly)
      const dest = hex(b.subarray(1, 9));
      for (const [u, p] of this.peers) {
        if (u !== peer.uid && this.pub(u).slice(0, 16) === dest) {
          const ch = p.ch[label];
          if (ch && ch.readyState === 'open' && ch.bufferedAmount < 1500000) {
            const out = new Uint8Array(b.length);
            out[0] = 0xf1; out.set(unhex(this.pub(peer.uid).slice(0, 16)), 1); out.set(b.subarray(9), 9);
            try { ch.send(out); } catch (e) {}
          }
          break;
        }
      }
      return;
    }
    if (kind === 0xf1 && b.length > 9) {           // media from <origin>, passed along by this peer
      const org = hex(b.subarray(1, 9));
      const uid = [...c.parts.keys()].find((u) => this.pub(u).slice(0, 16) === org);
      if (uid === undefined || (label === 'a' && this.linkOk(uid))) return;
      this.origins = this.origins || new Map();
      if (!this.origins.has(uid)) this.origins.set(uid, { uid, frames: new Map() });
      peer = this.origins.get(uid);
      b = b.subarray(9);
      if (!b.length) return;
      kind = b[0];
    }
    if (label === 'a' && (kind === 1 || kind === 4)) this.net.media(peer.uid, kind, b.subarray(1));
    else if (label === 'v' && (kind === 2 || kind === 3) && b.length > 5) {
      const fid = (b[1] << 8) | b[2], idx = b[3], n = b[4];
      const key = kind * 65536 + fid;
      let parts = peer.frames.get(key);
      if (!parts) { parts = new Map(); peer.frames.set(key, parts); }
      parts.set(idx, b.slice(5));
      if (parts.size === n) {
        peer.frames.delete(key);
        const all = [];
        for (let i = 0; i < n; i++) all.push(parts.get(i));
        const len = all.reduce((a, x) => a + x.length, 0);
        const out = new Uint8Array(len);
        let o = 0;
        for (const x of all) { out.set(x, o); o += x.length; }
        this.net.media(peer.uid, kind, out);
      }
      if (peer.frames.size > 6) {
        const keys = [...peer.frames.keys()].sort((a, b2) => a - b2);
        for (const k of keys.slice(0, -3)) peer.frames.delete(k);
      }
    }
  }
  sendMedia(kind, payload) {
    if (!this.myCall) return;
    const c = this.calls.get(this.myCall);
    if (c) {                                        // members we can't reach directly: through a shared friend
      for (const uid of c.parts.keys()) {
        if (uid === this.me || this.linkOk(uid) || ((kind === 1 || kind === 4) && c.parts.get(uid)?.deaf)) continue;
        const r = this.relayFor(c, uid);
        if (r) this.sendVia(r, uid, kind, payload);
      }
    }
    for (const [uid, p] of this.peers) {
      if (kind === 1 || kind === 4) {
        if (c && c.parts.get(uid)?.deaf) continue;
        const ch = p.ch.a;
        if (ch && ch.readyState === 'open' && (kind === 1 || ch.bufferedAmount < 200000)) {
          const pkt = new Uint8Array(payload.length + 1);
          pkt[0] = kind; pkt.set(payload, 1);
          try { ch.send(pkt); this.net.bytes.up += pkt.length; } catch (e) {}
        }
      } else {
        const ch = p.ch.v;
        if (!ch || ch.readyState !== 'open' || ch.bufferedAmount > 1500000) continue;
        p.fid[kind] = ((p.fid[kind] || 0) + 1) % 65536;
        const size = 30000;
        const n = Math.max(1, Math.ceil(payload.length / size));
        if (n > 255) continue;
        for (let i = 0; i < n; i++) {
          const chunk = payload.subarray(i * size, (i + 1) * size);
          const pkt = new Uint8Array(chunk.length + 5);
          pkt[0] = kind; pkt[1] = p.fid[kind] >> 8; pkt[2] = p.fid[kind] & 255; pkt[3] = i; pkt[4] = n;
          pkt.set(chunk, 5);
          try { ch.send(pkt); } catch (e) {}
        }
        this.net.bytes.up += payload.length;
      }
    }
  }
}

// ======================================================================== the "net" object the UI talks to
export class P2PNet {
  constructor() {
    this.listeners = new Set();
    this.stateListeners = new Set();
    this.mediaListeners = new Set();
    this.backend = null;
    this.authed = false;
    this.token = null;
    this.bytes = { up: 0, down: 0 };
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onState(fn) { this.stateListeners.add(fn); return () => this.stateListeners.delete(fn); }
  onMedia(fn) { this.mediaListeners.add(fn); return () => this.mediaListeners.delete(fn); }
  emit(obj) { for (const f of [...this.listeners]) { try { f(obj); } catch (e) { console.error(e); } } }
  state(s) { if (this.authed) for (const f of [...this.stateListeners]) f(s); }
  media(uid, kind, bytes) { for (const f of [...this.mediaListeners]) f(uid, kind, bytes); }

  async connect(authMsg, { relays, turn, onProgress } = {}) {
    if (this.backend) { await this.backend.stop(); this.backend = null; }
    const { deriveSecret, unhex } = await import('./crypto.js');
    let secret, username, mode, profile = null;
    if (authMsg.t === 'resume') {
      const tok = authMsg.token || '';
      const i = tok.indexOf('|');
      if (i !== 64) throw new Err('Session expired, log in again');
      secret = unhex(tok.slice(0, 64));
      username = tok.slice(65);
      mode = 'resume';
    } else {
      username = String(authMsg.username || '').trim();
      const pw = authMsg.password || '';
      if (!/^[A-Za-z0-9_.]{3,20}$/.test(username)) throw new Err('Username: 3-20 letters, numbers, _ or .');
      if (pw.length < 8) throw new Err('Password needs at least 8 characters (it is your key, so make it a good one)');
      secret = await deriveSecret(username, pw, onProgress);
      mode = authMsg.t;
      profile = { username, display: String(authMsg.display || username).trim().slice(0, 32) || username };
    }
    const be = new Backend(this, new Keys(secret), username, relays || DEFAULT_RELAYS, turn);
    await be.init();
    this.backend = be;
    try {
      await be.start(mode, profile);
    } catch (e) {
      await be.stop();
      this.backend = null;
      throw e;
    }
    this.token = hex(secret) + '|' + username;
    this.authed = true;
    this.state('online');
    return { token: this.token };
  }
  async req(t, d = {}) {
    if (!this.backend) throw new Err('Not connected');
    return this.backend.handle(t, d);
  }
  sendMedia(kind, payload) { if (this.backend) this.backend.sendMedia(kind, payload); }
  async close() {
    this.authed = false;
    if (this.backend) { const be = this.backend; this.backend = null; await be.stop(); }
  }
  save() { return this.backend ? this.backend.db.save() : Promise.resolve(); }
}
