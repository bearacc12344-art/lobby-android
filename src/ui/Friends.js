import { html, useBus, useEffect, useRef, useState } from './h.js';
import { I } from '../util/icons.js';
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
  const [sq, setSq] = useState({ mode: null, q: '', res: null });     // find people / find groups
  const deb = useRef(null);
  function search(mode, q, now = false) {
    if (!q.trim() && !now) { setSq({ mode: null, q: '', res: null }); return; }
    setSq({ mode, q, res: null });
    clearTimeout(deb.current);
    deb.current = setTimeout(async () => {
      try { const res = await ctx.net.req(mode === 'people' ? 'search_users' : 'search_groups', { q }); setSq((c) => (c.mode === mode && c.q === q ? { ...c, res } : c)); }
      catch (e) { setSq((c) => ({ ...c, res: [] })); }
    }, now ? 0 : 450);
  }
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
      <div class="row" style=${{ padding: '6px 12px 0', gap: '6px' }}>
        <input class="field" placeholder=${tr('🔍 Find people')} value=${sq.mode === 'people' ? sq.q : ''} autocapitalize="off"
          onInput=${(e) => search('people', e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && search('people', e.target.value, true)} />
        <input class="field" placeholder=${tr('🔍 Find groups')} value=${sq.mode === 'groups' ? sq.q : ''}
          onInput=${(e) => search('groups', e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && search('groups', e.target.value, true)} /></div>
      ${sq.mode ? html`<${SearchResults} sq=${sq} again=${() => search(sq.mode, sq.q, true)} />` : null}
      <div class="chips" style=${{ display: sq.mode ? 'none' : '' }}>${[['online', 'Online'], ['all', 'All'], ['trusted', '⭐ Trusted'], ['pending', 'Pending'], ['blocked', 'Blocked']].map(([k, l]) =>
        html`<button class=${'chip' + (tab === k ? ' on' : '')} onClick=${() => setTab(k)}>${tr(k === 'pending' && pending.length ? `Pending (${pending.length})` : l)}</button>`)}</div>
      <div class="list" style=${{ display: sq.mode ? 'none' : '' }}>${list.map((r) => {
        const u = r.user;
        const pres = u.presence || 'offline';
        return html`<div class="item" key=${u.id} ...${longPress(() => friendMenu(r), () => (r.state === 'friend' ? ctx.openDm(u.id) : ctx.profile(u.id)))}>
          <${Avatar} user=${u} size=${46} />
          <div class="grow"><div class="row" style=${{ gap: '5px' }}><b class="ellipsis">${st.name(u.id)}</b>${r.trusted ? html`<span class="emoji tiny">${I('⭐')}</span>` : null}<${Badges} list=${u.badges} max=${3} /></div>
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


function SearchResults({ sq, again }) {
  if (sq.res === null) return html`<div class="small muted pad">${tr('searching…')}</div>`;
  if (!sq.res.length) return html`<div class="small muted pad">${tr(sq.mode === 'people' ? 'Nobody found with that name' : 'No public groups found. Make one public from its group info.')}</div>`;
  return html`<div class="tiny muted" style=${{ padding: '4px 16px' }}>${sq.res.length} ${tr(sq.mode === 'people' ? 'people' : 'public groups')} · ${tr('clear the search to see your friends again')}</div>
    <div class="list">${sq.res.map((x) => (sq.mode === 'people' ? html`<${PersonRow} x=${x} again=${again} />` : html`<${GroupRow} g=${x} />`))}</div>`;
}

function PersonRow({ x, again }) {
  const [st, setSt] = useState(x.state);
  async function add() { try { await ctx.api('friend_request', { username: x.handle }); setSt('out'); ctx.toast(`Friend request sent to @${x.username} 📨`, 'ok'); } catch (e) {} }
  const user = { username: x.username, display: x.display, color: x.color, avatar: x.avatar, pic: x.pic };
  return html`<div class="item"><${Avatar} user=${user} size=${44} presence=${false} />
    <div class="grow"><b class="ellipsis" data-raw=${1}>${x.display}</b><div class="small muted ellipsis" data-raw=${1}>@${x.handle}${x.status_msg ? ' · ' + x.status_msg : ''}</div></div>
    ${x.me ? html`<span class="tiny muted">${tr("that's you")}</span>`
      : st === 'friend' ? html`<button class="btn small" onClick=${async () => { const u = await ctx.api('lookup', { username: x.handle }); ctx.openDm(u.id); }}>${I('💬')}</button>`
      : st === 'out' ? html`<span class="tiny muted">${tr('⏳ Requested')}</span>`
      : st === 'blocked' ? html`<span class="tiny muted">${tr('Blocked')}</span>`
      : html`<button class="btn small primary" onClick=${add}>${tr(st === 'in' ? '✔ Accept' : '➕ Add')}</button>`}</div>`;
}

function GroupRow({ g }) {
  const [st, setSt] = useState(g.joined ? 'in' : '');
  async function join() {
    try { await ctx.api('join_public', { gid: g.gid, admins: g.admins }); setSt('wait'); ctx.toast(tr(`🌍 Asked to join ${g.name} — you're in as soon as an admin's Smult sees it`), 'ok'); } catch (e) {}
  }
  return html`<div class="item"><${Avatar} user=${{ display: g.name, avatar: g.icon, pic: g.pic }} size=${44} presence=${false} />
    <div class="grow"><b class="ellipsis" data-raw=${1}>${g.name}</b><div class="small muted ellipsis" data-raw=${1}>${g.members} ${tr('members')} · ${g.topic || 'by ' + g.by}</div></div>
    ${st === 'in' ? html`<button class="btn small" onClick=${() => ctx.openChat(g.chat_id)}>${I('💬')}</button>`
      : st === 'wait' ? html`<span class="tiny muted">${tr('⏳ Joining…')}</span>` : html`<button class="btn small primary" onClick=${join}>${tr('➕ Join')}</button>`}</div>`;
}
