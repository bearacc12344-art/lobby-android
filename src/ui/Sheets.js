import { html, useBus, useEffect, useRef, useState } from './h.js';
import { StatusViewer, StatusNew } from './Status.js';
import { prepareAvatar } from '../util/image.js';
import { pickFiles } from '../util/files.js';
import { I } from '../util/icons.js';
import { ctx } from '../ctx.js';
import { S } from '../util/settings.js';
import { tr } from '../util/i18n.js';
import { EMOJI, EMOJI_NAMES } from '../util/emoji.js';
import { fmtAgo, fmtTime, dayLabel, PRESENCE_LABEL, fmtSize } from '../util/format.js';
import { getFile, saveFile, fileUrl, extOf, IMAGE_EXT } from '../util/files.js';
import { Avatar, Badges, ChatAvatar, Switch } from './common.js';
import { GifPicker } from './Gifs.js';

function Menu({ s }) {
  return html`<div class="menu">${s.title ? html`<div class="muted small" style=${{ padding: '2px 6px 8px' }}>${s.title}</div>` : null}
    ${s.items.filter(Boolean).map((it) => it.row ? html`<div class="row" style=${{ justifyContent: 'space-between', padding: '4px 2px 10px' }}>
        ${it.row.map((e) => html`<button class="iconbtn" style=${{ fontSize: '1.6em' }} onClick=${() => { ctx.closeSheet(s); it.fn(e); }}>${e}</button>`)}</div>`
      : html`<div class=${'mi' + (it.danger ? ' danger' : '')} onClick=${() => { ctx.closeSheet(s); it.fn && it.fn(); }}>
        <span class="ic">${I(it.ic || '')}</span><span class="grow">${tr(it.label)}</span>${it.right || ''}</div>`)}</div>`;
}

function Confirm({ s }) {
  const done = (v) => { ctx.closeSheet(s); s.res(v); };
  return html`<div class="dialog"><div style=${{ marginBottom: '16px', whiteSpace: 'pre-wrap' }}>${s.text}</div>
    <div class="row" style=${{ justifyContent: 'flex-end' }}><button class="btn flat" onClick=${() => done(false)}>${tr('Cancel')}</button>
    <button class=${'btn ' + (s.danger ? 'danger' : 'primary')} onClick=${() => done(true)}>${s.ok}</button></div></div>`;
}

function Prompt({ s }) {
  const [v, setV] = useState(s.value || '');
  const done = (val) => { ctx.closeSheet(s); s.res(val); };
  return html`<div class="dialog"><div style=${{ marginBottom: '10px' }}>${s.title}</div>
    ${s.multiline ? html`<textarea class="field" rows="4" value=${v} placeholder=${s.placeholder} onInput=${(e) => setV(e.target.value)} autofocus></textarea>`
      : html`<input class="field" value=${v} placeholder=${s.placeholder} onInput=${(e) => setV(e.target.value)} autofocus onKeyDown=${(e) => e.key === 'Enter' && done(v)} />`}
    <div class="row" style=${{ justifyContent: 'flex-end', marginTop: '12px' }}><button class="btn flat" onClick=${() => done(null)}>${tr('Cancel')}</button>
    <button class="btn primary" onClick=${() => done(v)}>OK</button></div></div>`;
}

