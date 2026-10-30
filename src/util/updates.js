// phone updates: the Smult owner sends a new APK from PC Smult -> every phone gets "update available" and installs it
import { html, useState } from '../ui/h.js';
import { ctx } from '../ctx.js';
import { APP_VERSION } from '../version.js';
import { isNative, LobbyNative } from '../native.js';
import { b64 } from '../net/crypto.js';
import { tr } from './i18n.js';
import { I } from './icons.js';
import { S } from './settings.js';

const vt = (v) => String(v).match(/\d+/g)?.map(Number) || [0];
export function newer(a, b) {
  const x = vt(a), y = vt(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}

export const updates = { latest: null, checked: 0 };

export async function checkUpdates(manual = false) {
  try {
    const info = await ctx.net.req('update_check', {});
    updates.checked = Date.now();
    if (info && newer(info.version, APP_VERSION)) return found(info, manual);
    updates.latest = null;
    if (manual) ctx.toast(`✅ You have the newest Smult (${APP_VERSION})`, 'ok');
  } catch (e) { if (manual) ctx.toast("Couldn't check for updates: " + (e.message || e), 'error'); }
  ctx.bus.emit('updates');
}

export function found(info, manual = false) {
  if (!info || !newer(info.version, APP_VERSION)) return;
  updates.latest = info;
  ctx.bus.emit('updates');
  if (!manual && S.get('update_skip') === info.version) return;
  ctx.sheet({ kind: 'custom-update', render: (s) => html`<${UpdateSheet} s=${s} info=${info} />` });
}

function UpdateSheet({ s, info }) {
  const [st, setSt] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!isNative) return setSt(tr('Updates install in the phone app.'));
    setBusy(true);
    setSt(tr('downloading… (keep Smult open)'));
    try {
      const r = await ctx.net.req('update_download', {});
      setSt(tr('opening the installer…'));
      const res = await LobbyNative.installApk({ data: b64(r.bytes) });
      if (res && res.needsPermission) setSt(tr('Allow "Install unknown apps" for Smult, come back and tap Update again.'));
      else setSt(tr('Tap Install / Update on the screen Android shows.'));
    } catch (e) { setSt('⚠️ ' + (e.message || e)); }
    setBusy(false);
  }
  return html`<div class="pad">
    <h2 style=${{ margin: '4px 0 6px' }}>${I('🚀')} ${tr('Smult')} ${info.version} ${tr('is here!')}</h2>
    <div class="small muted">${tr('You have')} ${APP_VERSION}. ${tr('Your chats and settings stay.')}</div>
    ${info.notes ? html`<div class="card" style=${{ margin: '10px 0', whiteSpace: 'pre-wrap', maxHeight: '40vh', overflowY: 'auto' }} data-raw=${1}>${info.notes.replace(/^#+\s*/gm, '')}</div>` : null}
    ${st ? html`<div class="small" style=${{ margin: '8px 0' }}>${st}</div>` : null}
    <div class="row" style=${{ gap: '8px', marginTop: '10px' }}>
      <button class="btn" onClick=${() => { S.set('update_skip', info.version); ctx.closeSheet(s); }}>${tr('Skip this version')}</button>
      <span class="spacer"></span>
      <button class="btn" onClick=${() => ctx.closeSheet(s)}>${tr('Later')}</button>
      <button class="btn primary" disabled=${busy} onClick=${go}>${busy ? '⏳' : I('⬇️')} ${tr('Update now')}</button>
    </div></div>`;
}

let started = false;
export function startUpdates() {
  if (started) return;
  started = true;
  setTimeout(() => checkUpdates(false), 9000);
  setInterval(() => checkUpdates(false), 6 * 3600 * 1000);
  ctx.net.on((d) => { if (d.t === 'update_available') found(d.info); });
}
