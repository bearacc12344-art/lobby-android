// Pool of Nostr relay websockets (same behaviour as RelayPool in p2p.py): auto-reconnect with backoff, resubscribe,
// resend recent own events, de-duplicate, verify signatures (in a worker, in order).
import VerifyWorker from './verifyWorker.js?worker';

class Verifier {
  constructor() {
    this.w = null;
    try { this.w = new VerifyWorker(); } catch (e) { this.w = null; }
    this.n = 0;
    this.pending = new Map();
    this.chain = Promise.resolve();
    if (this.w) this.w.onmessage = (e) => { const p = this.pending.get(e.data.id); this.pending.delete(e.data.id); p && p(e.data.ok); };
  }
  async verifyMany(evs) {
    if (!this.w) {
      const { verifyEvent } = await import('./crypto.js');
      return evs.map(verifyEvent);
    }
    const id = ++this.n;
    return new Promise((res) => { this.pending.set(id, res); this.w.postMessage({ id, evs }); });
  }
}

export class RelayPool {
  constructor(urls, { onEvent, onEose, onStatus }) {
    this.urls = [...new Set(urls)];
    this.onEvent = onEvent; this.onEose = onEose; this.onStatus = onStatus;
    this.ws = new Map();          // url -> open WebSocket
    this.subs = new Map();        // sid -> filters
    this.seen = new Map();
    this.outbox = [];
    this.running = true;
    this.waiters = new Map();     // sid -> {resolve, events, eose, need}
    this.verifier = new Verifier();
    this.queue = [];              // incoming [sid, ev] waiting for signature checks (kept in arrival order)
    this.flushing = false;
    this.timers = new Set();
  }
  connected() { return this.ws.size; }
  start() { for (const u of this.urls) this._run(u, 2); }
  stop() {
    this.running = false;
    for (const t of this.timers) clearTimeout(t);
    for (const ws of this.ws.values()) { try { ws.close(); } catch (e) {} }
    for (const s of this._sockets || []) { try { s.close(); } catch (e) {} }
    this.ws.clear();
  }
  _run(url, backoff) {
    if (!this.running) return;
    let ws;
    try { ws = new WebSocket(url); } catch (e) { return this._retry(url, backoff); }
    (this._sockets = this._sockets || new Set()).add(ws);
    let opened = false;
    const openTimer = setTimeout(() => { if (!opened) { try { ws.close(); } catch (e) {} } }, 12000);
    ws.onopen = () => {
      opened = true;
      clearTimeout(openTimer);
      this.ws.set(url, ws);
      backoff = 2;
      this.onStatus && this.onStatus();
      for (const [sid, f] of this.subs) ws.send(JSON.stringify(['REQ', sid, ...f]));
      for (const ev of this.outbox) ws.send(JSON.stringify(['EVENT', ev]));
    };
    ws.onmessage = (m) => this._handle(url, m.data);
    ws.onerror = () => {};
    ws.onclose = () => {
      clearTimeout(openTimer);
      this._sockets.delete(ws);
      const was = this.ws.get(url) === ws;
      if (was) this.ws.delete(url);
      this.onStatus && this.onStatus();
      for (const w of this.waiters.values()) { w.eose++; if (w.eose >= w.need) w.resolve(); }
      if (this.running) this._retry(url, opened ? 2 : backoff);
    };
  }
  _retry(url, backoff) {
    const t = setTimeout(() => { this.timers.delete(t); this._run(url, Math.min(backoff * 2, 60)); }, (backoff + Math.random()) * 1000);
    this.timers.add(t);
  }
  _handle(url, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    const typ = msg[0];
    if (typ === 'EVENT' && msg.length >= 3) {
      const sid = msg[1], ev = msg[2];
      if (!ev || typeof ev !== 'object' || !ev.id) return;
      const w = this.waiters.get(sid);
      if (w && w.stats) {                 // paging: how many each relay sent, and its oldest one
        const [c, m] = w.stats.get(url) || [0, Infinity];
        w.stats.set(url, [c + 1, Math.min(m, ev.created_at | 0)]);
      }
      if (this.seen.has(ev.id)) {
        if (!w) return;
        if (this.seen.get(ev.id) === 1) { w.events.set(ev.id, ev); return; }
        this.queue.push([sid, ev]);      // first copy still being checked: check this one too
        this._flush();
        return;
      }
      this.seen.set(ev.id, 0);       // 0 = being checked
      this.queue.push([sid, ev]);
      this._flush();
    } else if (typ === 'CLOSED' && msg.length >= 2) {
      // a relay ended one of our subscriptions: send it again (smaller if it complained about filters)
      const sid = String(msg[1]), why = String(msg[2] || '').toLowerCase(), base = sid.split('.')[0];
      if (!this.subs.has(sid) || sid.startsWith('q')) return;
      if (/filter|too many|limit/.test(why) && (this.chunk?.[base] || 5) > 1) {
        this.chunk = this.chunk || {};
        this.chunk[base] = Math.max(1, Math.floor((this.chunk[base] || 5) / 2));
        const all = [...this.subs.entries()].filter(([k]) => k === base || k.startsWith(base + '.')).sort().flatMap(([, v]) => v);
        this.subscribe(base, all);
        return;
      }
      const ws = this.ws.get(url);
      setTimeout(() => { if (ws && this.subs.has(sid)) { try { ws.send(JSON.stringify(['REQ', sid, ...this.subs.get(sid)])); } catch (e) {} } }, 4000 + Math.random() * 4000);
    } else if (typ === 'EOSE') {
      const sid = msg[1];
      const w = this.waiters.get(sid);
      if (w) {
        this._afterQueue(() => { w.eose++; if (w.eose >= w.need) w.resolve(); });
      } else {
        this._afterQueue(() => this.onEose && this.onEose(url, sid));
      }
    }
  }
  _afterQueue(fn) {
    if (!this.queue.length && !this.flushing) return fn();
    (this._after = this._after || []).push(fn);
  }
  async _flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.queue.length) {
        const batch = this.queue.splice(0, 200);
        const ok = await this.verifier.verifyMany(batch.map((b) => b[1]));
        batch.forEach(([sid, ev], i) => {
          if (!ok[i]) { this.seen.delete(ev.id); return; }
          this.seen.set(ev.id, 1);
          const w = this.waiters.get(sid);
          if (w) w.events.set(ev.id, ev);
          else this.onEvent(ev);
        });
        if (this.seen.size > 60000) {
          let n = 0;
          for (const k of this.seen.keys()) { this.seen.delete(k); if (++n > 15000) break; }
        }
      }
    } finally {
      this.flushing = false;
      const after = this._after || [];
      this._after = [];
      after.forEach((f) => f());
    }
  }
  _sendAll(payload) {
    for (const ws of this.ws.values()) { try { ws.send(payload); } catch (e) {} }
  }
  publish(ev, store = true) {
    this.seen.set(ev.id, 1);
    if (store) {
      this.outbox.push(ev);
      if (this.outbox.length > 300) this.outbox = this.outbox.slice(-300);
    }
    this._sendAll(JSON.stringify(['EVENT', ev]));
  }
  // one logical subscription sent as several small REQs (sid, sid.1, ...): many relays refuse more than ~10 filters
  subscribe(sid, filters) {
    // a REQ with the same id replaces the old one on the relay (no gap where live presence gets lost);
    // only chunks that aren't used any more get closed
    const old = [...this.subs.keys()].filter((k) => k === sid || k.startsWith(sid + '.'));
    this.chunk = this.chunk || {};
    const n = Math.max(1, this.chunk[sid] || 5);
    const used = new Set();
    for (let i = 0; i < filters.length; i += n) {
      const k = i === 0 ? sid : `${sid}.${i / n}`;
      used.add(k);
      this.subs.set(k, filters.slice(i, i + n));
      this._sendAll(JSON.stringify(['REQ', k, ...this.subs.get(k)]));
    }
    for (const k of old) if (!used.has(k)) { this.subs.delete(k); this._sendAll(JSON.stringify(['CLOSE', k])); }
  }
  query(filters, timeout = 5000, stats = null) {
    const sid = 'q' + Math.random().toString(16).slice(2, 10);
    const need = Math.max(1, this.ws.size);
    return new Promise((resolve) => {
      const w = { events: new Map(), eose: 0, need, resolve: null, stats };
      const done = () => {
        clearTimeout(t);
        if (!this.waiters.has(sid)) return;
        this.waiters.delete(sid);
        this._sendAll(JSON.stringify(['CLOSE', sid]));
        resolve([...w.events.values()]);
      };
      w.resolve = () => this._afterQueue(done);
      const t = setTimeout(() => this._afterQueue(done), timeout);
      this.waiters.set(sid, w);
      this._sendAll(JSON.stringify(['REQ', sid, ...filters]));
    });
  }
  // everything matching flt since `since`, page by page: relays only send their newest few hundred per request, so keep
  // asking for the next older page until every relay runs out (pages follow the relay with the narrowest window)
  async queryAll(flt, since, timeout = 8000, maxPages = 80) {
    const out = new Map();
    let until = null;
    for (let p = 0; p < maxPages; p++) {
      const f = { ...flt, since, limit: 1000 };
      if (until !== null) f.until = until;
      const stats = new Map();
      for (const e of await this.query([f], timeout, stats)) out.set(e.id, e);
      const full = [...stats.values()].filter(([c]) => c >= 40).map(([, m]) => m);
      if (!full.length) break;
      let nxt = Math.max(...full);
      if (until !== null && nxt >= until) nxt = until - 1;
      if (nxt < since) break;
      until = nxt;
    }
    return [...out.values()];
  }
  async waitConnected(timeout = 10000) {
    const t0 = Date.now();
    while (!this.ws.size && Date.now() - t0 < timeout) await new Promise((r) => setTimeout(r, 100));
    return this.ws.size > 0;
  }
}
