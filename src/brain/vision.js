// The Lobby Brain (pictures) - main-thread side. Training/scoring happen in visionWorker.js.
import { rpc, mayTrain } from './rpc.js';
import { S } from '../util/settings.js';
import { b64 } from './pics.js';
import { NOTHING, MAX_LABELS } from './visionModel.js';

export class VisionBrain {
  constructor(ctx) {
    this.ctx = ctx;
    this.worker = new Worker(new URL('./visionWorker.js', import.meta.url), { type: 'module' });
    this.call = rpc(this.worker);
    this.ready = this.init();
    this.asked = false;
    this.loading = false;
    this.loaded = false;
    this.st = { loaded: false, labels: [], userLabels: [], counts: {}, classAcc: {}, contrib: {}, history: [], nEx: 0, totalSteps: 0, mySteps: 0, unpublished: 0, online: 0 };
    this.ticks = 0;
    this.timer = setInterval(() => this.tick(), 15000);
    this.trainTimer = setInterval(() => this.syncTraining(), 3000);
    document.addEventListener('visibilitychange', () => this.syncTraining());
  }
  async init() {
    const base = './assets/brain/';
    const [g, n] = await Promise.all([fetch(base + 'vision_genesis.f32'), fetch(base + 'nothing.u8')].map((p) => p.then((r) => r.arrayBuffer())));
    await this.call('init', { genesis: g, nothing: n }, [g, n]);
  }
  myName() { const me = this.ctx.store.me || {}; return me.display || me.username || 'me'; }
  // called on every (re)connect: only loads the library if you train or opened the Brain page
  load() { if (S.get('brain_train') || this.asked) this.ensureLoaded(true); }
  async ensureLoaded(force = false) {
    if ((this.asked && !force) || this.loading) return;
    this.asked = true;
    this.loading = true;
    try {
      await this.ready;
      const data = await this.ctx.api('brain_load', {}, { quiet: true });
      await this.call('load', { data, name: this.myName() });
      this.loaded = true;
      await this.refresh(true);
      this.syncTraining();
    } catch (e) { console.warn('brain load', e); } finally { this.loading = false; }
  }
  syncTraining() {
    if (!this.loaded) return;
    const on = mayTrain(this.ctx, S);
    if (on !== this.training) { this.training = on; this.call('train', { on, name: this.myName() }).catch(() => {}); }
  }
  async refresh(recent = false) {
    if (!this.loaded) return;
    try {
      const st = await this.call('stats', { recent });
      if (!recent && this.st.recent) st.recent = this.st.recent;
      this.st = st;
      this.ctx.bus.emit('brain');
    } catch (e) { /* worker busy/closing */ }
  }
  async tick() {
    this.ticks++;
    if (!this.asked || !this.loaded) return;
    const train = S.get('brain_train');
    if (train || this.ticks % 4 === 1) await this.call('housekeeping', { point: this.ticks % 4 === 0 && train }).catch(() => {});
    if (this.st.unpublished >= 60 && this.ticks % 3 === 0) await this.publish();
    await this.refresh(this.ticks % 2 === 0);
  }
  async publish() {
    const content = await this.call('checkpoint', { name: this.myName() }).catch(() => null);
    if (content) this.ctx.try(this.ctx.api('brain_publish', { content }, { quiet: true }));
  }
  async addExample(ex) {
    if (!this.loaded) return;
    await this.call('add', { ex });
    clearTimeout(this.rt);
    this.rt = setTimeout(() => this.refresh(true), 600);
  }
  async mergeRemote(author, content, created) {
    if (!this.loaded) return;
    await this.call('merge', { author, content, created });
    this.refresh();
  }
  think(x) {
    // x: Uint8Array 3072 (32x32 RGB)
    const f = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) f[i] = x[i] / 255;
    return this.call('think', { x: f.buffer }, [f.buffer]);
  }
  canLearn(label) {
    const l = label.trim().toLowerCase();
    return this.st.labels.includes(l) || this.st.labels.length < MAX_LABELS;
  }
  async isDupe(label, x) { return this.call('dupe', { label: label.trim().toLowerCase().slice(0, 16), px: b64(x) }); }
  async feed(label, x, quiet = false) {
    await this.ctx.api('brain_feed', { label, px: b64(x) });
    if (!quiet) this.ctx.toast(`🧠 Taught it: ${label}`, 'ok');
  }
  userLabels() { return this.st.userLabels || []; }
  static NOTHING = NOTHING;
}
