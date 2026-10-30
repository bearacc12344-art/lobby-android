import { html, useBus, useEffect, useRef, useState, useForce } from './h.js';
import { I } from '../util/icons.js';
import { ctx } from '../ctx.js';
import { S } from '../util/settings.js';
import { tr } from '../util/i18n.js';
import { fmtTime, dayLabel, fmtSize, fmtDur, PRESENCE_LABEL, fmtAgo } from '../util/format.js';
import { mdHtml, isEmojiOnly, applyShortcodes, SLASH } from '../util/md.js';
import { QUICK_REACTIONS } from '../util/emoji.js';
import { fileUrl, cachedUrl, getFile, saveFile, openFile, pickFiles, readFile, extOf, AUDIO_EXT, VIDEO_EXT } from '../util/files.js';
import { Avatar, ChatAvatar, Badges } from './common.js';
import { longPress } from './press.js';
import { CallBar } from './Call.js';
import { EMOJI_NAMES } from '../util/emoji.js';
import * as stickers from '../stickers.js';

const GROUP_GAP = 300;

// ------------------------------------------------------------------ attachments
function useFileUrl(fid, auto) {
  const [url, setUrl] = useState(cachedUrl(fid));
  const [err, setErr] = useState(null);
  const [want, setWant] = useState(auto);
  useEffect(() => {
    if (!want || url || !fid) return;
    let alive = true;
    fileUrl(fid).then((u) => alive && setUrl(u), (e) => alive && setErr(e.message || String(e)));
    return () => { alive = false; };
  }, [fid, want]);
  return [url, err, () => setWant(true)];
}

function StickerAtt({ m }) {
  const [url, err] = useFileUrl(m.file.id, true);    // stickers are small: always load them
  return html`<div class="sticker">${url ? html`<img src=${url} alt="sticker" onClick=${() => ctx.sheet({ kind: 'image', url, name: m.file.name, fid: m.file.id })} />`
    : html`<span class="muted">${err ? '⚠️' : I('🎴')}</span>`}</div>`;
}

function ImageAtt({ m }) {
  const [url, err, load] = useFileUrl(m.file.id, S.get('auto_download_images'));
  const gif = ['gif', 'webp'].includes(extOf(m.file.name));
  if (err) return html`<div class="muted small">${tr("⚠️ couldn't load image")}</div>`;
  if (!url) return html`<div class="filecard" onClick=${load}><span class="ic">${I('🖼️')}</span><div class="grow small">${S.get('auto_download_images') ? tr('🖼️ loading image...') : tr(`🖼️ ${m.file.name} · ${fmtSize(m.file.size)} — click to load`)}</div></div>`;
  return html`<div class="attach"><img src=${url} loading="lazy" style=${gif && !S.get('autoplay_gifs') ? { filter: 'grayscale(0.2)' } : null}
    onClick=${() => ctx.sheet({ kind: 'image', url, name: m.file.name, fid: m.file.id })} /></div>`;
}

function VideoAtt({ m }) {
  const [url, err, load] = useFileUrl(m.file.id, false);
  if (url) return html`<div class="attach"><video src=${url} controls playsinline preload="metadata"></video></div>`;
  return html`<div class="filecard" onClick=${load}><span class="ic">🎬</span><div class="grow"><div class="ellipsis">${m.file.name}</div>
    <div class="tiny muted">${err ? '⚠️ ' + err : fmtSize(m.file.size) + ' · ' + tr('Play')}</div></div></div>`;
}

let playingAudio = null;
function AudioAtt({ m }) {
  const [url, , load] = useFileUrl(m.file.id, false);
  const [st, setSt] = useState({ playing: false, t: 0, d: 0 });
  const a = useRef(null);
  useEffect(() => () => { if (a.current) { a.current.pause(); if (playingAudio === a.current) { playingAudio = null; ctx.music && ctx.music.duck(false); } } }, []);
  async function toggle() {
    if (!a.current) {
      let u = url;
      if (!u) { load(); u = await fileUrl(m.file.id).catch(() => null); }
      if (!u) return ctx.toast("Couldn't load audio", 'error');
      const el = new Audio(u);
      a.current = el;
      el.ontimeupdate = () => setSt((s) => ({ ...s, t: el.currentTime, d: el.duration || 0 }));
      el.onloadedmetadata = () => setSt((s) => ({ ...s, d: el.duration || 0 }));
      el.onended = () => { setSt((s) => ({ ...s, playing: false, t: 0 })); playingAudio = null; ctx.music && ctx.music.duck(false); };
    }
    const el = a.current;
    if (el.paused) {
      if (playingAudio && playingAudio !== el) playingAudio.pause();
      playingAudio = el;
      ctx.music && ctx.music.duck(true);
      await el.play().catch(() => {});
      setSt((s) => ({ ...s, playing: true }));
    } else {
      el.pause();
      setSt((s) => ({ ...s, playing: false }));
      ctx.music && ctx.music.duck(false);
    }
  }
  const seek = (e) => {
    if (!a.current || !st.d) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.current.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * st.d;
  };
  return html`<div class="audiocard"><button class="iconbtn" onClick=${toggle}>${I(st.playing ? '⏸️' : '▶️')}</button>
    <div class="grow"><div class="bar" onClick=${seek}><i style=${{ width: (st.d ? (st.t / st.d) * 100 : 0) + '%' }}></i></div>
    <div class="tiny muted" style=${{ marginTop: '4px' }}>${m.kind === 'voice' ? '🎤 ' + tr('Voice message') : m.file.name} · ${st.d ? fmtDur(st.t) + ' / ' + fmtDur(st.d) : fmtSize(m.file.size)}</div></div></div>`;
}