function EmojiSheet({ s }) {
  const [q, setQ] = useState('');
  const recent = S.get('recent_emoji') || [];
  const pick = (e) => {
    S.set('recent_emoji', [e, ...recent.filter((x) => x !== e)].slice(0, 24));
    s.onPick(e);
    if (s.close) ctx.closeSheet(s);
  };
  const all = Object.values(EMOJI).flat();
  const shown = q ? all.filter((e) => (EMOJI_NAMES[e] || '').includes(q.toLowerCase())) : null;
  return html`<div style=${{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <div class="row" style=${{ padding: '10px 12px 4px' }}><input class="field" placeholder=${tr('Search  (try skull, fire, door...)')} value=${q} onInput=${(e) => setQ(e.target.value)} />
      <button class="iconbtn" onClick=${() => ctx.closeSheet(s)}>${I('✖️')}</button></div>
    <div style=${{ overflowY: 'auto', flex: 1 }}>
      ${shown ? html`<div class="egrid">${shown.map((e) => html`<button onClick=${() => pick(e)}>${e}</button>`)}</div>` : html`
        ${recent.length ? html`<div class="section" style=${{ margin: '8px 12px 0' }}>${tr('Recent')}</div><div class="egrid">${recent.map((e) => html`<button onClick=${() => pick(e)}>${e}</button>`)}</div>` : null}
        ${Object.entries(EMOJI).map(([cat, list]) => html`<div class="section" style=${{ margin: '8px 12px 0' }}>${tr(cat)}</div>
          <div class="egrid">${list.map((e) => html`<button onClick=${() => pick(e)}>${e}</button>`)}</div>`)}`}
    </div></div>`;
}

function ImageViewer({ s }) {
  return html`<div style=${{ position: 'fixed', inset: 0, background: '#000', display: 'flex', flexDirection: 'column', zIndex: 70 }}>
    <div class="row" style=${{ padding: 'calc(8px + env(safe-area-inset-top)) 8px 8px', color: '#fff' }}>
      <button class="iconbtn" style=${{ color: '#fff' }} onClick=${() => ctx.closeSheet(s)}>${I('⬅️')}</button><span class="grow ellipsis">${s.name}</span>
      ${s.fid ? html`<button class="iconbtn" onClick=${async () => { const f = await getFile(s.fid); saveFile(f.name, f.bytes); }}>${I('💾')}</button>` : null}</div>
    <div style=${{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}>
      <img src=${s.url} style=${{ maxWidth: '100%', maxHeight: '100%', touchAction: 'pinch-zoom' }} /></div></div>`;
}

