// 🎵 Music tab (port of the PC music page): now playing, YouTube, your files, the library
import { I } from '../util/icons.js';
import { html, useBus, useEffect, useState } from './h.js';
import { ctx } from '../ctx.js';
import { S } from '../util/settings.js';
import { tr } from '../util/i18n.js';
import { fmtDur } from '../util/format.js';
import { pickFiles } from '../util/files.js';
import { Check, Slider } from './common.js';
import { longPress } from './press.js';
import { isNative } from '../native.js';

const COLORS = ['#29e0ff', '#b44dff', '#ff4d7a', '#3dffa8', '#ffb84d', '#4d7cff', '#e0a94a', '#9aa3ad'];

function songMenu(m, s, view = '') {
  const items = [];
  if (!s.disabled) items.push({ ic: '▶️', label: 'Play', fn: () => m.playPlaylist(view, s.file) });
  const others = m.playlists().filter((p) => p.id !== view);
  items.push({ ic: '📁', label: 'Add to folder…', fn: () => ctx.menu([
    ...others.map((p) => ({ ic: '📁', label: p.name, fn: () => { m.addToPlaylist(p.id, [s.file]); ctx.toast(`📁 Added to ${p.name}`, 'ok'); } })),
    { ic: '➕', label: 'New folder with this song', fn: () => newFolder(m, [s.file]) }], tr('Add to folder')) });
  if (view) {
    items.push({ ic: '⬆', label: 'Move up', fn: () => m.moveInPlaylist(view, s.file, -1) });
    items.push({ ic: '⬇', label: 'Move down', fn: () => m.moveInPlaylist(view, s.file, 1) });
    items.push({ ic: '➖', label: 'Take out of this folder', fn: () => m.removeFromPlaylist(view, [s.file]) });
  }
  items.push(s.disabled ? { ic: '✅', label: 'Enable (plays again)', fn: () => m.setDisabled(s.file, false) }
    : { ic: '🚫', label: "Disable (stays here, won't play)", fn: () => m.setDisabled(s.file, true) });
  if (s.url) items.push({ ic: '🔗', label: 'Open on YouTube', fn: () => window.open(s.url, '_blank') });
  items.push({ ic: '🗑', label: s.builtin ? 'Remove (can be restored)' : 'Remove', danger: true, fn: async () => {
    if (s.builtin || await ctx.confirm(`Remove "${s.title}"?`, { danger: true, ok: 'Remove' })) m.removeSong(s.file);
  } });
  ctx.menu(items, s.title);
}

async function newFolder(m, songs = []) {
  const name = await ctx.prompt('New folder', { placeholder: 'Name it (e.g. Gaming)' });
  if (name && name.trim()) return m.newPlaylist(name.trim(), songs, COLORS[m.playlists().length % COLORS.length]);
  return null;
}

function folderMenu(m, p, setView) {
  ctx.menu([
    { ic: '▶️', label: 'Play this folder', fn: () => m.playPlaylist(p.id) },
    { ic: '✏️', label: 'Rename', fn: async () => { const n = await ctx.prompt('Rename folder', { value: p.name }); if (n && n.trim()) m.renamePlaylist(p.id, n.trim()); } },
    { ic: '🎨', label: 'Colour', fn: () => ctx.menu(COLORS.map((c) => ({ ic: '🎨', label: c, right: html`<span style=${{ width: '18px', height: '18px', borderRadius: '9px', background: c }}></span>`,
      fn: () => m.savePl(m.playlists().map((x) => (x.id === p.id ? { ...x, color: c } : x))) })), tr('Colour')) },
    { ic: '🗑', label: 'Delete folder (songs stay)', danger: true, fn: () => { m.deletePlaylist(p.id); setView(''); } },
  ], p.name);
}