function FileAtt({ m }) {
  const [busy, setBusy] = useState(false);
  async function get(open) {
    setBusy(true);
    try {
      const f = await getFile(m.file.id);
      if (open) await openFile(f.name, f.bytes); else await saveFile(f.name, f.bytes);
    } catch (e) { ctx.toast(e.message || String(e), 'error'); }
    setBusy(false);
  }
  return html`<div class="filecard" onClick=${() => get(true)}><span class="ic">${I('📎')}</span><div class="grow"><div class="ellipsis">${m.file.name}</div>
    <div class="tiny muted">${fmtSize(m.file.size)}${busy ? ' · ⏳' : ''}</div></div>
    <button class="iconbtn" onClick=${(e) => { e.stopPropagation(); get(false); }}>${I('⬇️')}</button></div>`;
}

function Attachment({ m }) {
  if (!m.file) return null;
  const e = extOf(m.file.name);
  if (m.kind === 'image' && m.file.sticker) return html`<${StickerAtt} m=${m} />`;
  if (m.kind === 'image') return html`<${ImageAtt} m=${m} />`;
  if (m.kind === 'voice' || AUDIO_EXT.has(e)) return html`<${AudioAtt} m=${m} />`;
  if (VIDEO_EXT.has(e)) return html`<${VideoAtt} m=${m} />`;
  return html`<${FileAtt} m=${m} />`;
}

function Poll({ m }) {
  const p = m.poll;
  if (!p) return null;
  const total = new Set(Object.values(p.votes).flat()).size || 0;
  const me = ctx.store.myId;
  return html`<div class="poll"><div>${I('📊')} <b>${m.body || tr('Poll')}</b> <span class="tiny muted">${p.multi ? tr('multiple choice') : ''}</span></div>
    ${p.options.map((o, i) => {
      const v = p.votes[i] || [];
      const pct = total ? Math.round((v.length / total) * 100) : 0;
      return html`<div class=${'opt' + (v.includes(me) ? ' mine' : '')} onClick=${() => ctx.api('vote', { msg_id: m.id, option: i })}>
        <i style=${{ width: pct + '%' }}></i><span>${o} <span class="muted small">· ${v.length} (${pct}%)</span></span></div>`;
    })}
    <div class="tiny muted" style=${{ marginTop: '4px' }}>${total ? `${total} 🗳️` : tr('No votes yet')}</div></div>`;
}

function callText(m) {
  let d = {};
  try { d = JSON.parse(m.body); } catch (e) {}
  if (d.event === 'missed') return d.by === ctx.store.myId ? tr('📵 No answer') : '📵 ' + tr('Missed call');
  return `📞 ${tr('Call ended')} · ${fmtDur(d.duration || 0)}`;
}

// ------------------------------------------------------------------ one message
function Message({ m, prev, chat, onMenu, highlight, isLast }) {
  const st = ctx.store;
  const [spoil, setSpoil] = useState(false);
  if (m.kind === 'system' || m.kind === 'nudge') return html`<div class="sysmsg">${m.kind === 'nudge' ? '👋 ' : ''}${tr(m.body)} · ${fmtTime(m.created)}</div>`;
  if (m.kind === 'call') return html`<div class="sysmsg">${callText(m)} · ${fmtTime(m.created)}</div>`;
  const mine = m.sender === st.myId;
  const grouped = prev && prev.sender === m.sender && !['system', 'call', 'nudge'].includes(prev.kind) && m.created - prev.created < GROUP_GAP;
  const u = st.users[m.sender];
  const rows = S.get('message_style') === 'rows';
  const showAv = S.get('show_avatars') && (rows || (!mine && chat.kind === 'group'));
  const big = !m.deleted && S.get('big_emoji') && !m.file && isEmojiOnly(m.body);
  const reacts = Object.entries(m.reactions || {});
  let body;
  if (m.deleted) body = html`<div class="body muted"><i>${I('🚫')} ${tr('This message was deleted')}</i></div>`;
  else if (m.kind === 'poll') body = html`<${Poll} m=${m} />`;
  else {
    body = html`${m.file ? html`<${Attachment} m=${m} />` : null}
      ${m.body ? html`<div class=${'body selectable' + (big ? ' big' : '')} onClick=${(e) => { if (e.target.classList.contains('spoiler')) setSpoil(true); }}
        dangerouslySetInnerHTML=${{ __html: big ? m.body.replace(/[<>&]/g, '') : mdHtml(m.body, st.me ? st.me.username : '', spoil) }}></div>` : null}`;
  }
  return html`<div class=${'msg' + (mine ? ' me' : '') + (grouped ? ' grouped' : '') + (highlight ? ' highlight' : '')} id=${'m' + m.id}>
    ${showAv ? html`<div class="avcol">${grouped ? null : html`<${Avatar} user=${u} size=${36} presence=${false} onClick=${() => ctx.profile(m.sender)} />`}</div>` : null}
    <div class=${'bub' + (m.file && m.file.sticker && !m.deleted ? ' stk' : '')} ...${longPress(() => onMenu(m))}>
      ${!grouped && (rows || (!mine && chat.kind === 'group')) ? html`<div class="who"><span style=${{ color: (u && u.color) || 'var(--accent)' }}>${st.name(m.sender)}</span>
        <${Badges} list=${u && u.badges} max=${3} />${rows ? html`<span class="tiny muted">${fmtTime(m.created)}</span>` : null}</div>` : null}
      ${m.reply ? html`<div class="reply" onClick=${() => ctx.bus.emit('jump', m.reply.id)}><b>${st.name(m.reply.sender)}</b> <span class="muted">${m.reply.body}</span></div>` : null}
      ${body}
      ${reacts.length ? html`<div class="reacts">${reacts.map(([e, us]) => html`<span class=${'react' + (us.includes(st.myId) ? ' mine' : '')}
        onClick=${(ev) => { ev.stopPropagation(); ctx.api('react', { msg_id: m.id, emoji: e }); }}><span class="emoji" data-raw=${1}>${e}</span> ${us.length}</span>`)}</div>` : null}
      ${rows ? (m.edited && S.get('show_edits') ? html`<span class="tiny muted">${tr('(edited)')}</span>` : null)
        : html`<span class="time">${m.silent ? '🤫 ' : ''}${m.edited && S.get('show_edits') ? tr('(edited)') + ' ' : ''}${fmtTime(m.created)}${mine && isLast ? '' : ''}</span>`}
    </div></div>`;
}

