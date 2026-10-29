// Local view of the world (port of core.Store): fed by backend events, read by the UI.
const intkeys = (d) => { const o = {}; for (const [k, v] of Object.entries(d || {})) o[parseInt(k, 10)] = v; return o; };

export class Store {
  constructor() { this.listeners = new Set(); this.reset(); }
  reset() {
    this.me = null;
    this.users = {};
    this.rels = {};
    this.chats = {};
    this.msgs = {};      // cid -> Map(mid -> msg)
    this.more = {};
    this.typing = {};
    this.maxFile = 100 * 1024 * 1024;
    this.synced = false;
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed(what, data) { for (const f of [...this.listeners]) { try { f(what, data); } catch (e) { console.error(e); } } }
  _chat(c) {
    c.users = intkeys(c.users);
    c.reads = intkeys(c.reads);
    for (const u of Object.values(c.users)) if (u) this._user(u);
    if (c.last) this._msg(c.last);
    return c;
  }
  _msg(m) { if (m.poll) m.poll.votes = intkeys(m.poll.votes); return m; }
  _user(u) {
    const old = this.users[u.id] || {};
    Object.assign(old, u);
    this.users[u.id] = old;
    if (this.me && u.id === this.me.id) Object.assign(this.me, u);
    return old;
  }
  get myId() { return this.me ? this.me.id : 0; }
  name(uid, nick = true) {
    if (uid === 0) return 'Lobby';
    const r = this.rels[uid];
    if (nick && r && r.nickname) return r.nickname;
    const u = this.users[uid];
    return u ? (u.display || u.username) : `user ${uid}`;
  }
  friends() { return Object.values(this.rels).filter((r) => r.state === 'friend'); }
  dmOther(c) { const o = c.members.map((m) => m.id).filter((id) => id !== this.myId); return o.length ? o[0] : this.myId; }
  chatTitle(c) {
    if (c.kind === 'group') return c.name || 'Group';
    const o = this.dmOther(c);
    return o === this.myId ? 'Notes to self' : this.name(o);
  }
  dmWith(uid) { return Object.values(this.chats).find((c) => c.kind === 'dm' && this.dmOther(c) === uid) || null; }
  role(cid, uid) {
    const c = this.chats[cid];
    uid = uid || this.myId;
    return c ? (c.members.find((m) => m.id === uid) || {}).role || null : null;
  }
  isTrusted(uid) { const r = this.rels[uid]; return !!(r && r.trusted); }
  pendingIn() { return Object.values(this.rels).filter((r) => r.state === 'in'); }
  totalUnread() { return Object.values(this.chats).reduce((a, c) => a + (c.my.muted ? 0 : c.unread), 0); }
  typingNames(cid) {
    const now = Date.now() / 1000;
    return Object.entries(this.typing[cid] || {}).filter(([, ts]) => now - ts < 6).map(([u]) => this.name(parseInt(u, 10)));
  }
  handle(d) {
    const t = d.t;
    if (t === 'init') {
      const keepMsgs = this.msgs;
      this.reset();
      this.msgs = keepMsgs;
      this.me = { ...d.me };
      this.users[this.me.id] = { ...d.me };
      this.maxFile = (d.server || {}).max_file || this.maxFile;
      for (const r of d.relations) { this._user(r.user); this.rels[r.user.id] = r; }
      for (const c of d.chats) this.chats[c.id] = this._chat(c);
      this.changed('all');
    } else if (t === 'synced') {
      this.synced = true;
      this.changed('all');
    } else if (t === 'user') {
      if (!d.user) return;
      const u = this._user(d.user);
      this.changed('user', u.id);
    } else if (t === 'relation') {
      const r = d.rel, uid = r.user.id;
      this._user(r.user);
      if (r.state === null) delete this.rels[uid]; else this.rels[uid] = r;
      this.changed('rel', uid);
    } else if (t === 'chat') {
      const c = this._chat(d.chat);
      this.chats[c.id] = c;
      this.changed('chat', c.id);
    } else if (t === 'chat_removed') {
      delete this.chats[d.chat_id];
      delete this.msgs[d.chat_id];
      this.changed('chat_removed', d.chat_id);
    } else if (t === 'message' || t === 'message_update') {
      const m = this._msg(d.msg), cid = m.chat_id;
      if (this.msgs[cid]) this.msgs[cid].set(m.id, m);
      const c = this.chats[cid];
      if (c) {
        if (t === 'message') {
          if (!c.last || m.id >= c.last.id) c.last = m;
          if (m.sender === this.myId) { c.my.last_read = Math.max(c.my.last_read, m.id); c.unread = 0; }
          else if (m.kind !== 'system') {
            c.unread += 1;
            const b = m.body || '';
            if (this.me && (b.toLowerCase().includes('@' + this.me.username.toLowerCase()) || b.includes('@everyone'))) c.mentions = (c.mentions || 0) + 1;
          }
          if (m.sender && this.typing[cid]) delete this.typing[cid][m.sender];
        } else if (c.last && c.last.id === m.id) c.last = m;
      }
      this.changed(t, m);
    } else if (t === 'read') {
      const c = this.chats[d.chat_id];
      if (c) {
        if (d.user_id === this.myId) {
          c.my.last_read = Math.max(c.my.last_read, d.msg_id);
          if (!c.last || d.msg_id >= c.last.id) { c.unread = 0; c.mentions = 0; }
        } else c.reads[d.user_id] = d.msg_id;
        this.changed('read', d.chat_id);
      }
    } else if (t === 'typing') {
      (this.typing[d.chat_id] = this.typing[d.chat_id] || {})[d.user_id] = Date.now() / 1000;
      this.changed('typing', d.chat_id);
    } else if (t === 'call_update') {
      const c = this.chats[d.chat_id];
      if (c) c.call = d.call;
      this.changed('call', d.chat_id);
    }
  }
}
