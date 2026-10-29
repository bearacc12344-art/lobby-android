import { html, useState, useEffect } from './h.js';
import { I } from '../util/icons.js';
import { ctx } from '../ctx.js';
import { S } from '../util/settings.js';
import { tr } from '../util/i18n.js';
import { initials, PRESENCE_COLOR } from '../util/format.js';

export function Avatar({ user, size = 44, presence = true, ring = false, onClick }) {
  const u = user || {};
  const pres = presence && S.get('show_presence_dots') ? u.presence : null;
  let inner;
  if (u.pic_url && u.pic_url.startsWith('https://')) inner = html`<img src=${u.pic_url} onError=${(e) => { e.target.src = u.pic ? 'data:image/jpeg;base64,' + u.pic : ''; }} />`;
  else if (u.pic) inner = html`<img src=${'data:image/jpeg;base64,' + u.pic} />`;
  else if (u.avatar) inner = html`<span class="emoji" style=${{ fontSize: size * 0.55 + 'px' }}>${u.avatar}</span>`;
  else inner = html`<span style=${{ fontSize: size * 0.38 + 'px' }}>${initials(u.display || u.username)}</span>`;
  return html`<div class=${'avatar' + (ring ? ' ring' : '')} style=${{ width: size + 'px', height: size + 'px' }} onClick=${onClick}>
    <div class="inner" style=${{ background: u.pic || u.pic_url ? 'var(--panel3)' : u.color || '#d9a441' }}>${inner}</div>
    ${pres && pres !== 'invisible' ? html`<i class="dot" style=${{ background: PRESENCE_COLOR[pres] || '#555' }}></i>` : null}
  </div>`;
}

export function GroupAvatar({ chat, size = 44 }) {
  return html`<div class="avatar" style=${{ width: size + 'px', height: size + 'px' }}>
    <div class="inner" style=${{ background: 'var(--panel3)' }}><span class="emoji" style=${{ fontSize: size * 0.5 + 'px' }}>${chat.icon || '👥'}</span></div></div>`;
}

export function ChatAvatar({ chat, size = 44 }) {
  if (chat.kind === 'group') return html`<${GroupAvatar} chat=${chat} size=${size} />`;
  const o = ctx.store.dmOther(chat);
  return html`<${Avatar} user=${ctx.store.users[o]} size=${size} />`;
}

export function Badges({ list, max = 4 }) {
  if (!list || !list.length) return null;
  return html`<span class="bchips">${list.slice(0, max).map((b) => html`<span class="bchip" title=${b.name + ' — ' + b.desc}
    style=${{ background: b.color, color: b.fg }} onClick=${(e) => { e.stopPropagation(); ctx.toast(`${b.emoji} ${b.name} — ${b.desc}`); }}>
    <span class="emoji">${b.emoji}</span>${max > 3 ? '' : ' ' + tr(b.name)}</span>`)}</span>`;
}

export function Switch({ on }) { return html`<span class=${'switch' + (on ? ' on' : '')}></span>`; }

// a settings checkbox bound to a key
export function Check({ k, label, sub, onChange }) {
  const [v, setV] = useState(!!S.get(k));
  return html`<label class="check" onClick=${(e) => { e.preventDefault(); const n = !v; setV(n); S.set(k, n); onChange && onChange(n); }}>
    <div class="grow"><div>${tr(label)}</div>${sub ? html`<div class="small muted">${tr(sub)}</div>` : null}</div><${Switch} on=${v} /></label>`;
}

export function Slider({ k, label, min, max, step = 1, suffix = '', onChange }) {
  const [v, setV] = useState(S.get(k));
  return html`<div style=${{ padding: '8px 0' }}><div class="row"><span class="grow">${tr(label)}</span><span class="muted">${v}${suffix}</span></div>
    <input type="range" min=${min} max=${max} step=${step} value=${v} onInput=${(e) => { const n = +e.target.value; setV(n); S.set(k, n); onChange && onChange(n); }} /></div>`;
}

export function Select({ k, label, options, onChange }) {
  const [v, setV] = useState(S.get(k));
  return html`<div class="row" style=${{ padding: '8px 0' }}><span class="grow">${tr(label)}</span>
    <select class="field" style=${{ width: 'auto', maxWidth: '62%' }} value=${String(v)} onChange=${(e) => {
      const o = options.find((x) => String(x[0]) === e.target.value); const n = o ? o[0] : e.target.value; setV(n); S.set(k, n); onChange && onChange(n);
    }}>${options.map(([val, txt]) => html`<option value=${String(val)}>${tr(txt)}</option>`)}</select></div>`;
}

export function TopBar({ title, back = true, children, sub }) {
  return html`<div class="topbar">${back ? html`<button class="iconbtn" onClick=${() => ctx.pop()}>${I('⬅️')}</button>` : null}
    <div class="title"><b style=${{ fontSize: '1.15em' }}>${title}</b>${sub ? html`<div class="small muted ellipsis">${sub}</div>` : null}</div>${children}</div>`;
}

export function Empty({ text, children }) { return html`<div class="empty"><div>${tr(text)}</div>${children}</div>`; }

export function useAsync(fn, deps = []) {
  const [st, set] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let alive = true;
    set((s) => ({ ...s, loading: true }));
    Promise.resolve().then(fn).then((data) => alive && set({ loading: false, data, error: null }),
      (error) => alive && set({ loading: false, data: null, error }));
    return () => { alive = false; };
  }, deps);
  return st;
}
