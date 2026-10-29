// Status (like WhatsApp): rings above the chats, a full-screen viewer and a "new status" sheet.
// Same protocol as the PC app (kind 4448, gone after 24 h, end-to-end encrypted to each friend).
import { html, useBus, useState, useEffect, useRef } from './h.js';
import { I } from '../util/icons.js';
import { ctx } from '../ctx.js';
import { tr } from '../util/i18n.js';
import { fmtAgo } from '../util/format.js';
import { Avatar } from './common.js';
import { pickFiles } from '../util/files.js';
import { loadImage } from '../util/image.js';

export const BGS = ['#29e0ff', '#b44dff', '#ff4d7a', '#3dffa8', '#ffb84d', '#4d7cff', '#1b1060', '#111111'];
const DUR = 5500;

ctx.statuses = [];
let loading = null;
export function reloadStatus() {
  clearTimeout(loading);
  loading = setTimeout(async () => {
    try { ctx.statuses = await ctx.api('status_list', {}, { quiet: true }); ctx.bus.emit('status-list'); } catch (e) { /* offline */ }
  }, 250);
}
ctx.bus.on('store', (t) => { if (['init', 'synced', 'status', 'status_removed', 'status_views', 'relation'].includes(t)) reloadStatus(); });

function Ring({ user, unseen, add, label, onClick }) {
  return html`<div class="st-ring" onClick=${onClick}>
    <div class=${'st-av' + (unseen ? ' new' : '')}><${Avatar} user=${user} size=${54} presence=${false} />${add ? html`<i class="st-add">+</i>` : null}</div>
    <div class="tiny ellipsis">${label}</div></div>`;
}

export function StatusRow() {
  useBus(['status-list', 'store'], (ev, t) => ev === 'status-list' || t === 'user' || t === 'init');
  const st = ctx.store;
  if (!st.me) return null;
  const groups = ctx.statuses || [];
  const mine = groups.find((g) => g.user_id === st.myId);
  return html`<div class="st-row">
    <${Ring} user=${st.me} unseen=${!!mine} add=${!mine} label=${tr('My status')}
      onClick=${() => (mine ? openStatus(st.myId) : newStatus())} />
    ${mine ? html`<div class="st-ring" onClick=${newStatus}><div class="st-av plus">${I('➕')}</div><div class="tiny">${tr('New')}</div></div>` : null}
    ${groups.filter((g) => g.user_id !== st.myId).map((g) => html`<${Ring} key=${g.user_id} user=${st.users[g.user_id]} unseen=${g.unseen > 0}
      label=${st.name(g.user_id)} onClick=${() => openStatus(g.user_id)} />`)}
  </div>`;
}

export function openStatus(uid) {
  const groups = (ctx.statuses || []).map((g) => ({ ...g, items: g.items.map((i) => ({ ...i })) })).filter((g) => g.items.length);
  if (!groups.some((g) => g.user_id === uid)) return;
  ctx.sheet({ kind: 'status', groups, uid });
}

export function newStatus() { ctx.sheet({ kind: 'status-new' }); }

