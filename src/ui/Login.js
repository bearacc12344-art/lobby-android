import { html, useState } from './h.js';
import { I } from '../util/icons.js';
import { ctx } from '../ctx.js';
import { S } from '../util/settings.js';
import { tr } from '../util/i18n.js';

export function Login() {
  const [tab, setTab] = useState(S.get('username') ? 'login' : 'signup');
  const [u, setU] = useState(S.get('username') || '');
  const [disp, setDisp] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState(false);
  const [remember, setRemember] = useState(S.get('remember'));

  async function go() {
    if (busy) return;
    if (tab === 'signup' && pw !== pw2) { setErr(true); setMsg(tr("Passwords don't match")); return; }
    setBusy(true); setErr(false);
    setMsg(tr('Unlocking your account & connecting to relays... (a few seconds)'));
    S.set('remember', remember);
    try {
      await ctx.login({ t: tab === 'signup' ? 'register' : 'login', username: u.trim(), password: pw, display: disp.trim() || u.trim() },
        (p) => setMsg(tr('Unlocking your account & connecting to relays... (a few seconds)') + ` ${Math.round(p * 100)}%`));
    } catch (e) {
      setErr(true); setMsg(tr(e.message || String(e)));
      setBusy(false);
    }
  }
  const key = (e) => { if (e.key === 'Enter') go(); };
  return html`<div class="screen" style=${{ overflowY: 'auto' }}>
    <div style=${{ padding: 'calc(30px + env(safe-area-inset-top)) 22px 22px', display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '460px', margin: '0 auto', width: '100%' }}>
      <div class="center"><img src="./assets/smult.png" class="applogo" style=${{ width: '108px', height: '108px' }} /></div>
      <div class="center" style=${{ fontSize: '46px', fontWeight: 700, color: 'var(--accent)', letterSpacing: '3px' }}>LOBBY</div>
      <div class="center muted">${tr('chat · call · share  —  with ur friends')}</div>
      <div class="chips" style=${{ justifyContent: 'center', padding: '10px 0' }}>
        <button class=${'chip' + (tab === 'login' ? ' on' : '')} onClick=${() => setTab('login')}>${tr('Log in')}</button>
        <button class=${'chip' + (tab === 'signup' ? ' on' : '')} onClick=${() => setTab('signup')}>${tr('Sign up')}</button>
      </div>
      <input class="field" placeholder=${tr(tab === 'signup' ? 'Username (letters, numbers, _ .)' : 'Username')} value=${u} autocapitalize="off" autocomplete="username"
        onInput=${(e) => setU(e.target.value)} onKeyDown=${key} />
      ${tab === 'signup' ? html`<input class="field" placeholder=${tr('Display name (what friends see)')} value=${disp} onInput=${(e) => setDisp(e.target.value)} onKeyDown=${key} />` : null}
      <input class="field" type="password" placeholder=${tr(tab === 'signup' ? 'Password (8+ chars)' : 'Password')} value=${pw} onInput=${(e) => setPw(e.target.value)} onKeyDown=${key}
        autocomplete=${tab === 'signup' ? 'new-password' : 'current-password'} />
      ${tab === 'signup' ? html`<input class="field" type="password" placeholder=${tr('Repeat password')} value=${pw2} onInput=${(e) => setPw2(e.target.value)} onKeyDown=${key} />` : null}
      <label class="check" onClick=${(e) => { e.preventDefault(); setRemember(!remember); }}><span class="grow">${tr('Keep me logged in')}</span>
        <span class=${'switch' + (remember ? ' on' : '')}></span></label>
      <button class="btn primary block" disabled=${busy} onClick=${go}>${tr(tab === 'signup' ? 'Create account' : 'Enter the Smult')}</button>
      ${msg ? html`<div class=${'small center' + (err ? '' : ' muted')} style=${{ color: err ? 'var(--danger)' : undefined }}>${msg}</div>` : null}
      ${tab === 'signup' ? html`<div class="small muted center">${tr("No server, no email: your username + password ARE your account, so you can log in from any PC. There's no reset, so don't forget it!")}</div>` : null}
      <div class="small muted center" style=${{ marginTop: '20px' }}>${tr('🔒 Peer-to-peer · end-to-end encrypted · no server needed')}</div>
    </div></div>`;
}
