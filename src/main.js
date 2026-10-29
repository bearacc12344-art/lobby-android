import './styles.css';
import { render } from 'preact';
import { html, useBus, useEffect, useState } from './ui/h.js';
import { ctx, initNative } from './ctx.js';
import { loadI18n } from './util/i18n.js';
import { applyTheme } from './ui/theme.js';
import { S } from './util/settings.js';
import { Login } from './ui/Login.js';
import { Main } from './ui/Main.js';

function Toasts() {
  useBus(['ui']);
  return html`<div class="toasts">${ctx.toasts.map((t) => html`<div class=${'toast ' + t.kind} key=${t.id}>${t.text}</div>`)}</div>`;
}

function Banner() {
  const [b, setB] = useState(null);
  useEffect(() => ctx.bus.on('banner', (x) => { setB(x); clearTimeout(Banner.t); Banner.t = setTimeout(() => setB(null), 3500); }), []);
  if (!b) return null;
  return html`<div class="banner" onClick=${() => { setB(null); ctx.openChat(b.chatId); }}><b>${b.title}</b><div class="small ellipsis">${b.body}</div></div>`;
}

function App({ booting }) {
  useBus(['auth']);
  const [boot, setBoot] = useState(booting);
  useEffect(() => { if (booting) ctx.resume().finally(() => setBoot(false)); }, []);
  if (boot) return html`<div class="screen" style=${{ alignItems: 'center', justifyContent: 'center' }}><div class="emoji" style=${{ fontSize: '64px' }}>🚪</div>
    <div class="muted" style=${{ marginTop: '12px' }}>Lobby…</div></div>`;
  return html`${ctx.authed ? html`<${Main} />` : html`<${Login} />`}<${Toasts} /><${Banner} />`;
}

(async () => {
  applyTheme();
  S.on((k) => { if (['theme', 'accent', 'font', 'font_size', 'compact', 'animations'].includes(k)) applyTheme(); });
  await loadI18n();
  initNative();
  import('./music.js').then((mm) => { ctx.music = new mm.Music(ctx); }).catch((e) => console.warn('music', e));
  render(html`<${App} booting=${!!S.get('token')} />`, document.getElementById('app'));
})();