const media = {};   // id -> object URL
export function StatusViewer({ s }) {
  const st = ctx.store;
  const [gi, setGi] = useState(() => Math.max(0, s.groups.findIndex((g) => g.user_id === s.uid)));
  const [ii, setIi] = useState(() => {
    const g = s.groups[gi] || s.groups[0];
    return g.user_id === st.myId ? 0 : Math.max(0, g.items.findIndex((i) => !i.seen));
  });
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState('');
  const [, force] = useState(0);
  const bar = useRef(null);
  const g = s.groups[gi];
  const it = g && g.items[Math.min(ii, g.items.length - 1)];
  const mine = g && g.user_id === st.myId;
  const close = () => { ctx.closeSheet(s); reloadStatus(); };
  const step = (d) => {
    let ngi = gi, nii = ii + d;
    if (nii >= g.items.length) { ngi++; nii = 0; if (ngi >= s.groups.length) return close(); }
    else if (nii < 0) { ngi = Math.max(0, gi - 1); nii = 0; }
    setGi(ngi); setIi(nii); setReply(''); setPaused(false);
  };
  // seen + photo download
  useEffect(() => {
    if (!it) return;
    if (!it.seen && !mine) { it.seen = true; g.unseen = Math.max(0, g.unseen - 1); ctx.api('status_seen', { id: it.id }, { quiet: true }).catch(() => {}); }
    if (it.has_file && !media[it.id]) {
      media[it.id] = 'loading';
      ctx.api('status_media', { id: it.id }, { quiet: true })
        .then((r) => { media[it.id] = URL.createObjectURL(new Blob([r.bytes], { type: 'image/jpeg' })); force((x) => x + 1); })
        .catch(() => { delete media[it.id]; });
    }
  }, [gi, ii]);
  // progress / auto-advance (animation drives the bar so it's smooth; the timer moves on)
  useEffect(() => {
    if (paused || !it) return;
    const el = bar.current;
    if (el) { el.style.transition = 'none'; el.style.width = '0%'; void el.offsetWidth; el.style.transition = `width ${DUR}ms linear`; el.style.width = '100%'; }
    const t = setTimeout(() => step(1), DUR);
    return () => clearTimeout(t);
  }, [gi, ii, paused]);
  if (!it) return null;
  const u = st.users[g.user_id] || {};
  const tap = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    step(e.clientX - r.left < r.width * 0.3 ? -1 : 1);
  };
  const sendReply = async () => {
    const txt = reply.trim();
    if (!txt) return;
    const quote = it.text ? it.text.slice(0, 80) : it.kind === 'image' ? '📷 Photo' : 'status';
    const c = st.dmWith(g.user_id) || await ctx.api('open_dm', { user_id: g.user_id });
    await ctx.api('send', { chat_id: c.id, body: `> ↪ status: ${quote}\n${txt}` });
    ctx.toast(tr('Reply sent 💬'), 'ok');
    setReply(''); setPaused(false);
  };
  const showViews = () => {
    setPaused(true);
    const v = it.views || [];
    ctx.menu(v.length ? v.map((x) => ({ ic: '👁', label: `${st.name(x.user_id)} · ${fmtAgo(x.ts)}`, fn: () => setPaused(false) }))
      : [{ ic: '👁', label: tr('Nobody has seen it yet'), fn: () => setPaused(false) }], tr('Seen by'));
  };
  const del = async () => {
    setPaused(true);
    if (!(await ctx.confirm('Delete this status?', { danger: true }))) return setPaused(false);
    ctx.api('status_delete', { id: it.id });
    g.items.splice(ii, 1);
    if (!g.items.length) { s.groups.splice(gi, 1); if (!s.groups.length) return close(); setGi(Math.min(gi, s.groups.length - 1)); }
    setIi(0); setPaused(false); force((x) => x + 1);
  };
  const bg = it.bg || '#29e0ff';
  const src = media[it.id];
  return html`<div class="st-view">
    <div class="st-card" key=${it.id} style=${it.kind === 'image' ? { background: '#000' } : { background: `linear-gradient(135deg, ${bg}, ${shade(bg, -0.45)})` }}
      onClick=${tap} onPointerDown=${() => setPaused(true)} onPointerUp=${() => setPaused(false)}>
      ${it.kind === 'image' ? (src && src !== 'loading' ? html`<img src=${src} />` : html`<div class="st-load muted">${tr('loading photo…')}</div>`)
        : html`<div class="st-text" data-raw=${1} style=${{ color: light(bg) ? '#111' : '#fff', fontSize: it.text.length < 80 ? '2em' : '1.4em' }}>${it.text}</div>`}
      ${it.kind === 'image' && it.text ? html`<div class="st-cap" data-raw=${1}>${it.text}</div>` : null}
    </div>
    <div class="st-bars">${g.items.map((x, i) => html`<div class="st-bar"><i ref=${i === ii ? bar : null} style=${{ width: i < ii ? '100%' : i > ii ? '0%' : undefined }}></i></div>`)}</div>
    <div class="st-head"><${Avatar} user=${u} size=${38} presence=${false} />
      <div class="grow"><b>${mine ? tr('You') : st.name(g.user_id)}</b><div class="tiny" style=${{ opacity: 0.8 }}>${fmtAgo(it.created)}</div></div>
      ${mine ? html`<button class="iconbtn" onClick=${del}>${I('🗑')}</button>` : null}
      <button class="iconbtn" onClick=${close}>${I('✖')}</button></div>
    <div class="st-foot">
      ${mine ? html`<button class="btn" onClick=${showViews}>${I('👁')} ${(it.views || []).length} ${tr((it.views || []).length === 1 ? 'view' : 'views')}</button>`
        : html`<div class="row" style=${{ width: '100%' }}><input class="field grow" placeholder=${tr('Reply…')} value=${reply}
            onFocus=${() => setPaused(true)} onBlur=${() => !reply && setPaused(false)} onInput=${(e) => setReply(e.target.value)}
            onKeyDown=${(e) => e.key === 'Enter' && sendReply()} />
          <button class="btn primary" onClick=${sendReply}>${I('➤')}</button></div>`}
    </div></div>`;
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * (1 + f))));
  return `rgb(${ch(n >> 16)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
}
function light(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 175;
}

async function shrinkPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const sc = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), url: URL.createObjectURL(blob) };
  } finally { URL.revokeObjectURL(url); }
}

export function StatusNew({ s }) {
  const [text, setText] = useState('');
  const [bg, setBg] = useState(BGS[0]);
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const pick = async () => {
    const [f] = await pickFiles({ accept: 'image/*', multiple: false });
    if (!f) return;
    try { setPhoto(await shrinkPhoto(f)); } catch (e) { ctx.toast(tr("Couldn't read that picture"), 'error'); }
  };
  const post = async () => {
    if (!photo && !text.trim()) return ctx.toast(tr('Write something first'));
    setBusy(true);
    try {
      if (photo) await ctx.api('status_post', { kind: 'image', text: text.trim(), bytes: photo.bytes });
      else await ctx.api('status_post', { kind: 'text', text: text.trim(), bg });
      ctx.toast(tr('Status posted ✨'), 'ok');
      ctx.closeSheet(s);
      reloadStatus();
    } catch (e) { setBusy(false); }
  };
  return html`<div class="col">
    <b style=${{ fontSize: '1.2em' }}>${tr('New status')}</b>
    <div class="st-prev" style=${photo ? { background: '#000' } : { background: `linear-gradient(135deg, ${bg}, ${shade(bg, -0.45)})` }}>
      ${photo ? html`<img src=${photo.url} />${text ? html`<div class="st-cap" data-raw=${1}>${text}</div>` : null}`
        : html`<div class="st-text" data-raw=${1} style=${{ color: light(bg) ? '#111' : '#fff' }}>${text || tr('Type something…')}</div>`}
    </div>
    <textarea class="field" rows="3" placeholder=${tr("What's going on? (disappears after 24 h)")} value=${text} onInput=${(e) => setText(e.target.value)}></textarea>
    ${!photo ? html`<div class="row wrap" style=${{ gap: '8px' }}>${BGS.map((c) => html`<span class=${'st-swatch' + (c === bg ? ' on' : '')} style=${{ background: c }} onClick=${() => setBg(c)}></span>`)}</div>` : null}
    <div class="row"><button class="btn" onClick=${pick}>${I('🖼')} ${tr(photo ? 'Change photo' : 'Add a photo')}</button>
      ${photo ? html`<button class="btn" onClick=${() => setPhoto(null)}>${I('✖')}</button>` : null}
      <span class="grow"></span><button class="btn primary" disabled=${busy} onClick=${post}>${busy ? '…' : tr('Post status ✨')}</button></div>
    <div class="tiny muted">${tr('Only your friends can see it. End-to-end encrypted, gone after 24 hours.')}</div>
  </div>`;
}