export function ProfileSheet({ s }) {
  useBus(['store'], (ev, t) => ['user', 'relation', 'init'].includes(t));
  const st = ctx.store;
  const uid = s.uid;
  const u = st.users[uid] || {};
  const r = st.rels[uid];
  const me = uid === st.myId;
  const [nick, setNick] = useState(r ? r.nickname : '');
  const [note, setNote] = useState(r ? r.note : '');
  const mutual = Object.values(st.chats).filter((c) => c.kind === 'group' && c.members.some((m) => m.id === uid) && !me);
  const pres = u.presence || 'offline';
  const act = (t, d, then) => ctx.api(t, { user_id: uid, ...d }).then(then);
  return html`<div class="col" style=${{ alignItems: 'center', textAlign: 'center' }}>
    <${Avatar} user=${u} size=${96} />
    <div><b style=${{ fontSize: '1.4em' }}>${st.name(uid)}</b>${r && r.nickname ? html`<div class="small muted">${u.display}</div>` : null}</div>
    <div class="muted small">@${u.username} · ${u.friend_code || ''} · ${pres !== 'offline' ? tr(PRESENCE_LABEL[pres]) : u.last_seen ? tr(`last seen ${fmtAgo(u.last_seen)}`) : tr('Offline')}</div>
    ${u.role ? html`<div class="small" style=${{ color: 'var(--accent)' }}>${u.role === 'owner' ? '👑 ' + tr('Owner') : '🛡️ ' + tr('Admin')}</div>` : null}
    <${Badges} list=${u.badges} max=${3} />
    ${u.status_msg ? html`<div>${u.status_msg}</div>` : null}
    ${u.bio ? html`<div class="card selectable" style=${{ width: '100%', textAlign: 'left' }}><div class="small muted">${tr('About')}</div>${u.bio}</div>` : null}
    ${r && r.trusts_me ? html`<div class="small" style=${{ color: 'var(--accent)' }}>${tr('⭐ They trust you')}</div>` : null}
    ${mutual.length ? html`<div class="small muted">${tr('Mutual groups:')} ${mutual.map((c) => c.name).join(', ')}</div>` : null}
    ${me ? html`<div class="row wrap" style=${{ justifyContent: 'center' }}>
        <button class="btn" onClick=${() => { ctx.closeSheet(s); ctx.setTab('settings'); ctx.push({ kind: 'settings', page: 'account' }); }}>${tr('Edit my profile')}</button>
        <button class="btn" onClick=${() => { ctx.closeSheet(s); ctx.openDm(uid); }}>${I('📝')} ${tr('Notes to self')}</button></div>`
      : html`<div class="row wrap" style=${{ justifyContent: 'center' }}>
        ${r && r.state === 'friend' ? html`<button class="btn primary" onClick=${() => { ctx.closeSheet(s); ctx.openDm(uid); }}>${tr('💬 Message')}</button>
          <button class="btn" onClick=${async () => { ctx.closeSheet(s); const c = st.dmWith(uid) || await ctx.api('open_dm', { user_id: uid }); ctx.startCall(c.id); }}>${I('📞')} ${tr('Call')}</button>` : null}
        ${r && r.state === 'in' ? html`<button class="btn primary" onClick=${() => act('friend_respond', { accept: true })}>${tr('✔ Accept friend request')}</button>
          <button class="btn" onClick=${() => act('friend_respond', { accept: false })}>${tr('✖ Ignore')}</button>` : null}
        ${r && r.state === 'out' ? html`<span class="muted">${tr('Friend request sent')}</span>` : null}
        ${r && r.state === 'blocked' ? html`<span class="muted">${tr('You blocked them')}</span><button class="btn" onClick=${() => act('unblock')}>${tr('Unblock')}</button>` : null}
        ${!r && u.username ? html`<button class="btn primary" onClick=${() => ctx.api('friend_request', { username: u.friend_code || u.username })}>${tr('➕ Add friend')}</button>` : null}
      </div>`}
    ${r && r.state === 'friend' && !me ? html`<div style=${{ width: '100%', textAlign: 'left' }}>
      <label class="check" onClick=${(e) => { e.preventDefault(); act('set_trusted', { trusted: !r.trusted }); }}>
        <div class="grow"><div>${tr('⭐ Trusted friend')}</div><div class="small muted">${tr("Trusted friends can see you when you're invisible, reach you during Do Not Disturb, and (if you choose) call you when only trusted can.")}</div></div>
        <${Switch} on=${r.trusted} /></label>
      <input class="field" placeholder=${tr('Nickname only you see')} value=${nick} onInput=${(e) => setNick(e.target.value)} onBlur=${() => nick !== r.nickname && act('set_nick', { nickname: nick })} />
      <textarea class="field" rows="2" style=${{ marginTop: '8px' }} placeholder=${tr('Private note (only you can see this)')} value=${note} onInput=${(e) => setNote(e.target.value)}
        onBlur=${() => note !== r.note && act('set_nick', { note })}></textarea>
      <div class="row wrap" style=${{ marginTop: '10px' }}>
        <button class="btn small" onClick=${async () => { if (await ctx.confirm('Remove friend?', { danger: true })) act('friend_remove'); }}>${tr('Remove friend')}</button>
        <button class="btn small danger" onClick=${async () => { if (await ctx.confirm("Block them? They won't be able to message or call you.", { danger: true, ok: 'Block' })) act('block'); }}>${tr('Block')}</button>
        <${AdminBadgeButton} uid=${uid} sheet=${s} />
      </div></div>` : !me ? html`<${AdminBadgeButton} uid=${uid} sheet=${s} />` : null}
  </div>`;
}

function AdminBadgeButton({ uid, sheet }) {
  const me = ctx.store.me || {};
  if (!me.role) return null;
  const open = async () => {
    ctx.closeSheet(sheet);
    const [{ GrantSheet }, st0] = await Promise.all([import('./Settings.js'), ctx.api('badge_state')]);
    let st = st0;
    const reload = async () => { st = await ctx.api('badge_state'); ctx.bus.emit('nav'); };
    ctx.sheet({ kind: 'custom', render: (s) => html`<${GrantSheet} s=${s} uid=${uid} st=${st} reload=${reload} />` });
  };
  return html`<button class="btn small" onClick=${open}>${I('🏅')} ${tr('Badges')}</button>`;
}

