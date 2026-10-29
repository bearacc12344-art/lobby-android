// Background music (port of music.py): loops while Smult is open, fades out during calls, chat audio, or in the background.
// Library = the built-in song + songs you add (files from your phone, or YouTube downloads on Android).
import { Capacitor } from '@capacitor/core';
import { S } from './util/settings.js';
import { idb } from './net/idb.js';
import { isNative, LobbyNative } from './native.js';

export const BUILTIN = 'builtin';
const BUILTIN_URL = './assets/music/No More Remastered.mp3';
export const looksLikeLink = (t) => /^\s*(https?:\/\/)?([\w-]+\.)*(youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(t);

export function friendlyError(msg) {
  const m = String(msg || '');
  const low = m.toLowerCase();
  if (low.includes('not implemented') || low.includes('not available')) return 'YouTube downloads only work in the Android app';
  if (low.includes('bot') && low.includes('confirm')) return "YouTube is asking for a 'not a robot' check on your internet right now — try again later";
  if (low.includes('private') || low.includes('unavailable') || low.includes('removed')) return 'that video is private or unavailable';
  if (low.includes('age')) return "that video is age-restricted, YouTube won't let apps download it";
  if (low.includes('too long') || low.includes('too big')) return 'that one is too long (over 60 MB of audio)';
  if (low.includes('unknownhost') || low.includes('timeout') || low.includes('network') || low.includes('connect')) return "can't reach YouTube — check your internet";
  return m.slice(0, 200) || 'something went wrong';
}

export class Music {
  constructor(ctx) {
    this.ctx = ctx;
    this.el = new Audio();
    this.el.preload = 'auto';
    this.el.volume = 0;
    this.el.addEventListener('ended', () => this.onEnded());
    this.el.addEventListener('error', () => { this.error = 'This song could not be played'; this.emit(); });
    this.ducked = false;
    this.cur = null;            // file id currently loaded
    this.url = null;            // blob url to revoke
    this.fade = null;
    this.busy = false;          // youtube job running
    this.job = null;
    this.unlocked = false;
    document.addEventListener('visibilitychange', () => this.update());
    const unlock = () => { this.unlocked = true; this.update(); window.removeEventListener('pointerdown', unlock, true); };
    window.addEventListener('pointerdown', unlock, true);
    if (isNative) {
      LobbyNative.addListener('ytProgress', (e) => { if (this.job) { this.job.frac = e.frac; this.job.text = e.text || this.job.text; this.emit(); } }).catch(() => {});
    }
    this.load();
  }
  emit() { this.ctx.bus.emit('music'); }

  // ---- library
  songs() {
    const off = new Set(S.get('music_disabled') || []);
    let lib = (S.get('music_library') || []).filter((s) => s && s.file);
    if (!S.get('music_builtin_hidden')) lib = [{ title: 'No More Remastered', file: BUILTIN, url: '', dur: 0, builtin: true }, ...lib];
    return lib.map((s) => ({ ...s, disabled: off.has(s.file) }));
  }
  enabled() { return this.songsIn(S.get('music_playlist') || '').filter((s) => !s.disabled); }

  // ---- folders / playlists (same shape as PC Smult)
  playlists() { return [...(S.get('playlists') || [])]; }
  playlist(id) { return this.playlists().find((p) => p.id === id) || null; }
  songsIn(id) {
    const all = this.songs();
    const pl = id && this.playlist(id);
    if (!pl) return all;
    const by = new Map(all.map((s) => [s.file, s]));
    return (pl.songs || []).map((f) => by.get(f)).filter(Boolean);
  }
  savePl(pls) { S.set('playlists', pls); this.emit(); }
  newPlaylist(name, songs = [], color = '') {
    const id = Math.random().toString(16).slice(2, 10);
    this.savePl([...this.playlists(), { id, name: (name || 'New playlist').slice(0, 40), songs: [...songs], color }]);
    return id;
  }
  renamePlaylist(id, name) { this.savePl(this.playlists().map((p) => (p.id === id ? { ...p, name: name.slice(0, 40) } : p))); }
  deletePlaylist(id) { if (S.get('music_playlist') === id) S.set('music_playlist', ''); this.savePl(this.playlists().filter((p) => p.id !== id)); }
  addToPlaylist(id, files) { this.savePl(this.playlists().map((p) => (p.id === id ? { ...p, songs: [...(p.songs || []), ...files.filter((f) => !(p.songs || []).includes(f))] } : p))); }
  removeFromPlaylist(id, files) { this.savePl(this.playlists().map((p) => (p.id === id ? { ...p, songs: (p.songs || []).filter((f) => !files.includes(f)) } : p))); }
  moveInPlaylist(id, f, step) {
    this.savePl(this.playlists().map((p) => {
      if (p.id !== id) return p;
      const a = [...(p.songs || [])], i = a.indexOf(f), j = i + step;
      if (i < 0 || j < 0 || j >= a.length) return p;
      [a[i], a[j]] = [a[j], a[i]];
      return { ...p, songs: a };
    }));
  }
  playPlaylist(id, f) {
    S.set('music_playlist', id || '');
    const files = this.enabled().map((s) => s.file);
    if (!files.length) { this.emit(); return false; }
    return this.play(files.includes(f) ? f : files[0]);
  }
  track() {
    const f = S.get('music_file') || '';
    const ok = this.enabled().map((s) => s.file);
    if (f && ok.includes(f)) return f;
    return ok[0] || '';
  }
  trackName() {
    const t = this.track();
    if (!t) return this.songs().length ? 'no song (all disabled)' : 'no songs';
    const s = this.songs().find((x) => x.file === t);
    return s ? s.title : t;
  }
  setDisabled(f, off) {
    const d = (S.get('music_disabled') || []).filter((x) => x !== f);
    if (off) d.push(f);
    S.set('music_disabled', d);
    this.load(); this.emit();
  }
  restoreBuiltin() { S.set('music_builtin_hidden', false); this.load(); this.emit(); }
  addSong(song, play = false) {
    const lib = (S.get('music_library') || []).filter((s) => s.file !== song.file);
    lib.push(song);
    S.set('music_library', lib);
    if (this.addTarget && this.playlist(this.addTarget)) this.addToPlaylist(this.addTarget, [song.file]);   // added while a folder is open
    if (play) this.play(song.file);
    this.emit();
  }
  async removeSong(f) {
    if (f === BUILTIN) {
      S.set('music_builtin_hidden', true);
    } else {
      S.set('music_library', (S.get('music_library') || []).filter((s) => s.file !== f));
      S.set('playlists', this.playlists().map((p) => ({ ...p, songs: (p.songs || []).filter((x) => x !== f) })));
      if (f.startsWith('idb:')) await idb.del('kv', f.slice(4)).catch(() => {});
      if (f.startsWith('path:') && isNative) LobbyNative.deleteFile({ path: f.slice(5) }).catch(() => {});
    }
    S.set('music_disabled', (S.get('music_disabled') || []).filter((x) => x !== f));
    if (S.get('music_file') === f) S.set('music_file', '');
    if (this.cur === f) this.load();
    this.emit();
  }
  async addFiles(files) {
    let n = 0;
    for (const file of files) {
      if (file.size > 60 * 1024 * 1024) { this.ctx.toast(`${file.name} is too big (max 60 MB)`, 'error'); continue; }
      const key = 'song:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      await idb.put('kv', key, new Uint8Array(await file.arrayBuffer()));
      const dur = await probeDuration(file);
      this.addSong({ title: file.name.replace(/\.[^.]+$/, ''), file: 'idb:' + key, url: '', dur, mime: file.type }, n === 0);
      n++;
    }
    return n;
  }

  // ---- playback
  play(f) {
    if ((S.get('music_disabled') || []).includes(f)) return false;
    S.set('music_file', f);
    if (!S.get('music')) S.set('music', true);
    this.load(); this.emit();
    return true;
  }
  next(step = 1) {
    const files = this.enabled().map((s) => s.file);
    if (files.length < 2) { this.el.currentTime = 0; return this.update(); }
    let f;
    if (S.get('music_mode') === 'shuffle') {
      const rest = files.filter((x) => x !== this.track());
      f = rest[Math.floor(Math.random() * rest.length)];
    } else {
      const i = files.indexOf(this.track());
      f = files[(i + step + files.length) % files.length];
    }
    this.play(f);
  }
  onEnded() {
    if (S.get('music_mode') === 'loop' || this.enabled().length < 2) { this.el.currentTime = 0; this.el.play().catch(() => {}); } else this.next();
  }
  async srcFor(f) {
    if (f === BUILTIN) return BUILTIN_URL;
    if (f.startsWith('path:')) return Capacitor.convertFileSrc(f.slice(5));
    if (f.startsWith('idb:')) {
      const bytes = await idb.get('kv', f.slice(4));
      if (!bytes) throw new Error('song file is missing');
      const s = this.songs().find((x) => x.file === f);
      return URL.createObjectURL(new Blob([bytes], { type: (s && s.mime) || 'audio/mpeg' }));
    }
    return f;
  }
  async load() {
    const t = this.track();
    this.error = null;
    if (t === this.cur && this.el.src) return this.update(false);
    this.el.pause();
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
    this.cur = t;
    if (!t) { this.el.removeAttribute('src'); this.el.load(); return this.emit(); }
    try {
      const src = await this.srcFor(t);
      if (this.cur !== t) return;
      if (src.startsWith('blob:')) this.url = src;
      this.el.src = src;
      this.el.loop = false;
      this.el.volume = 0;
    } catch (e) { this.error = String(e.message || e); }
    this.update(false);
    this.emit();
  }
  duck(on) { if (this.ducked !== on) { this.ducked = on; this.update(); } }
  target() {
    if (!S.get('music') || this.ducked || !this.track()) return 0;
    if (S.get('music_pause_in_call') && this.ctx.call) return 0;
    if (S.get('music_pause_background') && document.hidden) return 0;
    const v = S.get('music_volume') / 100;
    return v * v;
  }
  update(fade = true) {
    const t = this.target();
    clearInterval(this.fade);
    if (t > 0 && this.el.paused && this.el.src) {
      this.el.play().then(() => { this.unlocked = true; }).catch(() => { /* waits for a tap (autoplay rules) */ });
    }
    if (!fade || document.hidden) {
      this.el.volume = Math.min(1, t);
      if (t === 0) this.el.pause();
      return;
    }
    const start = this.el.volume, dur = t > 0 ? 1200 : 700, t0 = performance.now();
    this.fade = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / dur);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      this.el.volume = Math.max(0, Math.min(1, start + (t - start) * e));
      if (k >= 1) { clearInterval(this.fade); if (t === 0) this.el.pause(); }
    }, 40);
  }
  toggle() { S.set('music', !S.get('music')); this.update(); this.emit(); return S.get('music'); }
  get playing() { return !this.el.paused && this.el.volume > 0.001; }

  // ---- YouTube (Android app: NewPipe extractor in native code, downloads the audio so it plays offline)
  async youtube(text, play = true) {
    if (this.busy || !text.trim()) return false;
    if (!isNative) { this.ctx.toast('YouTube downloads only work in the Android app (in the browser you can add files)', 'error', 5000); return false; }
    this.busy = true;
    const job = this.job = { frac: 0, text: looksLikeLink(text) ? 'looking up the link…' : 'searching YouTube…', cancel: false, added: 0, error: '' };
    this.emit();
    try {
      const { items } = await LobbyNative.ytResolve({ q: text.trim() });
      if (!items || !items.length) throw new Error('nothing found for that');
      for (let i = 0; i < items.length && !job.cancel; i++) {
        const it = items[i];
        const pre = items.length > 1 ? `song ${i + 1}/${items.length} · ` : '';
        job.text = `${pre}downloading ${it.title.slice(0, 60)}…`;
        job.frac = i / items.length;
        this.emit();
        const existing = this.songs().find((s) => s.ytid === it.id);
        if (existing) { job.added++; if (play && job.added === 1) this.play(existing.file); continue; }
        try {
          const r = await LobbyNative.ytDownload({ url: it.url, id: it.id, n: items.length, i });
          job.added++;
          this.addSong({ title: r.title || it.title, file: 'path:' + r.path, url: it.url, dur: r.dur || it.dur || 0, ytid: it.id, mime: r.mime }, play && job.added === 1);
        } catch (e) {
          if (items.length === 1) throw e;
        }
      }
      if (job.cancel) job.error = 'cancelled';
    } catch (e) {
      job.error = friendlyError(e.message || e);
    }
    this.busy = false;
    job.done = true;
    this.emit();
    if (job.error && job.error !== 'cancelled') this.ctx.toast('🎵 ' + job.error, 'error', 5000);
    else if (job.added) this.ctx.toast(`🎵 Added ${job.added} song${job.added > 1 ? 's' : ''}`, 'ok');
    return true;
  }
  cancelYoutube() { if (this.job) { this.job.cancel = true; LobbyNative.ytCancel && LobbyNative.ytCancel().catch(() => {}); } }
}

function probeDuration(file) {
  return new Promise((res) => {
    const a = new Audio();
    const u = URL.createObjectURL(file);
    a.preload = 'metadata';
    a.onloadedmetadata = () => { res(Number.isFinite(a.duration) ? Math.round(a.duration) : 0); URL.revokeObjectURL(u); };
    a.onerror = () => { res(0); URL.revokeObjectURL(u); };
    a.src = u;
    setTimeout(() => res(0), 4000);
  });
}