export function MusicScreen() {
  useBus(['music']);
  const m = ctx.music;
  const [q, setQ] = useState('');
  const [view, setView] = useState(S.get('music_playlist') || '');
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  if (!m) return html`<div class="topbar"><h1>${I('🎵')} ${tr('Music')}</h1></div>`;
  if (view && !m.playlist(view)) setTimeout(() => setView(''), 0);
  m.addTarget = view;
  const songs = m.songsIn(view);
  const pl = m.playlist(view);
  const playingPl = S.get('music_playlist') || '';
  const cur = m.track();
  const el = m.el;
  const on = S.get('music');
  const mode = S.get('music_mode') || 'loop';
  const job = m.job;
  const go = async () => { if (await m.youtube(q)) setQ(''); };
  return html`<div class="topbar"><h1>${I('🎵')} ${tr('Music')}</h1></div>
  <div class="content"><div class="pad">
    <div class="card" style=${{ textAlign: 'center' }}>
      <div class="small muted">${tr(on ? (m.target() > 0 ? 'Now playing' : 'Paused right now') : 'Music is off')}</div>
      <div style=${{ fontSize: '1.25em', fontWeight: 700, margin: '6px 0' }} class="ellipsis">${I('🎶')} ${m.trackName()}</div>
      ${m.error ? html`<div class="small" style=${{ color: 'var(--danger)' }}>${tr(m.error)}</div>` : null}
      ${el.duration ? html`<input type="range" min="0" max=${Math.floor(el.duration)} value=${Math.floor(el.currentTime)} onInput=${(e) => { el.currentTime = +e.target.value; }} style=${{ width: '100%' }} />
        <div class="row small muted"><span>${fmtDur(el.currentTime)}</span><span class="grow"></span><span>${fmtDur(el.duration)}</span></div>` : null}
      <div class="row" style=${{ justifyContent: 'center', gap: '18px', margin: '8px 0' }}>
        <button class="iconbtn" style=${{ fontSize: '1.6em' }} onClick=${() => m.next(-1)}>${I('⏮')}</button>
        <button class="iconbtn green" style=${{ fontSize: '1.8em', width: '64px', height: '64px', borderRadius: '32px' }} onClick=${() => m.toggle()}>${I(on ? '⏸' : '▶️')}</button>
        <button class="iconbtn" style=${{ fontSize: '1.6em' }} onClick=${() => m.next(1)}>${I('⏭')}</button>
      </div>
      <div class="row" style=${{ justifyContent: 'center', gap: '6px' }}>
        ${[['loop', '🔂', 'Repeat one'], ['next', '🔁', 'Play all'], ['shuffle', '🔀', 'Shuffle']].map(([k, ic, l]) => html`<button class=${'chip' + (mode === k ? ' on' : '')}
          onClick=${() => { S.set('music_mode', k); m.emit(); }}>${ic} ${tr(l)}</button>`)}
      </div>
      <div style=${{ textAlign: 'left' }}><${Slider} k="music_volume" label="🔊 Volume" min=${0} max=${100} suffix="%" onChange=${() => m.update(false)} /></div>
    </div>

    <div class="section">${I('▶️')} ${tr('Add from YouTube')}</div>
    <div class="row">
      <input class="field grow" placeholder=${tr('song name or YouTube / playlist link')} value=${q} onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && go()} disabled=${m.busy} />
      <button class="btn primary" onClick=${go} disabled=${m.busy || !q.trim()}>${tr('Add')}</button>
    </div>
    ${!isNative ? html`<div class="small muted" style=${{ marginTop: '4px' }}>${tr('YouTube downloads work in the Android app. Here you can add music files.')}</div>` : null}
    ${job && !job.done ? html`<div class="card" style=${{ marginTop: '8px' }}><div class="small">${job.text}</div>
      <div class="progress" style=${{ margin: '8px 0' }}><i style=${{ width: Math.round((job.frac || 0) * 100) + '%' }}></i></div>
      <button class="btn small flat" onClick=${() => m.cancelYoutube()}>${I('✖')} ${tr('Cancel')}</button></div>` : null}
    <div class="row" style=${{ marginTop: '8px' }}>
      <button class="btn" onClick=${async () => { const f = await pickFiles({ accept: 'audio/*' }); if (f.length) { const n = await m.addFiles(f); if (n) ctx.toast(`🎵 Added ${n} song${n > 1 ? 's' : ''}`, 'ok'); } }}>${I('📁')} ${tr('Add music files')}</button>
      ${S.get('music_builtin_hidden') ? html`<button class="btn flat" onClick=${() => m.restoreBuiltin()}>${I('↩️')} ${tr('Bring back the built-in song')}</button>` : null}
    </div>

    <div class="section">${I('📁')} ${tr('Folders')}</div>
    <div class="folders">
      <button class=${'folder' + (!view ? ' on' : '')} onClick=${() => setView('')}>${I('🎵')} ${tr('All songs')}<small>${m.songs().length}</small></button>
      ${m.playlists().map((p) => html`<button class=${'folder' + (view === p.id ? ' on' : '')} style=${{ '--fc': p.color || 'var(--accent)' }}
        ...${longPress(() => folderMenu(m, p, setView), () => setView(p.id))}>${I('📁')} ${p.name}<small>${m.songsIn(p.id).length}${playingPl === p.id && m.target() > 0 ? ' · ♪' : ''}</small></button>`)}
      <button class="folder add" onClick=${async () => { const id = await newFolder(m); if (id) setView(id); }}>${I('➕')} ${tr('New folder')}</button>
    </div>
    <div class="row" style=${{ margin: '12px 0 6px' }}>
      <b class="grow" style=${{ fontSize: '1.1em' }}>${pl ? pl.name : tr('All songs')} <span class="small muted">(${songs.length})</span></b>
      ${pl ? html`<button class="iconbtn" onClick=${() => folderMenu(m, pl, setView)}>⋮</button>` : null}
      <button class="btn small" disabled=${songs.length < 2} onClick=${() => { S.set('music_mode', 'shuffle'); m.playPlaylist(view); m.next(); }}>${I('🔀')}</button>
      <button class="btn primary small" disabled=${!songs.length} onClick=${() => m.playPlaylist(view)}>${I('▶️')} ${tr('Play')}</button>
    </div>
    ${view ? html`<div class="small muted" style=${{ marginBottom: '6px' }}>${tr('Songs you add here (YouTube or files) go into this folder too. Long-press a song to move it.')}</div>` : null}
    ${songs.length ? songs.map((s) => html`<div class="row card" style=${{ marginBottom: '6px', padding: '10px 12px', opacity: s.disabled ? 0.5 : 1, borderColor: s.file === cur ? 'var(--accent)' : 'var(--border)' }}
      ...${longPress(() => songMenu(m, s, view), () => (s.disabled ? songMenu(m, s, view) : m.playPlaylist(view, s.file)))}>
      <span class="emoji" style=${{ fontSize: '1.3em' }}>${I(s.file === cur ? (m.target() > 0 ? '🔊' : '⏸') : s.disabled ? '🚫' : s.url ? '▶️' : s.builtin ? '⭐' : '🎵')}</span>
      <div class="grow" style=${{ minWidth: 0 }}><div class="ellipsis">${s.title}</div>
        <div class="small muted">${s.builtin ? tr('built-in') : s.url ? 'YouTube' : tr('your file')}${s.dur ? ' · ' + fmtDur(s.dur) : ''}${s.disabled ? ' · ' + tr('disabled') : ''}</div></div>
      <button class="iconbtn" onClick=${(e) => { e.stopPropagation(); songMenu(m, s, view); }}>⋮</button></div>`)
      : html`<div class="muted">${tr(view ? 'empty folder — long-press songs in All songs → Add to folder' : 'no songs yet — add some!')}</div>`}

    <div class="section">${I('⚙️')} ${tr('Settings')}</div>
    <${Check} k="music_pause_in_call" label="Fade out during calls" onChange=${() => m.update()} />
    <${Check} k="music_pause_background" label="Pause when Smult is in the background" onChange=${() => m.update()} />
  </div></div>`;
}
