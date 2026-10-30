// the sticker sheet (like WhatsApp's): Recent + All, tap to send, long-press to remove / move, ➕ to make new ones
import { html, useEffect, useState } from './h.js';
import { I } from '../util/icons.js';
import { ctx } from '../ctx.js';
import { tr } from '../util/i18n.js';
import { pickFiles } from '../util/files.js';
import { longPress } from './press.js';
import { list, recent, addFiles, remove, toFront, mimeOfSticker } from '../stickers.js';

function Tile({ e, onPick, onMenu }) {
  const [url] = useState(() => URL.createObjectURL(new Blob([e.bytes], { type: mimeOfSticker(e) })));
  useEffect(() => () => URL.revokeObjectURL(url), []);
  return html`<button class="stile" ...${longPress(() => onMenu(e), () => onPick(e))}><img src=${url} alt="" /></button>`;
}

export function StickerSheet({ s }) {
  const [all, setAll] = useState(null);
  const [msg, setMsg] = useState('');
  const load = () => list().then(setAll);
  useEffect(() => { load(); }, []);
  const pick = (e) => { ctx.closeSheet(s); s.onPick(e); };
  const menu = (e) => ctx.menu([
    { ic: '⬆️', label: 'Move to the front', fn: async () => { await toFront(e); load(); } },
    { ic: '🗑️', label: 'Remove sticker', danger: true, fn: async () => { await remove(e.id); load(); } },
  ], tr('Sticker'));
  async function add() {
    const files = await pickFiles({ accept: 'image/*' });
    if (!files.length) return;
    setMsg(tr('making stickers…'));
    const [n, errs] = await addFiles(files);
    setMsg(errs.length ? '⚠️ ' + errs.slice(0, 2).join(' · ') : '');
    if (n) ctx.toast(`🎴 ${n} new sticker${n > 1 ? 's' : ''}`, 'ok');
    load();
  }
  const rec = all && all.length > 8 ? recent(all) : [];
  const grid = (items) => html`<div class="sgrid">${items.map((e) => html`<${Tile} key=${e.id} e=${e} onPick=${pick} onMenu=${menu} />`)}</div>`;
  return html`<div style=${{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <div class="row" style=${{ padding: '10px 10px 0', gap: '8px' }}>
      <b style=${{ fontSize: '1.05em' }}>${I('🎴')} ${tr('Stickers')}</b>
      <span class="spacer"></span>
      <button class="btn small primary" onClick=${add}>${I('➕')} ${tr('Add')}</button>
      <button class="iconbtn" onClick=${() => ctx.closeSheet(s)}>${I('✖️')}</button></div>
    ${msg ? html`<div class="small muted" style=${{ padding: '6px 12px' }}>${msg}</div>` : null}
    <div style=${{ flex: 1, overflowY: 'auto', padding: '0 4px' }}>
      ${all && !all.length ? html`<div class="empty">${tr('No stickers yet. Tap ➕ Add to turn pictures or GIFs into stickers, or long-press any picture in a chat → 🎴 Add to stickers.')}</div>` : null}
      ${rec.length ? html`<div class="section">${tr('Recent')}</div>${grid(rec)}` : null}
      ${all && all.length ? html`<div class="section">${tr('All stickers')}</div>${grid(all)}` : null}
    </div>
    <div class="tiny muted" style=${{ padding: '6px 12px calc(6px + env(safe-area-inset-bottom))' }}>${tr('Long-press a sticker to remove it')}</div>
  </div>`;
}
