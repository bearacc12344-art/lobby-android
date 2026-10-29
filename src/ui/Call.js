import { html, useBus, useEffect, useRef, useState } from './h.js';
import { I } from '../util/icons.js';
import { ctx } from '../ctx.js';
import { S } from '../util/settings.js';
import { tr } from '../util/i18n.js';
import { fmtDur } from '../util/format.js';
import { CALL_REACTIONS } from '../util/emoji.js';
import { Avatar, ChatAvatar } from './common.js';
import { boardSounds } from '../util/sounds.js';

const call = () => import('../media/call.js');

export function CallBar({ chatId }) {
  useBus(['callstate']);
  const s = ctx.call;
  if (!s || ctx.callFull) return null;
  if (chatId && s.chatId !== chatId && false) return null;
  const c = ctx.store.chats[s.chatId];
  return html`<div class="callbar" onClick=${() => { ctx.callFull = true; ctx.bus.emit('callstate'); }}>
    <span class="emoji">${I('🔊')}</span><span class="grow ellipsis">${tr('🔊 Voice connected').replace('🔊 ', '')} · ${c ? ctx.store.chatTitle(c) : ''}</span>
    <button class="iconbtn" onClick=${(e) => { e.stopPropagation(); s.setMuted(!s.muted); }}>${I(s.muted ? '🔇' : '🎙️')}</button>
    <button class="iconbtn red" onClick=${(e) => { e.stopPropagation(); ctx.leaveCall(); }}>${I('📞')}</button></div>`;
}

function Incoming({ r }) {
  const st = ctx.store;
  const u = st.users[r.from] || {};
  const c = st.chats[r.call.chat_id];
  const decline = (reason = '') => call().then((m) => m.declineCall(ctx, r.call.id, reason));
  const msg = () => ctx.menu([...S.get('quick_replies').concat(["Can't talk right now", "I'll call you back", 'In a game rn 🎮', 'Text me instead']).slice(0, 10)
    .map((q) => ({ label: q, fn: () => decline(tr(q)) })), { ic: '✏️', label: 'Custom...', fn: async () => { const t = await ctx.prompt('Send:'); if (t) decline(t); } }], tr('Decline with a message'));
  return html`<div class="incoming">
    <div class="small" style=${{ opacity: 0.8 }}>${r.video ? tr('📹 Video call') : tr('📞 Incoming call')}</div>
    ${c && c.kind === 'group' ? html`<${ChatAvatar} chat=${c} size=${110} />` : html`<${Avatar} user=${u} size=${110} presence=${false} />`}
    <b style=${{ fontSize: '1.6em' }}>${st.name(r.from)}</b>
    ${c && c.kind === 'group' ? html`<div>${st.chatTitle(c)}</div>` : null}
    ${r.silent ? html`<div class="small" style=${{ opacity: 0.7 }}>${I('🔕')} ${tr('Do not disturb')}</div>` : null}
    <div class="btns">
      <div class="col" style=${{ alignItems: 'center' }}><button class="iconbtn red" onClick=${() => decline()}>${I('📞')}</button><span class="small">${tr('Decline')}</span></div>
      <div class="col" style=${{ alignItems: 'center' }}><button class="iconbtn" style=${{ background: '#444' }} onClick=${msg}>${I('💬')}</button><span class="small">${tr('Message')}</span></div>
      <div class="col" style=${{ alignItems: 'center' }}><button class="iconbtn" style=${{ background: '#444' }} onClick=${() => ctx.joinCall(r.call.id, { muted: true })}>${I('🔇')}</button><span class="small">${tr('Join muted')}</span></div>
      <div class="col" style=${{ alignItems: 'center' }}><button class="iconbtn green pulse" onClick=${() => ctx.joinCall(r.call.id, { video: r.video })}>${I('📞')}</button><span class="small">${tr('Accept')}</span></div>
    </div></div>`;
}