async function pickGroupPhoto(c) {
  const [f] = await pickFiles({ accept: 'image/*', multiple: false });
  if (!f) return;
  try {
    const a = await prepareAvatar(f);
    await ctx.api('group_update', a.kind === 'gif' ? { chat_id: c.id, pic: a.still, gif: a.data } : { chat_id: c.id, pic: a.still });
    ctx.toast(tr('Group photo updated'), 'ok');
  } catch (e) { if (!(e && e.name === 'Err')) ctx.toast(String(e.message || e), 'error'); }
}

function GroupSheet({ s }) {
  useBus(['store'], (ev, t) => ['chat', 'user', 'init'].includes(t));
  const st = ctx.store;
  const c = st.chats[s.cid];
  const [name, setName] = useState(c ? c.name : '');
  const [icon, setIcon] = useState(c ? c.icon : '');
  const [topic, setTopic] = useState(c ? c.topic : '');
  if (!c) return html`<div class="empty">—</div>`;
  const myRole = st.role(c.id);
  const admin = ['owner', 'admin'].includes(myRole);
  const memberMenu = (m) => {
    const items = [{ ic: '👤', label: 'View profile', fn: () => ctx.profile(m.id) }];
    if (m.id !== st.myId && myRole === 'owner') {
      items.push(m.role === 'admin' ? { ic: '🛡️', label: 'Remove admin', fn: () => ctx.api('group_role', { chat_id: c.id, user_id: m.id, role: 'member' }) }
        : { ic: '🛡️', label: 'Make admin', fn: () => ctx.api('group_role', { chat_id: c.id, user_id: m.id, role: 'admin' }) });
      items.push({ ic: '👑', label: 'Transfer ownership', fn: async () => { if (await ctx.confirm('Transfer ownership?')) ctx.api('group_role', { chat_id: c.id, user_id: m.id, role: 'owner' }); } });
    }
    if (m.id !== st.myId && admin && m.role !== 'owner' && !(m.role === 'admin' && myRole !== 'owner')) {
      items.push({ ic: '🚫', label: 'Remove from group', danger: true, fn: () => ctx.api('group_kick', { chat_id: c.id, user_id: m.id }) });
    }
    ctx.menu(items, st.name(m.id));
  };
  const addable = st.friends().filter((r) => !c.members.some((m) => m.id === r.user.id));
  return html`<div class="col">
    <div class="row"><${ChatAvatar} chat=${c} size=${64} /><div class="grow"><b style=${{ fontSize: '1.3em' }}>${c.name}</b><div class="small muted">${c.topic}</div></div></div>
    ${admin ? html`<div class="card col">
      <input class="field" placeholder=${tr('Group name')} value=${name} onInput=${(e) => setName(e.target.value)} />
      <div class="row"><input class="field" style=${{ width: '80px' }} placeholder=${tr('Icon emoji')} value=${icon} onInput=${(e) => setIcon(e.target.value)} />
        <input class="field grow" placeholder=${tr('Topic')} value=${topic} onInput=${(e) => setTopic(e.target.value)} /></div>
      <div class="row wrap"><button class="btn" onClick=${() => pickGroupPhoto(c)}>${I('🖼')} ${tr('Change group photo')}</button>
        ${c.pic || c.pic_url ? html`<button class="btn" onClick=${() => ctx.api('group_update', { chat_id: c.id, pic: '' })}>${tr('Remove photo')}</button>` : null}</div>
      <button class="btn primary" onClick=${() => ctx.api('group_update', { chat_id: c.id, name, icon, topic }).then(() => ctx.toast('Saved', 'ok'))}>${tr('Save changes')}</button></div>` : null}
    <div class="section">${tr(`${c.members.length} members`)}</div>
    ${c.members.map((m) => html`<div class="row" style=${{ padding: '6px 0' }} onClick=${() => memberMenu(m)}>
      <${Avatar} user=${st.users[m.id]} size=${40} /><div class="grow"><div>${st.name(m.id)}${m.id === st.myId ? tr('  (you)') : ''}</div>
      <div class="tiny muted">${m.role === 'owner' ? '👑 owner' : m.role === 'admin' ? '🛡️ admin' : ''}</div></div></div>`)}
    <div class="row wrap">
      ${admin && addable.length ? html`<button class="btn" onClick=${() => ctx.menu(addable.map((r) => ({ label: r.user.display, fn: () => ctx.api('group_add', { chat_id: c.id, user_id: r.user.id }) })), tr('Add to group'))}>${tr('➕ Add people')}</button>` : null}
      <button class="btn" onClick=${() => ctx.sheet({ kind: 'media', cid: c.id })}>${tr('🖼️ Media')}</button>
      <button class="btn danger" onClick=${async () => { if (await ctx.confirm('Leave this group?', { danger: true })) { ctx.closeSheet(s); ctx.api('group_leave', { chat_id: c.id }); } }}>${tr('🚪 Leave')}</button>
    </div></div>`;
}

