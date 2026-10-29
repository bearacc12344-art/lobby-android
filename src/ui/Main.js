import { html, useBus, useEffect, useState } from './h.js';
import { ctx } from '../ctx.js';
import { tr } from '../util/i18n.js';
import { ChatList } from './ChatList.js';
import { ChatView } from './ChatView.js';
import { Friends } from './Friends.js';
import { Sheets } from './Sheets.js';
import { SettingsHome, SettingsPage } from './Settings.js';
import { BrainHub } from './Brain.js';
import { MusicScreen } from './Music.js';
import { CallLayer } from './Call.js';

const TABS = [['chats', '💬', 'Chats'], ['friends', '👥', 'Friends'], ['brain', '🧠', 'Brain'], ['music', '🎵', 'Music'], ['settings', '⚙️', 'Settings']];

function Screen({ s }) {
  if (s.kind === 'chat') return html`<${ChatView} cid=${s.cid} key=${'c' + s.cid} jump=${s.jump} />`;
  if (s.kind === 'settings') return html`<${SettingsPage} page=${s.page} />`;
  if (s.kind === 'custom') return s.render();
  return null;
}

export function Main() {
  useBus(['nav', 'store', 'conn'], (ev, t) => ev !== 'store' || ['init', 'synced', 'relation', 'chat', 'message', 'read', 'chat_removed'].includes(t));
  const st = ctx.store;
  const unread = st.totalUnread();
  const pending = st.pendingIn().length;
  const top = ctx.stack[ctx.stack.length - 1];
  return html`<div class="screen">
    ${ctx.conn === 'reconnecting' ? html`<div class="conn" style=${{ paddingTop: 'calc(6px + env(safe-area-inset-top))' }}>${tr("⚠️  Offline — can't reach any relay, retrying... (your messages will send when it's back)")}</div>` : null}
    <div style=${{ flex: 1, position: 'relative', minHeight: 0 }}>
      <div class="screen" style=${{ display: top ? 'none' : 'flex' }}>
        ${ctx.tab === 'chats' ? html`<${ChatList} />` : ctx.tab === 'friends' ? html`<${Friends} />` : ctx.tab === 'brain' ? html`<${BrainHub} />`
          : ctx.tab === 'music' ? html`<${MusicScreen} />` : html`<${SettingsHome} />`}
      </div>
      ${ctx.stack.map((s, i) => html`<div class="screen pushed" key=${i + ':' + s.kind} style=${{ display: i === ctx.stack.length - 1 ? 'flex' : 'none' }}><${Screen} s=${s} /></div>`)}
    </div>
    ${top ? null : html`<nav class="bottomnav">${TABS.map(([k, ic, label]) => html`<button class=${ctx.tab === k ? 'on' : ''} onClick=${() => ctx.setTab(k)}>
      <span class="ic">${ic}</span><span>${tr(label)}</span>
      ${k === 'chats' && unread ? html`<i class="navbadge">${unread > 99 ? '99+' : unread}</i>` : null}
      ${k === 'friends' && pending ? html`<i class="navbadge">${pending}</i>` : null}
    </button>`)}</nav>`}
    <${CallLayer} />
    <${Sheets} />
  </div>`;
}