function Tile({ uid, kind, focus, onTap }) {
  const s = ctx.call;
  const cv = useRef(null);
  const vid = useRef(null);
  const me = uid === ctx.store.myId;
  useEffect(() => {
    if (!kind || me) return;
    const draw = () => {
      const bmp = s && s.frames.get(`${uid}:${kind}`);
      const c = cv.current;
      if (!bmp || !c) return;
      if (c.width !== bmp.width || c.height !== bmp.height) { c.width = bmp.width; c.height = bmp.height; }
      c.getContext('2d').drawImage(bmp, 0, 0);
    };
    draw();
    return ctx.bus.on('callframe', (u, k) => { if (u === uid && k === kind) requestAnimationFrame(draw); });
  }, [uid, kind]);
  useEffect(() => { if (me && kind === 2 && vid.current && s && s.camStream) vid.current.srcObject = s.camStream; }, [kind, s && s.camStream]);
  const u = ctx.store.users[uid] || {};
  const m = s.members.get(uid) || {};
  const lvl = (s.audio.levels[me ? 0 : uid] || 0) > 0.02;
  return html`<div class=${'tile' + (lvl ? ' speaking' : '') + (focus ? ' focus' : '')} onClick=${onTap}>
    ${kind ? (me && kind === 2 ? html`<video ref=${vid} autoplay muted playsinline style=${{ transform: S.get('mirror') && s.cam && s.cam.facing === 'user' ? 'scaleX(-1)' : 'none' }}></video>`
      : me && kind === 3 ? html`<div class="col" style=${{ alignItems: 'center' }}><span class="emoji" style=${{ fontSize: '3em' }}>${I('🖥️')}</span><span class="small">${tr('You are sharing your screen')}</span></div>`
        : html`<canvas ref=${cv}></canvas>`)
      : html`<${Avatar} user=${u} size=${focus ? 120 : 76} presence=${false} />`}
    <div class="label">${m.muted || m.deaf ? '🔇 ' : ''}${kind === 3 ? '🖥️ ' : ''}${me ? tr('You') : ctx.store.name(uid)}${s.localMuted.has(uid) ? ' 🙉' : ''}</div></div>`;
}

