// The Smult Brain - language half (main-thread side). Training lives in langWorker.js.
import { rpc, mayTrain } from './rpc.js';
import { S } from '../util/settings.js';
import { normalize } from './langModel.js';
import { iterText, CHUNK, MAX_DOC_CHARS } from './docs.js';

export class LangBrain {
  constructor(ctx) {
    this.ctx = ctx;
    this.worker = new Worker(new URL('./langWorker.js', import.meta.url), { type: 'module' });
    this.call = rpc(this.worker);
    this.ready = fetch('./assets/brain/lang_genesis.f32').then((r) => r.arrayBuffer()).then((g) => this.call('init', { genesis: g }, [g]));
    this.asked = false; this.loading = false; this.loaded = false;
    this.st = { loaded: false, bpc: null, chars: 0, docs: 0, totalSteps: 0, mySteps: 0, unpublished: 0, contrib: {}, history: [], library: [], online: 0 };
    this.job = null;
    this.ticks = 0;
    setInterval(() => this.tick(), 15000);
    setInterval(() => this.syncTraining(), 3000);
    document.addEventListener('visibilitychange', () => this.syncTraining());
  }
  myName() { const me = this.ctx.store.me || {}; return me.display || me.username || 'me'; }
  load() { if (S.get('brain_train') || this.asked) this.ensureLoaded(true); }
  async ensureLoaded(force = false) {
    if ((this.asked && !force) || this.loading) return;
    this.asked = true; this.loading = true;
    try {
      await this.ready;
      const data = await this.ctx.api('lang_load', {}, { quiet: true });
      await this.call('load', { data, name: this.myName() });
      this.loaded = true;
      await this.call('tick', { first: true });
      await this.refresh();
      this.syncTraining();
    } catch (e) { console.warn('lang load', e); } finally { this.loading = false; }
  }
  syncTraining() {
    if (!this.loaded) return;
    const on = mayTrain(this.ctx, S);
    if (on !== this.training) { this.training = on; this.call('train', { on, name: this.myName() }).catch(() => {}); }
  }
  async refresh() {
    if (!this.loaded) return;
    try { this.st = await this.call('stats'); this.ctx.bus.emit('lang'); } catch (e) { /* */ }
  }
  async tick() {
    this.ticks++;
    if (!this.asked || !this.loaded) return;
    const train = S.get('brain_train');
    await this.call('tick', { train, first: this.ticks % 4 === 1, point: this.ticks % 4 === 0 && train }).catch(() => {});
    if (this.st.unpublished >= 200 && this.ticks % 3 === 0) {
      const content = await this.call('checkpoint', { name: this.myName() }).catch(() => null);
      if (content) this.ctx.try(this.ctx.api('lang_publish', { content }, { quiet: true }));
    }
    await this.refresh();
  }
  async addChunk(chunk) {
    if (!this.loaded) return;
    await this.call('add', { chunk });
    clearTimeout(this.rt);
    this.rt = setTimeout(() => this.refresh(), 800);
  }
  async mergeRemote(author, content, created) {
    if (!this.loaded) return;
    await this.call('merge', { author, content, created });
    this.refresh();
  }
  write(prompt, n, temp) { return this.call('write', { prompt, n, temp }); }
  nextLetters(text) { return this.call('next', { text }); }

  async teachText(text) {
    text = normalize(text).trim();
    const pieces = [];
    for (let i = 0; i < Math.min(text.length, MAX_DOC_CHARS); i += CHUNK) pieces.push(text.slice(i, i + CHUNK));
    let sent = 0;
    for (const t of pieces) {
      if (await this.call('dupe', { text: t })) continue;
      await this.ctx.api('lang_feed', { text: t, doc: 'pasted text' });
      sent++;
      await new Promise((r) => setTimeout(r, 500));
    }
    return sent;
  }

  // ---- feeding documents: read page by page, cut into ~6000-character chunks, send gently (like lang_import.py)
  startImport(files, paceMs = 500) {
    if (this.job) throw new Error('Already reading something — wait for it or stop it first');
    const job = {
      files, file: '', page: 0, pages: 0, filesDone: 0, charsRead: 0, sent: 0, sentChars: 0, dupes: 0, failed: [], capped: [],
      paused: false, cancelled: false, done: false, t0: Date.now(),
    };
    this.job = job;
    const emit = () => this.ctx.bus.emit('langjob', job);
    const send = async (doc, text) => {
      while (job.paused && !job.cancelled) await new Promise((r) => setTimeout(r, 200));
      if (job.cancelled) return;
      if (await this.call('dupe', { text })) { job.dupes++; return; }
      const t = Date.now();
      try {
        await this.ctx.api('lang_feed', { text, doc }, { quiet: true });
        job.sent++; job.sentChars += text.length;
      } catch (e) { job.failed.push(['(sending)', String(e.message || e).slice(0, 80)]); }
      emit();
      const wait = paceMs - (Date.now() - t);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    };
    (async () => {
      for (const f of files) {
        if (job.cancelled) break;
        job.file = f.name; job.page = 0; job.pages = 0;
        emit();
        let buf = '', total = 0;
        try {
          for await (const piece of iterText(f, job)) {
            if (job.cancelled) break;
            buf += normalize(piece);
            while (buf.length >= CHUNK) {
              let cut = buf.lastIndexOf(' ', CHUNK);
              if (cut < CHUNK * 0.8) cut = CHUNK;
              const chunk = buf.slice(0, cut).trim();
              buf = buf.slice(cut);
              if (chunk) { total += chunk.length; job.charsRead += chunk.length; await send(f.name, chunk); }
              if (job.cancelled) break;
            }
            if (total >= MAX_DOC_CHARS) { job.capped.push(f.name); buf = ''; break; }
          }
          if (buf.trim() && !job.cancelled) { job.charsRead += buf.trim().length; total += buf.trim().length; await send(f.name, buf.trim()); }
          if (total === 0) job.failed.push([f.name, 'no readable text (scanned PDF?)']);
        } catch (e) { job.failed.push([f.name, String(e.message || e).slice(0, 80) || 'unreadable']); }
        job.filesDone++;
        emit();
      }
      job.done = true;
      this.job = null;
      emit();
      this.ctx.toast(`📚 Taught ${job.sentChars.toLocaleString()} characters`, job.sent ? 'ok' : 'info', 5000);
    })();
    return job;
  }
}