function NewGroup({ s }) {
  const st = ctx.store;
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [topic, setTopic] = useState('');
  const [sel, setSel] = useState(new Set());
  const [q, setQ] = useState('');
  const fr = st.friends().filter((r) => !q || r.user.display.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };
  return html`<div class="col"><b style=${{ fontSize: '1.2em' }}>${tr('New group')}</b>
    <input class="field" placeholder=${tr('Group name')} value=${name} onInput=${(e) => setName(e.target.value)} />
    <div class="row"><input class="field" style=${{ width: '80px' }} placeholder="👥" value=${icon} onInput=${(e) => setIcon(e.target.value)} />
      <input class="field grow" placeholder=${tr('Topic (optional)')} value=${topic} onInput=${(e) => setTopic(e.target.value)} /></div>
    <div class="small muted">${tr('Add friends:')}</div>
    <input class="field" placeholder=${tr('Search friends')} value=${q} onInput=${(e) => setQ(e.target.value)} />
    <div>${fr.map((r) => html`<label class="check" onClick=${(e) => { e.preventDefault(); toggle(r.user.id); }}><${Avatar} user=${r.user} size=${36} />
      <span class="grow">${st.name(r.user.id)}</span><${Switch} on=${sel.has(r.user.id)} /></label>`)}</div>
    <button class="btn primary" onClick=${async () => {
      const c = await ctx.api('create_group', { name, icon, topic, members: [...sel] });
      ctx.store.handle({ t: 'chat', chat: c });
      ctx.closeSheet(s);
      ctx.openChat(c.id);
    }}>${tr('Create')}</button></div>`;
}

function PollSheet({ s }) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  return html`<div class="col"><b>${tr('New poll')}</b>
    <input class="field" placeholder=${tr('Question')} value=${q} onInput=${(e) => setQ(e.target.value)} />
    ${opts.map((o, i) => html`<input class="field" placeholder=${'#' + (i + 1)} value=${o} onInput=${(e) => { const n = [...opts]; n[i] = e.target.value; setOpts(n); }} />`)}
    ${opts.length < 10 ? html`<button class="btn flat" onClick=${() => setOpts([...opts, ''])}>${tr('+ option')}</button>` : null}
    <label class="check" onClick=${(e) => { e.preventDefault(); setMulti(!multi); }}><span class="grow">${tr('Allow multiple answers')}</span><${Switch} on=${multi} /></label>
    <button class="btn primary" onClick=${async () => { await ctx.api('send', { chat_id: s.cid, body: q, poll: { options: opts.filter((o) => o.trim()), multi } }); ctx.closeSheet(s); }}>${tr('📊 Send poll')}</button></div>`;
}