function CallScreen() {
  useBus(['callstate', 'store'], (ev, t) => ev === 'callstate' || ['user', 'call'].includes(t));
  const s = ctx.call;
  const [, setTick] = useState(0);
  const [focus, setFocus] = useState(null);
  const [floats, setFloats] = useState([]);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 400); return () => clearInterval(t); }, []);
  useEffect(() => ctx.bus.on('callreact', (d) => {
    const id = Math.random();
    setFloats((f) => [...f, { id, emoji: d.emoji, x: 10 + Math.random() * 70, sound: d.sound, from: d.from }]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 2500);
  }), []);
  if (!s) return null;
  const st = ctx.store;
  const me = st.myId;
  const tiles = [];
  for (const [uid, m] of s.members) {
    if (m.screen) tiles.push([uid, 3]);
    tiles.push([uid, m.cam ? 2 : 0]);
  }
  if (!s.members.has(me)) tiles.push([me, s.cam ? 2 : 0]);
  const shown = focus ? tiles.filter(([u, k]) => `${u}:${k}` === focus) : tiles;
  const cols = shown.length <= 1 ? 1 : shown.length <= 4 ? (shown.length <= 2 ? 1 : 2) : 3;
  const c = st.chats[s.chatId];
  const notIn = c ? (c.kind === 'group' ? c.members.map((m) => m.id) : [st.dmOther(c)]).filter((u) => u !== me && !s.members.has(u)) : [];
  const leave = async () => { if (!S.get('confirm_leave_call') || await ctx.confirm('Leave the call?')) ctx.leaveCall(); };
  const soundboard = async () => {
    const built = (await boardSounds()).map((b) => ({ ...b, builtin: true }));
    const mine = S.get('sounds') || [];
    ctx.sheet({ kind: 'custom', render: () => html`<div><b>${tr('🔊 Soundboard')}</b>
      <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginTop: '10px' }}>
        ${[...built, ...mine].map((b) => html`<button class="btn" style=${{ flexDirection: 'column', minHeight: '74px' }} onClick=${() => s.playSound(b)}>
          <span class="emoji" style=${{ fontSize: '1.6em' }}>${b.emoji}</span><span class="tiny">${b.name}</span></button>`)}</div>
      <div class="small muted" style=${{ marginTop: '10px' }}>${tr('Everyone in the call hears these. Right-click to rename / remove. wav, ogg, flac (mp3 if your libsndfile supports it).').split('.')[0]}.</div></div>` });
  };
  const reactions = () => ctx.sheet({ kind: 'menu', items: [{ row: CALL_REACTIONS.slice(0, 6), fn: (e) => s.react(e) }, { row: CALL_REACTIONS.slice(6), fn: (e) => s.react(e) }], title: tr('Send a reaction') });
  const more = () => ctx.menu([
    { ic: '🔊', label: 'Soundboard', fn: soundboard },
    s.cam ? { ic: '🔄', label: 'Flip camera', fn: () => s.flipCam() } : null,
    { ic: s.speaker ? '📱' : '🔈', label: s.speaker ? 'Use the earpiece' : 'Use the loudspeaker', fn: () => s.setSpeaker(!s.speaker) },
    { ic: '🎧', label: s.deaf ? 'Undeafen' : 'Deafen (hear nothing)', fn: () => s.setDeaf(!s.deaf) },
    notIn.length ? { ic: '📳', label: 'Ring someone into the call', fn: () => ctx.menu(notIn.map((u) => ({ label: st.name(u), fn: () => ctx.api('call_ring', { user_id: u }) })), tr('Ring someone into the call')) } : null,
    ...[...s.members.keys()].filter((u) => u !== me).map((u) => ({ ic: '🙉', label: (s.localMuted.has(u) ? tr('🙉 Unmute for me').replace('🙉 ', '') : tr('🙉 Mute for me').replace('🙉 ', '')) + ' · ' + st.name(u), fn: () => s.toggleLocalMute(u) })),
    { ic: '💬', label: 'Open chat', fn: () => { ctx.callFull = false; ctx.bus.emit('callstate'); ctx.openChat(s.chatId); } },
  ]);
  const dur = fmtDur(Date.now() / 1000 - s.started);
  return html`<div class="callscreen">
    <div class="row" style=${{ padding: 'calc(8px + env(safe-area-inset-top)) 10px 0', color: '#fff' }}>
      <button class="iconbtn" style=${{ color: '#fff' }} onClick=${() => { ctx.callFull = false; ctx.bus.emit('callstate'); }}>${I('⬇️')}</button>
      <div class="grow"><b>${c ? st.chatTitle(c) : ''}</b><div class="small" style=${{ opacity: 0.7 }}>${dur}${s.ringing.size ? tr('  ·  🔔 ringing ') : ''}
        ${ctx.net.bytes ? ` · ↑${Math.round(ctx.net.bytes.up / 1024)}K ↓${Math.round(ctx.net.bytes.down / 1024)}K` : ''}</div></div></div>
    <div class="tiles" style=${{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      ${shown.map(([uid, kind]) => html`<${Tile} key=${uid + ':' + kind} uid=${uid} kind=${kind} focus=${!!focus}
        onTap=${() => setFocus(focus ? null : `${uid}:${kind}`)} />`)}</div>
    ${floats.map((f) => html`<div class="floating" key=${f.id} style=${{ left: f.x + '%', bottom: '120px' }}>${f.emoji}${f.sound ? html`<div class="tiny" style=${{ fontFamily: 'var(--font)' }}>${st.name(f.from)}: ${f.sound}</div>` : null}</div>`)}
    <div class="callctl">
      <button class=${'iconbtn' + (s.muted ? ' on' : '')} onClick=${() => s.setMuted(!s.muted)}>${I(s.muted ? '🔇' : '🎙️')}</button>
      <button class=${'iconbtn' + (s.cam ? ' on' : '')} onClick=${() => (s.cam ? s.stopCam() : s.startCam())}>${I('📷')}</button>
      <button class=${'iconbtn' + (s.screen ? ' on' : '')} onClick=${() => (s.screen ? s.stopScreen() : s.startScreen())}>${I('🖥️')}</button>
      <button class="iconbtn" onClick=${reactions}>${I('😀')}</button>
      <button class="iconbtn" onClick=${soundboard}>${I('🔊')}</button>
      <button class="iconbtn" onClick=${more}>⋯</button>
      <button class="iconbtn red" onClick=${leave}>${I('📞', 'red')}</button>
    </div></div>`;
}

export function CallLayer() {
  useBus(['callstate']);
  const rings = [...ctx.rings.values()];
  return html`${ctx.call && ctx.callFull ? html`<${CallScreen} />` : null}${rings.length ? html`<${Incoming} r=${rings[rings.length - 1]} />` : null}`;
}