// ------------------------------------------------------------------ voice recorder (16 kHz WAV, plays everywhere incl. PC Smult)
class Recorder {
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const { audioCtx } = await import('../util/audioctx.js');
    this.ac = audioCtx();
    this.src = this.ac.createMediaStreamSource(this.stream);
    this.proc = this.ac.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.proc.onaudioprocess = (e) => this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    this.src.connect(this.proc);
    this.proc.connect(this.ac.destination);
    this.t0 = Date.now();
  }
  stop() {
    try { this.proc.disconnect(); this.src.disconnect(); } catch (e) {}
    this.stream.getTracks().forEach((t) => t.stop());
    const rate = this.ac.sampleRate, out = 16000;
    const n = this.chunks.reduce((a, c) => a + c.length, 0);
    const all = new Float32Array(n);
    let o = 0;
    for (const c of this.chunks) { all.set(c, o); o += c.length; }
    const m = Math.floor(n * out / rate);
    const pcm = new Int16Array(m);
    for (let i = 0; i < m; i++) pcm[i] = Math.max(-1, Math.min(1, all[Math.floor(i * rate / out)])) * 32767;
    const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
    const w = (p, s) => { for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, out, true); v.setUint32(28, out * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    new Uint8Array(buf, 44).set(new Uint8Array(pcm.buffer));
    return { bytes: new Uint8Array(buf), secs: (Date.now() - this.t0) / 1000 };
  }
  cancel() { try { this.proc.disconnect(); this.src.disconnect(); } catch (e) {} this.stream.getTracks().forEach((t) => t.stop()); }
}