function ScheduleSheet({ s }) {
  const [body, setBody] = useState(s.body || '');
  const d0 = new Date(Date.now() + 30 * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  const [when, setWhen] = useState(`${d0.getFullYear()}-${pad(d0.getMonth() + 1)}-${pad(d0.getDate())}T${pad(d0.getHours())}:${pad(d0.getMinutes())}`);
  const quick = (fn) => { const d = fn(new Date()); setWhen(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`); };
  return html`<div class="col"><b>${tr('⏰ Schedule')}</b>
    <textarea class="field" rows="3" placeholder=${tr('Message to send later...')} value=${body} onInput=${(e) => setBody(e.target.value)}></textarea>
    <input class="field" type="datetime-local" value=${when} onInput=${(e) => setWhen(e.target.value)} />
    <div class="row wrap"><button class="chip" onClick=${() => quick((d) => new Date(d.getTime() + 30 * 60000))}>${tr('In 30 min')}</button>
      <button class="chip" onClick=${() => quick((d) => { d.setHours(20, 0, 0, 0); return d; })}>${tr('Tonight 20:00')}</button>
      <button class="chip" onClick=${() => quick((d) => { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; })}>${tr('Tomorrow 09:00')}</button></div>
    <div class="small muted">${tr('It gets sent by the server, so it works even if your PC is off.')}</div>
    <button class="btn primary" onClick=${async () => { await ctx.api('schedule', { chat_id: s.cid, body, send_at: new Date(when).getTime() / 1000 }); ctx.toast('⏰ Scheduled!', 'ok'); ctx.closeSheet(s); }}>${tr('⏰ Schedule')}</button></div>`;
}

function ForwardSheet({ s }) {
  const st = ctx.store;
  const m = s.msg;
  const go = async (c) => {
    const d = { chat_id: c.id, body: m.body ? `${tr('Forwarded ➡️')}\n${m.body}` : '' };
    if (m.file) { const f = await getFile(m.file.id); d.file = { name: f.name, bytes: f.bytes, voice: m.kind === 'voice' }; }
    if (m.kind === 'poll' && m.poll) d.poll = { options: m.poll.options, multi: m.poll.multi };
    await ctx.api('send', d);
    ctx.toast(tr('Forwarded ➡️'), 'ok');
    ctx.closeSheet(s);
  };
  return html`<div><b>${tr('➡️  Forward').trim()}</b>${Object.values(st.chats).map((c) => html`<div class="row" style=${{ padding: '8px 0' }} onClick=${() => go(c)}>
    <${ChatAvatar} chat=${c} size=${38} /><span class="grow">${st.chatTitle(c)}</span></div>`)}</div>`;
}

function PinsSheet({ s }) {
  const st = ctx.store;
  const c = st.chats[s.cid];
  const [list, setList] = useState(null);
  useEffect(() => { ctx.api('get_messages', { ids: (c && c.pins) || [] }).then(setList); }, []);
  return html`<div><b>${tr('Pinned messages')}</b>
    ${list === null ? html`<div class="empty">⏳</div>` : !list.length ? html`<div class="empty">${tr('No pinned messages yet — right-click a message to pin it')}</div>`
      : list.map((m) => html`<div class="card" style=${{ margin: '8px 0' }} onClick=${() => { ctx.closeSheet(s); ctx.bus.emit('jump', m.id); }}>
        <div class="small"><b>${st.name(m.sender)}</b> <span class="muted">${dayLabel(m.created)} ${fmtTime(m.created)}</span></div>
        <div>${m.body || (m.file || {}).name || ''}</div></div>`)}</div>`;
}

function MediaThumb({ m, onOpen }) {
  const [url, setUrl] = useState(null);
  useEffect(() => { if (m.kind === 'image') fileUrl(m.file.id).then(setUrl).catch(() => {}); }, []);
  if (m.kind === 'image') return html`<div style=${{ aspectRatio: 1, background: 'var(--panel3)', borderRadius: '8px', overflow: 'hidden' }} onClick=${() => url && onOpen(url)}>
    ${url ? html`<img src=${url} style=${{ width: '100%', height: '100%', objectFit: 'cover' }} />` : null}</div>`;
  return null;
}

function MediaSheet({ s }) {
  const [list, setList] = useState(null);
  const [tab, setTab] = useState('img');
  useEffect(() => { ctx.api('media', { chat_id: s.cid }).then(setList); }, []);
  const imgs = (list || []).filter((m) => m.kind === 'image'), files = (list || []).filter((m) => m.kind !== 'image');
  return html`<div><div class="chips" style=${{ padding: '0 0 8px' }}>
    <button class=${'chip' + (tab === 'img' ? ' on' : '')} onClick=${() => setTab('img')}>${tr('🖼️ Images')} ${imgs.length}</button>
    <button class=${'chip' + (tab === 'file' ? ' on' : '')} onClick=${() => setTab('file')}>${tr('📎 Files')} ${files.length}</button></div>
    ${list === null ? html`<div class="empty">⏳</div>` : tab === 'img'
      ? html`<div style=${{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>${imgs.map((m) => html`<${MediaThumb} m=${m} onOpen=${(url) => ctx.sheet({ kind: 'image', url, name: m.file.name, fid: m.file.id })} />`)}</div>`
      : files.map((m) => html`<div class="row" style=${{ padding: '8px 0' }} onClick=${async () => { const f = await getFile(m.file.id); saveFile(f.name, f.bytes); }}>
          <span class="emoji">${I(m.kind === 'voice' ? '🎤' : '📎')}</span><span class="grow ellipsis">${m.file.name}</span><span class="tiny muted">${fmtSize(m.file.size)}</span></div>`)}</div>`;
}

const FULL = new Set(['emoji', 'gif']);

export function Sheets() {
  useBus(['nav']);
  return html`${ctx.sheets.map((s, i) => {
    if (s.kind === 'image') return html`<${ImageViewer} s=${s} key=${i} />`;
    if (s.kind === 'status') return html`<${StatusViewer} s=${s} key=${i} />`;
    if (s.kind === 'grant' || s.kind === 'incoming') return null;
    const mid = s.kind === 'confirm' || s.kind === 'prompt';
    let inner;
    if (s.kind === 'menu') inner = html`<${Menu} s=${s} />`;
    else if (s.kind === 'confirm') inner = html`<${Confirm} s=${s} />`;
    else if (s.kind === 'prompt') inner = html`<${Prompt} s=${s} />`;
    else if (s.kind === 'profile') inner = html`<${ProfileSheet} s=${s} />`;
    else if (s.kind === 'group') inner = html`<${GroupSheet} s=${s} />`;
    else if (s.kind === 'newgroup') inner = html`<${NewGroup} s=${s} />`;
    else if (s.kind === 'emoji') inner = html`<${EmojiSheet} s=${s} />`;
    else if (s.kind === 'gif') inner = html`<${GifPicker} s=${s} />`;
    else if (s.kind === 'poll') inner = html`<${PollSheet} s=${s} />`;
    else if (s.kind === 'schedule') inner = html`<${ScheduleSheet} s=${s} />`;
    else if (s.kind === 'forward') inner = html`<${ForwardSheet} s=${s} />`;
    else if (s.kind === 'pins') inner = html`<${PinsSheet} s=${s} />`;
    else if (s.kind === 'media') inner = html`<${MediaSheet} s=${s} />`;
    else if (s.kind === 'status-new') inner = html`<${StatusNew} s=${s} />`;
    else if (s.render) inner = s.render(s);
    const cancel = () => { ctx.closeSheet(s); if (s.res) s.res(s.kind === 'confirm' ? false : null); };
    return html`<div class=${'backdrop' + (mid ? ' mid' : '')} key=${i} onClick=${(e) => e.target === e.currentTarget && cancel()}>
      ${mid ? inner : html`<div class=${'sheet' + (FULL.has(s.kind) ? ' full' : '')}>${FULL.has(s.kind) ? null : html`<div class="grab"></div>`}${inner}</div>`}</div>`;
  })}`;
}
