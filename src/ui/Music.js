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

function songMenu(m, s) {
  const items = [];
  if (!s.disabled) items.push({ ic: '▶️', label: 'Play', fn: () => m.play(s.file) });
  items.push(s.disabled ? { ic: '✅', label: 'Enable (plays again)', fn: () => m.setDisabled(s.file, false) }
    : { ic: '🚫', label: "Disable (stays here, won't play)", fn: () => m.setDisabled(s.file, true) });
  if (s.url) items.push({ ic: '🔗', label: 'Open on YouTube', fn: () => window.open(s.url, '_blank') });
  items.push({ ic: '🗑', label: s.builtin ? 'Remove (can be restored)' : 'Remove', danger: true, fn: async () => {
    if (s.builtin || await ctx.confirm(`Remove "${s.title}"?`, { danger: true, ok: 'Remove' })) m.removeSong(s.file);
  } });
  ctx.menu(items, s.title);
}

export function MusicScreen() {
  useBus(['music']);
  const m = ctx.music;
  const [q, setQ] = useState('');
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  if (!m) return html`<div class="topbar"><h1>${I('🎵')} ${tr('Music')}</h1></div>`;
  const songs = m.songs();
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

    <div class="section">${I('📚')} ${tr('Library')} (${songs.length})</div>
    ${songs.length ? songs.map((s) => html`<div class="row card" style=${{ marginBottom: '6px', padding: '10px 12px', opacity: s.disabled ? 0.5 : 1, borderColor: s.file === cur ? 'var(--accent)' : 'var(--border)' }}
      ...${longPress(() => songMenu(m, s), () => (s.disabled ? songMenu(m, s) : m.play(s.file)))}>
      <span class="emoji" style=${{ fontSize: '1.3em' }}>${I(s.file === cur ? (m.target() > 0 ? '🔊' : '⏸') : s.disabled ? '🚫' : s.url ? '▶️' : s.builtin ? '⭐' : '🎵')}</span>
      <div class="grow" style=${{ minWidth: 0 }}><div class="ellipsis">${s.title}</div>
        <div class="small muted">${s.builtin ? tr('built-in') : s.url ? 'YouTube' : tr('your file')}${s.dur ? ' · ' + fmtDur(s.dur) : ''}${s.disabled ? ' · ' + tr('disabled') : ''}</div></div>
      <button class="iconbtn" onClick=${(e) => { e.stopPropagation(); songMenu(m, s); }}>⋮</button></div>`)
      : html`<div class="muted">${tr('no songs yet — add some!')}</div>`}

    <div class="section">${I('⚙️')} ${tr('Settings')}</div>
    <${Check} k="music_pause_in_call" label="Fade out during calls" onChange=${() => m.update()} />
    <${Check} k="music_pause_background" label="Pause when Lobby is in the background" onChange=${() => m.update()} />
  </div></div>`;
}