// ------------------------------------------------------------------ composer
function Composer({ chat, reply, setReply, edit, setEdit, onSent }) {
  const st = ctx.store;
  const drafts = S.get('drafts') || {};
  const [text, setText] = useState(drafts[chat.id] || '');
  const [silent, setSilent] = useState(false);
  const [rec, setRec] = useState(null);
  const [recT, setRecT] = useState(0);
  const ta = useRef(null);
  const typingT = useRef(0);
  useEffect(() => { if (edit) { setText(edit.body); setTimeout(() => ta.current && ta.current.focus(), 50); } }, [edit]);
  useEffect(() => { if (reply && ta.current) ta.current.focus(); }, [reply]);
  useEffect(() => {
    if (!ta.current) return;
    ta.current.style.height = 'auto';
    ta.current.style.height = Math.min(140, ta.current.scrollHeight) + 'px';
  }, [text]);
  useEffect(() => () => { const d = { ...(S.get('drafts') || {}) }; if (taVal.current) d[chat.id] = taVal.current; else delete d[chat.id]; S.set('drafts', d); }, []);
  const taVal = useRef(text);
  taVal.current = text;
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setRecT((Date.now() - rec.t0) / 1000), 250);
    return () => clearInterval(t);
  }, [rec]);

  // @mention / :shortcode: suggestions
  const word = (text.match(/(?:^|\s)([@:][\w.]{1,20})$/) || [])[1] || '';
  let sugg = [];
  if (word.startsWith('@')) {
    const ids = chat.kind === 'group' ? chat.members.map((x) => x.id) : [st.dmOther(chat)];
    sugg = ids.filter((id) => id !== st.myId).map((id) => st.users[id]).filter((u) => u && u.username.toLowerCase().startsWith(word.slice(1).toLowerCase()))
      .map((u) => ({ label: `@${u.username} · ${u.display}`, ins: '@' + u.username + ' ' }));
    if ('everyone'.startsWith(word.slice(1).toLowerCase()) && chat.kind === 'group') sugg.push({ label: '@everyone', ins: '@everyone ' });
  } else if (word.startsWith(':') && word.length > 2) {
    const q = word.slice(1).toLowerCase();
    sugg = Object.entries(EMOJI_NAMES).filter(([, n]) => n.split(' ').some((x) => x.startsWith(q))).slice(0, 8).map(([e, n]) => ({ label: `${e}  :${n.split(' ')[0]}:`, ins: e + ' ' }));
  }
  const pick = (s) => setText(text.slice(0, text.length - word.length) + s.ins);

  function onInput(e) {
    setText(e.target.value);
    if (Date.now() - typingT.current > 3000 && e.target.value) {
      typingT.current = Date.now();
      ctx.try(ctx.api('typing', { chat_id: chat.id }, { quiet: true }));
    }
  }

  function slash(t) {
    const sp = t.indexOf(' ');
    const cmd = (sp < 0 ? t : t.slice(0, sp)).toLowerCase(), rest = sp < 0 ? '' : t.slice(sp + 1);
    const name = st.me.display;
    if (SLASH[cmd]) return [(rest ? rest + ' ' : '') + SLASH[cmd], false];
    if (cmd === '/me') return [`*${name} ${rest}*`, false];
    if (cmd === '/spoiler') return [`||${rest}||`, false];
    if (cmd === '/silent') return [rest, true];
    if (cmd === '/roll') { const n = /^\d+$/.test(rest.trim()) ? +rest : 6; return [`🎲 rolled **${1 + Math.floor(Math.random() * Math.max(1, n))}** (1-${n})`, false]; }
    if (cmd === '/coin') return [`🪙 flipped **${Math.random() < 0.5 ? 'heads' : 'tails'}**`, false];
    if (cmd === '/8ball') return [`🎱 ${rest}\n> ${['yes', 'no', 'maybe', 'ask again later', 'definitely', 'absolutely not', 'idk bro'][Math.floor(Math.random() * 7)]}`, false];
    if (cmd === '/nudge') { ctx.api('nudge', { chat_id: chat.id }); return true; }
    if (cmd === '/poll') {
      const parts = rest.split('|').map((x) => x.trim());
      if (parts.length >= 3) ctx.api('send', { chat_id: chat.id, body: parts[0], poll: { options: parts.slice(1) } });
      else ctx.sheet({ kind: 'poll', cid: chat.id });
      return true;
    }
    if (cmd === '/schedule') { ctx.sheet({ kind: 'schedule', cid: chat.id, body: rest }); return true; }
    if (cmd === '/call') { ctx.startCall(chat.id); return true; }
    if (cmd === '/help') { ctx.toast('Commands: /shrug /tableflip /unflip /lenny /me /spoiler /silent /roll [n] /coin /8ball /nudge /poll Q | a | b /schedule /call', 'info', 7000); return true; }
    return [t, false];
  }

  async function send() {
    let t = text.trim();
    if (!t) return;
    if (edit) {
      await ctx.api('edit', { msg_id: edit.id, body: applyShortcodes(t) });
      setEdit(null); setText('');
      return;
    }
    let sil = silent;
    if (t.startsWith('/')) {
      const r = slash(t);
      if (r === true) { setText(''); return; }
      [t, sil] = [r[0], r[1] || silent];
    }
    const d = { chat_id: chat.id, body: applyShortcodes(t) };
    if (reply) d.reply_to = reply.id;
    if (sil) d.silent = true;
    setText(''); setReply(null); setSilent(false);
    ctx.play('sent', { vol: 0.25 });
    onSent();
    try { await ctx.api('send', d); } catch (e) { setText(t); }
  }

  async function sendFiles(files) {
    for (const f of files) {
      if (f.size > st.maxFile) { ctx.toast(`${f.name} is too big (max ${fmtSize(st.maxFile)})`, 'error'); continue; }
      if (f.size > 32 * 1024) ctx.toast(`Uploading ${f.name} (${fmtSize(f.size)})...`);
      const d = { chat_id: chat.id, body: '', file: { name: f.name || 'file', bytes: await readFile(f) } };
      if (reply) { d.reply_to = reply.id; setReply(null); }
      onSent();
      await ctx.try(ctx.api('send', d));
    }
  }

  async function sendSticker(e) {
    const r = reply;
    setReply(null);
    ctx.play('sent', { vol: 0.25 });
    onSent();
    await ctx.try(stickers.send(chat.id, e, r ? r.id : null));
  }

  function attach() {
    ctx.menu([
      { ic: '🖼️', label: 'Photos & videos', fn: async () => sendFiles(await pickFiles({ accept: 'image/*,video/*' })) },
      { ic: '📷', label: 'Take a photo', fn: async () => sendFiles(await pickFiles({ accept: 'image/*', multiple: false, capture: 'environment' })) },
      { ic: '📎', label: 'File(s)...', fn: async () => sendFiles(await pickFiles()) },
      { ic: '📊', label: 'Poll', fn: () => ctx.sheet({ kind: 'poll', cid: chat.id }) },
      { ic: '⏰', label: 'Schedule message', fn: () => ctx.sheet({ kind: 'schedule', cid: chat.id, body: text }) },
      { ic: '⚡', label: 'Quick replies', fn: () => ctx.menu(S.get('quick_replies').map((q) => ({ label: q, fn: () => ctx.api('send', { chat_id: chat.id, body: q }) })), tr('Quick replies')) },
      { ic: '🤫', label: silent ? 'Silent: on (tap to turn off)' : 'Silent: send without notifying', fn: () => setSilent(!silent) },
      { ic: '👋', label: 'Nudge (shakes their window)', fn: () => ctx.api('nudge', { chat_id: chat.id }) },
    ]);
  }

  async function micDown() {
    if (rec) return;
    try {
      const r = new Recorder();
      await r.start();
      setRec(r); setRecT(0);
    } catch (e) { ctx.toast("Couldn't use the microphone: " + (e.message || e), 'error'); }
  }
  async function micSend() {
    if (!rec) return;
    const r = rec;
    setRec(null);
    const { bytes, secs } = r.stop();
    if (secs < 0.6) return ctx.toast('Hold on a bit longer to record');
    onSent();
    await ctx.try(ctx.api('send', { chat_id: chat.id, body: '', file: { name: `voice_${Date.now()}.wav`, bytes, voice: true } }));
  }
  const micCancel = () => { if (rec) { rec.cancel(); setRec(null); } };

  return html`<div class="composer">
    ${sugg.length ? html`<div class="suggest">${sugg.map((s) => html`<div onClick=${() => pick(s)}>${s.label}</div>`)}</div>` : null}
    ${reply ? html`<div class="ctx"><span class="emoji">${I('↩️')}</span><span class="grow ellipsis">${tr('Reply')} · <b>${st.name(reply.sender)}</b>: ${reply.body || (reply.file || {}).name || ''}</span>
      <button class="iconbtn" onClick=${() => setReply(null)}>${I('✖️')}</button></div>` : null}
    ${edit ? html`<div class="ctx"><span class="emoji">${I('✏️')}</span><span class="grow">${tr('✏️ Editing message  ·  Esc to cancel').replace('✏️ ', '').split('·')[0]}</span>
      <button class="iconbtn" onClick=${() => { setEdit(null); setText(''); }}>${I('✖️')}</button></div>` : null}
    ${silent ? html`<div class="ctx">${I('🤫')} ${tr('Silent: send without notifying')}</div>` : null}
    <div class="bar">
      ${rec ? html`<div class="rec"><span class="dot"></span>${fmtDur(recT)} · ${tr('🎙 Recording... click again to send').replace('🎙 ', '')}</div>
          <button class="iconbtn" onClick=${micCancel}>${I('🗑️')}</button><button class="iconbtn send" onClick=${micSend}>${I('➤')}</button>`
        : html`<button class="iconbtn" onClick=${attach}>${I('➕')}</button>
          <button class="iconbtn" onClick=${() => ctx.sheet({ kind: 'emoji', onPick: (e) => setText((t) => t + e) })}>${I('😀')}</button>
          <button class="iconbtn" onClick=${() => ctx.sheet({ kind: 'sticker', onPick: sendSticker })}>${I('🎴')}</button>
          <textarea ref=${ta} rows="1" placeholder=${tr('Message...')} value=${text} onInput=${onInput}
            onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey && S.get('enter_to_send')) { e.preventDefault(); send(); } if (e.key === 'Escape' && edit) { setEdit(null); setText(''); } }}></textarea>
          ${text.trim() ? html`<button class="iconbtn send" onClick=${send}>${I('➤')}</button>`
            : html`<button class="iconbtn" onClick=${() => ctx.sheet({ kind: 'gif', onPick: (f) => sendFiles([f]) })} style=${{ fontSize: '0.85em', fontWeight: 700 }}>GIF</button>
              <button class="iconbtn" onClick=${micDown}>${I('🎙️')}</button>`}`}
    </div></div>`;
}

