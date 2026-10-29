// The local SQLite database (sql.js = real SQLite in WebAssembly), same schema as PC Lobby. Saved to IndexedDB a few
// seconds after every change and whenever the app goes to the background.
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { idb } from './idb.js';

let SQL = null;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, pubkey TEXT UNIQUE, username TEXT DEFAULT '',
  display TEXT DEFAULT '', avatar TEXT DEFAULT '', color TEXT DEFAULT '#d9a441', bio TEXT DEFAULT '',
  status_msg TEXT DEFAULT '', reg REAL DEFAULT 0, profile_ts INTEGER DEFAULT 0, hb REAL DEFAULT 0,
  presence TEXT DEFAULT 'online', show_ls INTEGER DEFAULT 1, pic TEXT DEFAULT '', pic_url TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS relations(user_id INTEGER PRIMARY KEY, state TEXT, trusted INTEGER DEFAULT 0,
  nickname TEXT DEFAULT '', note TEXT DEFAULT '', since REAL, trusts_me INTEGER DEFAULT 0, ts REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS chats(id INTEGER PRIMARY KEY, kind TEXT, ckey TEXT UNIQUE, name TEXT DEFAULT '',
  icon TEXT DEFAULT '', topic TEXT DEFAULT '', created_by INTEGER, created REAL, muted INTEGER DEFAULT 0,
  pinned INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, last_read INTEGER DEFAULT 0, left INTEGER DEFAULT 0,
  joined_ts REAL DEFAULT 0, prefs_ts REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS members(chat_id INTEGER, user_id INTEGER, role TEXT DEFAULT 'member', joined REAL,
  PRIMARY KEY(chat_id, user_id));
CREATE TABLE IF NOT EXISTS gkeys(gid TEXT, ver INTEGER, key TEXT, PRIMARY KEY(gid, ver));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, chat_id INTEGER, sender INTEGER, kind TEXT,
  body TEXT DEFAULT '', reply_to INTEGER, created REAL, file TEXT, fid TEXT, silent INTEGER DEFAULT 0,
  shown INTEGER DEFAULT 1);
CREATE INDEX IF NOT EXISTS idx_msg ON messages(chat_id, id);
CREATE INDEX IF NOT EXISTS idx_fid ON messages(fid);
CREATE TABLE IF NOT EXISTS edits(msg_id INTEGER PRIMARY KEY, author INTEGER, body TEXT, ts REAL);
CREATE TABLE IF NOT EXISTS deletes(msg_id INTEGER PRIMARY KEY, author INTEGER, ts REAL);
CREATE TABLE IF NOT EXISTS reactions(msg_id INTEGER, user_id INTEGER, emoji TEXT, on_ INTEGER, ts REAL,
  PRIMARY KEY(msg_id, user_id, emoji));
CREATE TABLE IF NOT EXISTS polls(msg_id INTEGER PRIMARY KEY, options TEXT, multi INTEGER);
CREATE TABLE IF NOT EXISTS votes(msg_id INTEGER, user_id INTEGER, opts TEXT, ts REAL, PRIMARY KEY(msg_id, user_id));
CREATE TABLE IF NOT EXISTS pins(chat_id INTEGER, msg_id INTEGER, by INTEGER, on_ INTEGER, ts REAL,
  PRIMARY KEY(chat_id, msg_id));
CREATE TABLE IF NOT EXISTS reads(chat_id INTEGER, user_id INTEGER, msg_id INTEGER, PRIMARY KEY(chat_id, user_id));
CREATE TABLE IF NOT EXISTS badge_ev(pubkey TEXT PRIMARY KEY, created INTEGER, body TEXT);
CREATE TABLE IF NOT EXISTS stash(id TEXT PRIMARY KEY, gid TEXT, created INTEGER, raw TEXT);
CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
`;

export class LocalDB {
  static async open(name) {
    if (!SQL) SQL = await initSqlJs({ locateFile: () => wasmUrl });
    const saved = await idb.get('kv', 'db:' + name).catch(() => null);
    const d = new LocalDB(name, saved ? new SQL.Database(saved) : new SQL.Database());
    d.db.exec(SCHEMA);
    return d;
  }
  constructor(name, db) {
    this.name = name;
    this.db = db;
    this.stmts = new Map();
    this.dirty = false;
    this.saveTimer = null;
  }
  _stmt(sql) {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      if (this.stmts.size > 400) { for (const v of this.stmts.values()) v.free(); this.stmts.clear(); }
      this.stmts.set(sql, s);
    }
    return s;
  }
  q(sql, ...a) {
    const s = this._stmt(sql);
    s.bind(a.map(fix));
    const rows = [];
    while (s.step()) rows.push(s.getAsObject());
    s.reset();
    return rows;
  }
  q1(sql, ...a) {
    const s = this._stmt(sql);
    s.bind(a.map(fix));
    const r = s.step() ? s.getAsObject() : null;
    s.reset();
    return r;
  }
  x(sql, ...a) {
    const s = this._stmt(sql);
    s.run(a.map(fix));
    this.markDirty();
    const r = this.db.exec('SELECT last_insert_rowid()');
    return r.length ? r[0].values[0][0] : null;
  }
  kv(k, dflt = null) {
    const r = this.q1('SELECT v FROM kv WHERE k=?', k);
    return r ? JSON.parse(r.v) : dflt;
  }
  setKv(k, v) { this.x('INSERT OR REPLACE INTO kv VALUES(?,?)', k, JSON.stringify(v)); }
  markDirty() {
    this.dirty = true;
    if (!this.saveTimer) this.saveTimer = setTimeout(() => this.save(), 4000);
  }
  async save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.dirty) return;
    this.dirty = false;
    try { await idb.put('kv', 'db:' + this.name, this.db.export()); } catch (e) { console.warn('db save failed', e); }
    // export() resets prepared statements in sql.js
    for (const v of this.stmts.values()) { try { v.free(); } catch (e) {} }
    this.stmts.clear();
  }
  close() {
    for (const v of this.stmts.values()) { try { v.free(); } catch (e) {} }
    this.stmts.clear();
    this.db.close();
  }
}

function fix(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}
