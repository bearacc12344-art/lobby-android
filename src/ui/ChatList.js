import { html, useBus, useState } from './h.js';
import { I } from '../util/icons.js';
import { ctx } from '../ctx.js';
import { S } from '../util/settings.js';
import { tr } from '../util/i18n.js';
import { fmtShort } from '../util/format.js';
import { ChatAvatar, Empty } from './common.js';
import { longPress } from './press.js';
import { CallBar } from './Call.js';
import { StatusRow } from './Status.js';

export function preview(c) {
  const st = ctx.store, m = c.last;
  if (S.get('streamer_mode')) return tr('hidden (streamer mode)');
  if (!m) return tr('no messages yet');
  if (m.deleted) return tr('message deleted');
  let body = m.body, ic = null;
  if (m.kind === 'image' && m.file && m.file.sticker) { ic = '🎴'; body = tr('Sticker'); }
  else if (m.kind === 'image') { ic = '🖼️'; body = m.body || tr('🖼️ Photo').replace('🖼️ ', ''); }
  else if (m.kind === 'voice') { ic = '🎤'; body = tr('🎤 Voice message').replace('🎤 ', ''); }
  else if (m.kind === 'file') { ic = '📎'; body = (m.file || {}).name || 'file'; }
  else if (m.kind === 'poll') { ic = '📊'; body = m.body || tr('Poll'); }
  else if (m.kind === 'call') { ic = '📞'; body = tr('📞 Call').replace('📞 ', ''); }
  const who = m.sender === st.myId ? tr('You:') + ' ' : c.kind === 'group' && m.kind !== 'system' ? st.name(m.sender) + ': ' : '';
  const txt = who + (body || '').replace(/\n/g, ' ');
  return ic ? [I(ic), ' ', txt] : txt;
}

function chatMenu(c) {
  const p = (k, v) => ctx.api('chat_prefs', { chat_id: c.id, [k]: v });
  const items = [
    { ic: '📌', label: c.my.pinned ? 'Unpin' : 'Pin to top', fn: () => p('pinned', !c.my.pinned) },
    c.my.muted ? { ic: '🔔', label: 'Unmute', fn: () => p('muted', false) } : { ic: '🔕', label: 'Mute', fn: () => p('muted', true) },
    { ic: '✔', label: 'Mark as read', fn: () => c.last && ctx.api('read', { chat_id: c.id, msg_id: c.last.id }) },
    { ic: '🗄️', label: c.my.archived ? 'Unarchive' : 'Archive', fn: () => p('archived', !c.my.archived) },
  ];
  if (c.kind === 'group') items.push({ ic: '🚪', label: 'Leave group', danger: true, fn: async () => { if (await ctx.confirm('Leave this group?', { danger: true })) ctx.api('group_leave', { chat_id: c.id }); } });
  ctx.menu(items, ctx.store.chatTitle(c));
}

export function newMenu() {
  ctx.menu([
    { ic: '➕', label: 'Add a friend', fn: () => { ctx.setTab('friends'); setTimeout(() => ctx.bus.emit('focus-add'), 50); } },
    { ic: '👥', label: 'New group', fn: () => ctx.sheet({ kind: 'newgroup' }) },
    { ic: '📝', label: 'Notes to self', fn: () => ctx.openDm(ctx.store.myId) },
  ]);
}

export function ChatList() {
  useBus(['store', 'nav'], (ev, t) => ev === 'nav' || ['init', 'synced', 'chat', 'chat_removed', 'message', 'message_update', 'read', 'typing', 'user', 'relation', 'call'].includes(t));
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const st = ctx.store;
  let chats = Object.values(st.chats);
  const nArch = chats.filter((c) => c.my.archived).length;
  chats = chats.filter((c) => !!c.my.archived === archived);
  if (q) chats = Object.values(st.chats).filter((c) => st.chatTitle(c).toLowerCase().includes(q.toLowerCase()));
  chats.sort((a, b) => (b.my.pinned - a.my.pinned) || ((b.last ? b.last.id : b.created * 4096000) - (a.last ? a.last.id : a.created * 4096000)));
  const h = new Date().getHours();
  const greet = h >= 5 && h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : h < 23 ? 'Good evening' : 'Up late';
  return html`<div class="topbar"><h1>${tr('Chats')}</h1>
      <button class="iconbtn" onClick=${() => ctx.profile(st.myId)}>${I('👤')}</button></div>
    <${CallBar} />
    <div class="content">
      <div style=${{ padding: '10px 12px 4px' }}>
        <input class="field" placeholder=${tr('Find a chat   (Ctrl+K)').replace('   (Ctrl+K)', '')} value=${q} onInput=${(e) => setQ(e.target.value)} />
      </div>
      ${!q && !archived ? html`<${StatusRow} />` : null}
      ${!q && st.me ? html`<div class="small muted" style=${{ padding: '2px 16px 4px' }}>${tr(greet)}, ${st.me.display}. ${st.synced ? '' : '⏳'}</div>` : null}
      ${archived ? html`<div class="item" style=${{ padding: '10px 16px', color: 'var(--accent)' }} onClick=${() => setArchived(false)}>${tr('⬅ Back to chats')}</div>` : null}
      <div class="list">
        ${!archived && !q && nArch ? html`<div class="item" onClick=${() => setArchived(true)}><span class="emoji" style=${{ fontSize: '1.6em', width: '44px', textAlign: 'center' }}>${I('🗄️')}</span>
          <span class="grow">${tr(`🗄️ Archived (${nArch})`).replace('🗄️ ', '')}</span></div>` : null}
        ${chats.map((c) => {
          const typing = st.typingNames(c.id);
          return html`<div class="item chatrow" key=${c.id} ...${longPress(() => chatMenu(c), () => ctx.openChat(c.id))}>
            <${ChatAvatar} chat=${c} size=${50} />
            <div class="grow"><div class="row"><b class="grow ellipsis">${c.kind === 'group' ? '' : ''}${st.chatTitle(c)}</b></div>
              <div class="prev ellipsis" data-raw=${1} style=${typing.length ? { color: 'var(--accent)' } : null}>
                ${c.call ? [I('🔊'), ' ', tr('Call in progress')] : typing.length ? tr(`${typing.join(', ')} typing...`) : preview(c)}</div></div>
            <div class="meta"><span class="tiny muted">${c.last ? fmtShort(c.last.created) : ''}</span>
              <span class="row" style=${{ gap: '4px' }}>${c.my.pinned ? html`<span class="emoji tiny">${I('📌')}</span>` : null}${c.my.muted ? html`<span class="emoji tiny">${I('🔕')}</span>` : null}
              ${c.unread ? html`<span class=${'badge' + (c.mentions ? ' red' : c.my.muted ? ' grey' : '')}>${c.mentions ? '@' : c.unread}</span>` : null}</span></div>
          </div>`;
        })}
      </div>
      ${!chats.length ? html`<${Empty} text=${q ? 'No results 👀' : 'No chats yet - add a friend first 👋'}>
        ${!q ? html`<div style=${{ marginTop: '14px' }}><button class="btn primary" onClick=${() => ctx.setTab('friends')}>${tr('➕ Add a friend')}</button></div>` : null}</${Empty}>` : null}
      <div style=${{ height: '90px' }}></div>
    </div>
    <button class="fab emoji" onClick=${newMenu}>${I('✏️')}</button>`;
}