// ------------------------------------------------------------------ the chat screen
export function ChatView({ cid, jump }) {
  const st = ctx.store;
  const force = useForce();
  const [msgs, setMsgs] = useState(null);
  const [more, setMore] = useState(true);
  const [reply, setReply] = useState(null);
  const [edit, setEdit] = useState(null);
  const [hl, setHl] = useState(jump || null);
  const [search, setSearch] = useState(null);
  const [shake, setShake] = useState(false);
  const list = useRef(null);
  const stick = useRef(true);
  const firstUnread = useRef(null);
  const chat = st.chats[cid];

  async function loadInitial() {
    const c = st.chats[cid];
    firstUnread.current = c && c.unread ? c.my.last_read : null;
    let arr;
    if (jump) arr = await ctx.api('around', { msg_id: jump });
    else arr = await ctx.api('history', { chat_id: cid, limit: S.get('load_count') });
    const map = new Map(arr.map((m) => [m.id, m]));
    st.msgs[cid] = map;
    setMore(arr.length >= (jump ? 1 : S.get('load_count')));
    setMsgs([...map.values()]);
  }
  useEffect(() => { loadInitial(); return () => { delete st.msgs[cid]; }; }, [cid]);
  useEffect(() => ctx.bus.on('store', (t, d) => {
    if ((t === 'message' || t === 'message_update') && d.msg.chat_id === cid && st.msgs[cid]) {
      setMsgs([...st.msgs[cid].values()].sort((a, b) => a.id - b.id));
      if (t === 'message' && d.msg.sender === st.myId) stick.current = true;
    } else if (['chat', 'read', 'typing', 'user', 'call', 'relation'].includes(t)) force();
    else if (t === 'chat_removed' && d.chat_id === cid) ctx.pop();
  }), [cid]);
  useEffect(() => ctx.bus.on('jump', (mid) => jumpTo(mid)), [cid]);
  useEffect(() => ctx.bus.on('nudge', (d) => { if (d.chat_id === cid) { setShake(true); setTimeout(() => setShake(false), 600); } }), [cid]);

  // keep scrolled to bottom when new stuff arrives, mark as read
  useEffect(() => {
    const el = list.current;
    if (!el || !msgs) return;
    if (hl) {
      const target = el.querySelector('#m' + hl);
      if (target) { target.scrollIntoView({ block: 'center' }); setTimeout(() => setHl(null), 2500); }
    } else if (stick.current) el.scrollTop = el.scrollHeight;
    markRead();
  }, [msgs]);
  useEffect(() => ctx.bus.on('foreground', (on) => on && markRead()), [msgs]);

  function markRead() {
    const c = st.chats[cid];
    if (!c || !msgs || !msgs.length || !ctx.foreground || ctx.current !== cid) return;
    const last = msgs[msgs.length - 1];
    if (last.id > c.my.last_read || c.unread) ctx.try(ctx.api('read', { chat_id: cid, msg_id: Math.max(last.id, c.last ? c.last.id : 0) }, { quiet: true }));
  }

  async function loadOlder() {
    if (!msgs || !msgs.length || !more || loadOlder.busy) return;
    loadOlder.busy = true;
    const el = list.current, h0 = el.scrollHeight;
    const arr = await ctx.api('history', { chat_id: cid, before: msgs[0].id, limit: 60 });
    for (const m of arr) st.msgs[cid].set(m.id, m);
    setMore(arr.length >= 60);
    stick.current = false;
    setMsgs([...st.msgs[cid].values()].sort((a, b) => a.id - b.id));
    requestAnimationFrame(() => { el.scrollTop += el.scrollHeight - h0; loadOlder.busy = false; });
  }
  function onScroll(e) {
    const el = e.currentTarget;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 200) loadOlder();
  }
  async function jumpTo(mid) {
    if (st.msgs[cid] && st.msgs[cid].has(mid)) { setHl(mid); setMsgs([...st.msgs[cid].values()].sort((a, b) => a.id - b.id)); return; }
    const arr = await ctx.api('around', { msg_id: mid });
    st.msgs[cid] = new Map(arr.map((m) => [m.id, m]));
    stick.current = false;
    setHl(mid);
    setMsgs(arr);
  }

  function msgMenu(m) {
    const mine = m.sender === st.myId;
    const admin = ['owner', 'admin'].includes(st.role(cid));
    const pinned = (st.chats[cid].pins || []).includes(m.id);
    const items = [];
    if (!m.deleted) {
      items.push({ row: QUICK_REACTIONS, fn: (e) => ctx.api('react', { msg_id: m.id, emoji: e }) });
      items.push({ ic: '↩️', label: 'Reply', fn: () => setReply(m) });
      if (m.body) items.push({ ic: '📋', label: 'Copy text', fn: () => { navigator.clipboard.writeText(m.body).then(() => ctx.toast('Copied!')); } });
      if (mine && m.kind === 'text') items.push({ ic: '✏️', label: 'Edit', fn: () => setEdit(m) });
      items.push({ ic: '📌', label: pinned ? 'Unpin' : 'Pin', fn: () => ctx.api('pin', { msg_id: m.id }) });
      items.push({ ic: '➡️', label: 'Forward', fn: () => ctx.sheet({ kind: 'forward', msg: m }) });
      items.push({ ic: '⏰', label: 'Remind me', fn: () => remind(m) });
      if (m.file) {
        items.push({ ic: '⬇️', label: 'Save attachment', fn: async () => { const f = await getFile(m.file.id); saveFile(f.name, f.bytes); } });
        if (m.kind === 'image') items.push({ ic: '🎴', label: 'Add to stickers', fn: () => ctx.try(stickers.addFromMessage(m).catch((e) => { ctx.toast(e.message || String(e), 'error'); })) });
        if (['gif', 'webp'].includes(extOf(m.file.name))) items.push({ ic: '⭐', label: 'Save to my GIFs', fn: async () => {
          const f = await getFile(m.file.id); const { saveMyGif } = await import('../gifs.js'); await saveMyGif(f.name, f.bytes); ctx.toast('⭐ Saved to My GIFs'); } });
      }
      items.push({ ic: '😀', label: 'Add reaction', fn: () => ctx.sheet({ kind: 'emoji', onPick: (e) => ctx.api('react', { msg_id: m.id, emoji: e }), close: true }) });
    }
    if (m.sender !== st.myId && m.sender) items.push({ ic: '👤', label: 'View profile', fn: () => ctx.profile(m.sender) });
    if (!m.deleted && (mine || admin)) items.push({ ic: '🗑️', label: 'Delete', danger: true, fn: async () => {
      if (!S.get('confirm_delete') || await ctx.confirm('Delete this message for everyone?', { danger: true, ok: 'Delete' })) ctx.api('delete', { msg_id: m.id });
    } });
    ctx.menu(items);
  }
  function remind(m) {
    const at = (mins) => async () => {
      const notes = st.dmWith(st.myId) || await ctx.api('open_dm', { user_id: st.myId });
      const txt = `⏰ Reminder: "${(m.body || (m.file || {}).name || '').slice(0, 200)}" — from ${st.name(m.sender)} in ${st.chatTitle(chat)}`;
      await ctx.api('schedule', { chat_id: notes.id, body: txt, send_at: Date.now() / 1000 + mins * 60 });
      ctx.toast("⏰ I'll remind you in your Notes to self", 'ok');
    };
    const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return (d - Date.now()) / 60000; };
    ctx.menu([{ label: 'In 20 minutes', fn: at(20) }, { label: 'In 1 hour', fn: at(60) }, { label: 'In 3 hours', fn: at(180) }, { label: 'Tomorrow', fn: () => at(tomorrow())() }], tr('⏰  Remind me').trim());
  }

  if (!chat) return html`<div class="screen"><div class="topbar"><button class="iconbtn" onClick=${() => ctx.pop()}>${I('⬅️')}</button></div></div>`;
  const title = st.chatTitle(chat);
  let sub = '';
  const typing = st.typingNames(cid);
  const other = chat.kind === 'dm' ? st.dmOther(chat) : null;
  if (typing.length) sub = typing.length === 1 ? tr(`✏️ ${typing[0]} is typing...`) : tr(`✏️ ${typing.join(', ')} are typing...`);
  else if (chat.kind === 'group') {
    const on = chat.members.filter((x) => (st.users[x.id] || {}).presence && !['offline', 'invisible'].includes(st.users[x.id].presence)).length;
    sub = tr(`${chat.members.length} members · ${on} online`) + (chat.topic ? ' · ' + chat.topic : '');
  } else if (other === st.myId) sub = tr('Your private notes · only you can see this');
  else {
    const u = st.users[other] || {};
    sub = u.presence && u.presence !== 'offline' ? tr(PRESENCE_LABEL[u.presence] || 'Online') : u.last_seen ? tr(`last seen ${fmtAgo(u.last_seen)}`) : tr('Offline');
    if (u.status_msg) sub += ' · ' + u.status_msg;
  }
  const pins = chat.pins || [];
  // receipts for my last message
  let seen = '';
  if (msgs && msgs.length) {
    const lastMine = [...msgs].reverse().find((m) => m.sender === st.myId && !['system', 'call', 'nudge'].includes(m.kind));
    if (lastMine && lastMine.id === msgs[msgs.length - 1].id) {
      const readers = Object.entries(chat.reads || {}).filter(([, mid]) => mid >= lastMine.id).map(([u]) => +u);
      seen = readers.length ? (chat.kind === 'dm' ? tr('✓✓ Seen') : '✓✓ ' + readers.map((u) => st.name(u)).join(', ')) : tr('✓ Sent');
    }
  }
  const menu = () => ctx.menu([
    { ic: '🔍', label: 'Search in chat (Ctrl+F)'.replace(' (Ctrl+F)', ''), fn: () => setSearch({ q: '', res: null }) },
    { ic: '📌', label: `Pinned messages${pins.length ? ' (' + pins.length + ')' : ''}`, fn: () => ctx.sheet({ kind: 'pins', cid }) },
    { ic: '🖼️', label: 'Media & files', fn: () => ctx.sheet({ kind: 'media', cid }) },
    chat.kind === 'group' ? { ic: 'ℹ️', label: 'Group info', fn: () => ctx.sheet({ kind: 'group', cid }) } : { ic: '👤', label: 'View profile', fn: () => ctx.profile(other) },
    { ic: '👋', label: 'Nudge (shakes their window)', fn: () => ctx.api('nudge', { chat_id: cid }) },
    { ic: chat.my.muted ? '🔔' : '🔕', label: chat.my.muted ? 'Unmute' : 'Mute', fn: () => ctx.api('chat_prefs', { chat_id: cid, muted: !chat.my.muted }) },
  ], title);

  let prev = null, lastDay = '';
  const items = [];
  for (const m of msgs || []) {
    const day = dayLabel(m.created);
    if (day !== lastDay) { items.push(html`<div class="daysep" key=${'d' + m.id}>${day}</div>`); lastDay = day; prev = null; }
    if (firstUnread.current !== null && m.id > firstUnread.current && m.sender !== st.myId && !items.newDone) {
      items.push(html`<div class="newsep" key="new">${tr('NEW MESSAGES')}</div>`); items.newDone = true;
    }
    items.push(html`<${Message} key=${m.id} m=${m} prev=${prev} chat=${chat} onMenu=${msgMenu} highlight=${hl === m.id} />`);
    prev = m;
  }
  const call = chat.call;
  return html`<div class=${'screen' + (shake ? ' shake' : '')}>
    <div class="topbar">
      <button class="iconbtn" onClick=${() => ctx.pop()}>${I('⬅️')}</button>
      <div onClick=${() => (chat.kind === 'group' ? ctx.sheet({ kind: 'group', cid }) : ctx.profile(other))}><${ChatAvatar} chat=${chat} size=${38} /></div>
      <div class="title" onClick=${() => (chat.kind === 'group' ? ctx.sheet({ kind: 'group', cid }) : ctx.profile(other))}>
        <b>${title} ${chat.kind === 'dm' && other !== st.myId ? html`<${Badges} list=${(st.users[other] || {}).badges} max=${3} />` : null}</b>
        <div class="small ellipsis" style=${{ color: typing.length ? 'var(--accent)' : 'var(--muted)' }}>${sub}</div></div>
      ${other !== st.myId ? html`<button class="iconbtn" onClick=${() => ctx.startCall(cid, false)}>${I('📞')}</button>
        <button class="iconbtn" onClick=${() => ctx.startCall(cid, true)}>${I('📹')}</button>` : null}
      <button class="iconbtn" onClick=${menu}>⋮</button>
    </div>
    ${search ? html`<${SearchBar} cid=${cid} s=${search} set=${setSearch} onPick=${(mid) => { setSearch(null); jumpTo(mid); }} />` : null}
    <${CallBar} chatId=${cid} />
    ${call && (!ctx.call || ctx.call.callId !== call.id) ? html`<div class="callbar" onClick=${() => ctx.joinCall(call.id)}>${I('🔊')} ${tr('Call in progress')} · ${tr(`${call.members.length} in call`)}
      <span class="spacer"></span><b>${tr('Join call')}</b></div>` : null}
    ${pins.length ? html`<div class="card" style=${{ margin: '6px 8px 0', padding: '6px 12px' }} onClick=${() => ctx.sheet({ kind: 'pins', cid })}>
      <span class="small">${tr(`📌  ${pins.length} pinned message${pins.length > 1 ? 's' : ''} — click to see`)}</span></div>` : null}
    <div class=${'content' + (S.get('message_style') === 'rows' ? ' rows' : '')} ref=${list} onScroll=${onScroll}>
      <div class="msgs">${msgs === null ? html`<div class="empty">⏳</div>` : items}</div>
      ${seen ? html`<div class="seen">${seen}</div>` : null}
    </div>
    <div class="typing">${typing.length ? sub : ''}</div>
    <${TransferBar} />
    <${Composer} chat=${chat} reply=${reply} setReply=${setReply} edit=${edit} setEdit=${setEdit} onSent=${() => { stick.current = true; }} key=${cid} />
  </div>`;
}

