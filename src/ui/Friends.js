import { html, useBus, useEffect, useRef, useState } from './h.js';
import { ctx } from '../ctx.js';
import { tr } from '../util/i18n.js';
import { PRESENCE_LABEL, fmtAgo } from '../util/format.js';
import { Avatar, Badges, Empty } from './common.js';
import { longPress } from './press.js';

function friendMenu(r) {
  const uid = r.user.id;
  const a = (t, d = {}) => ctx.api(t, { user_id: uid, ...d });
  const items = [];
  if (r.state === 'friend') {
    items.push({ ic: '💬', label: 'Message', fn: () => ctx.openDm(uid) });
    items.push({ ic: '📞', label: 'Call', fn: async () => { const c = ctx.store.dmWith(uid) || await ctx.api('open_dm', { user_id: uid }); ctx.startCall(c.id); } });
    items.push({ ic: '⭐', label: r.trusted ? 'Remove trust' : 'Mark as trusted', fn: () => a('set_trusted', { trusted: !r.trusted }) });
    items.push({ ic: '✏️', label: 'Set nickname', fn: async () => { const n = await ctx.prompt('Nickname only you see (empty to clear):', { value: r.nickname }); if (n !== null) a('set_nick', { nickname: n }); } });
    items.push({ ic: '🚫', label: 'Remove friend', danger: true, fn: async () => { if (await ctx.confirm('Remove friend?', { danger: true })) a('friend_remove'); } });
  }
  if (r.state === 'in') {
    items.push({ ic: '✔', label: 'Accept', fn: () => a('friend_respond', { accept: true }) });
    items.push({ ic: '✖', label: 'Ignore', fn: () => a('friend_respond', { accept: false }) });
  }
  if (r.state === 'blocked') items.push({ ic: '🔓', label: 'Unblock', fn: () => a('unblock') });
  else items.push({ ic: '⛔', label: 'Block', danger: true, fn: async () => { if (await ctx.confirm('Block them?', { danger: true, ok: 'Block' })) a('block'); } });
  items.push({ ic: '👤', label: 'Profile', fn: () => ctx.profile(uid) });
  ctx.menu(items, ctx.store.name(uid));
}

export function Friends() {
  useBus(['store'], (ev, t) => ['init', 'relation', 'user', 'synced'].includes(t));
  const st = ctx.store;
  const [tab, setTab] = useState('online');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const inp = useRef(null);
  useEffect(() => ctx.bus.on('focus-add', () => inp.current && inp.current.focus()), []);
  const rels = Object.values(st.rels);
  const pending = rels.filter((r) => r.state === 'in' || r.state === 'out');
  const lists = {
    online: rels.filter((r) => r.state === 'friend' && r.user.presence && !['offline', 'invisible'].includes(r.user.presence)),
    all: rels.filter((r) => r.state === 'friend'),
    trusted: rels.filter((r) => r.state === 'friend' && r.trusted),
    pending,
    blocked: rels.filter((r) => r.state === 'blocked'),
  };
  const list = lists[tab].sort((a, b) => st.name(a.user.id).localeCompare(st.name(b.user.id)));
  async function add() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await ctx.api('friend_request', { username: name.trim() });
      ctx.toast(`Friend request sent to @${name.trim().replace(/^@/, '').split('#')[0]} 📨`, 'ok');
      setName('');
    } catch (e) {}
    setBusy(false);
  }
  const empty = { online: 'Nobody online right now 🌙', all: 'No friends yet — add someone by their username above!', pending: 'No pending requests', blocked: 'Nobody blocked 😇',
    trusted: 'Trusted friends can see you while invisible, reach you during Do Not Disturb, and can be the only ones allowed to call you. Mark a friend as trusted from their ⋯ menu.' };
  return html`<div class="topbar"><h1>${tr('Friends')}</h1></div>
    <div class="content">
      <div class="row" style=${{ padding: '10px 12px 4px' }}>
        <input ref=${inp} class="field" placeholder=${tr('Add friend: username  (or name#code)')} value=${name} autocapitalize="off"
          onInput=${(e) => setName(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && add()} />
        <button class="btn primary" disabled=${busy} onClick=${add}>${busy ? '⏳' : tr('Add')}</button></div>
      ${st.me ? html`<div class="small muted" style=${{ padding: '0 16px' }}>${tr('Friend code')}: <b class="selectable">${st.me.friend_code}</b></div>` : null}
      <div class="chips">${[['online', 'Online'], ['all', 'All'], ['trusted', '⭐ Trusted'], ['pending', 'Pending'], ['blocked', 'Blocked']].map(([k, l]) =>
        html`<button class=${'chip' + (tab === k ? ' on' : '')} onClick=${() => setTab(k)}>${tr(k === 'pending' && pending.length ? `Pending (${pending.length})` : l)}</button>`)}</div>
      <div class="list">${list.map((r) => {
        const u = r.user;
        const pres = u.presence || 'offline';
        return html`<div class="item" key=${u.id} ...${longPress(() => friendMenu(r), () => (r.state === 'friend' ? ctx.openDm(u.id) : ctx.profile(u.id)))}>
          <${Avatar} user=${u} size=${46} />
          <div class="grow"><div class="row" style=${{ gap: '5px' }}><b class="ellipsis">${st.name(u.id)}</b>${r.trusted ? html`<span class="emoji tiny">⭐</span>` : null}<${Badges} list=${u.badges} max=${3} /></div>
            <div class="small muted ellipsis">${r.state === 'in' ? tr('Friend request') : r.state === 'out' ? tr('Friend request sent') : r.state === 'blocked' ? tr('Blocked')
              : (pres !== 'offline' ? tr(PRESENCE_LABEL[pres]) : u.last_seen ? tr(`last seen ${fmtAgo(u.last_seen)}`) : tr('Offline')) + (u.status_msg ? ' · ' + u.status_msg : '')}
              ${u.in_call ? tr(' · 🔊 in a call') : ''}</div></div>
          ${r.state === 'in' ? html`<button class="btn small primary" onClick=${(e) => { e.stopPropagation(); ctx.api('friend_respond', { user_id: u.id, accept: true }); }}>${tr('✔ Accept')}</button>`
            : r.state === 'friend' ? html`<button class="iconbtn" onClick=${(e) => { e.stopPropagation(); friendMenu(r); }}>⋯</button>` : null}
        </div>`;
      })}</div>
      ${!list.length ? html`<${Empty} text=${empty[tab]} />` : null}
    </div>`;
}