function SearchBar({ cid, s, set, onPick }) {
  const st = ctx.store;
  async function run(q) {
    if (!q.trim()) return set({ q, res: null });
    const res = await ctx.api('search', { chat_id: cid, q });
    set({ q, res });
  }
  return html`<div style=${{ background: 'var(--panel)', borderBottom: '1px solid var(--border)', maxHeight: '45%', overflowY: 'auto' }}>
    <div class="row" style=${{ padding: '6px 8px' }}><input class="field" autofocus placeholder=${tr('Search messages in this chat... (Enter)')} value=${s.q}
      onInput=${(e) => set({ ...s, q: e.target.value })} onKeyDown=${(e) => e.key === 'Enter' && run(e.target.value)} />
      <button class="iconbtn" onClick=${() => set(null)}>${I('✖️')}</button></div>
    ${s.res ? (s.res.length ? s.res.map((m) => html`<div class="pad" style=${{ borderTop: '1px solid var(--border)' }} onClick=${() => onPick(m.id)}>
      <div class="small"><b>${st.name(m.sender)}</b> <span class="muted">${dayLabel(m.created)} ${fmtTime(m.created)}</span></div>
      <div class="ellipsis">${m.body || (m.file || {}).name}</div></div>`) : html`<div class="pad muted">${tr('No results 👀')}</div>`) : null}
  </div>`;
}

// ⬆/⬇ progress for big files (parts go up/down in parallel)
function TransferBar() {
  useBus(['transfer']);
  const live = Object.values(ctx.transfers).filter((x) => !x.finished);
  if (!live.length) return null;
  const done = live.reduce((a, x) => a + x.done, 0), total = live.reduce((a, x) => a + x.total, 0) || 1;
  const speed = live.reduce((a, x) => a + x.speed, 0);
  const left = speed > 1 ? (total - done) / speed : 0;
  const names = live.slice(0, 2).map((x) => (x.kind === 'up' ? '⬆ ' : '⬇ ') + x.name).join(', ') + (live.length > 2 ? ` +${live.length - 2}` : '');
  return html`<div style=${{ padding: '4px 14px 0' }}><div class="small muted ellipsis">${names} — ${Math.floor(done * 100 / total)}% · ${fmtSize(speed)}/s${left >= 1 ? ` · ${Math.round(left)}s` : ''}</div>
    <div class="progress" style=${{ height: '5px', marginTop: '3px' }}><i style=${{ width: (done * 100 / total) + '%' }}></i></div></div>`;
}
