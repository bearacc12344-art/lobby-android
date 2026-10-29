import { AppLogo } from '../util/logo.js';
import { ThemesPage } from './Themes.js';
import { html, useBus, useEffect, useState } from './h.js';
import { I } from '../util/icons.js';
import { ctx } from '../ctx.js';
import { S } from '../util/settings.js';
import { tr, LANGS, detect, lang } from '../util/i18n.js';
import { THEMES, palette } from './theme.js';
import { Avatar, Check, Slider, Select, TopBar, Switch, Badges, useAsync } from './common.js';
import { AVATAR_CHOICES, COLOR_CHOICES } from '../util/emoji.js';
import { SEASON_CHOICES, currentSeason, SEASON_ICON } from '../util/sounds.js';
import { pickFiles, clearFileCache } from '../util/files.js';
import { prepareAvatar } from '../util/image.js';
import { isNative, LobbyNative } from '../native.js';

const PAGES = [
  ['account', '👤', 'My Account'], ['privacy', '🛡️', 'Privacy & Trust'], ['themes', '🖼', 'Themes'], ['appearance', '🎨', 'Appearance'], ['notifications', '🔔', 'Notifications'],
  ['voice', '🎙️', 'Voice & Video'], ['soundboard', '🔊', 'Soundboard'], ['chat', '💬', 'Chat'], ['brain', '🧠', 'The Smult Brain'],
  ['advanced', '⚙️', 'Advanced'], ['admin', '🏅', 'Admin & badges'], ['about', 'ℹ️', 'About'],
];

export function SettingsHome() {
  useBus(['store'], (ev, t) => t === 'user' || t === 'init');
  const me = ctx.store.me || {};
  return html`<div class="topbar"><h1>${tr('Settings')}</h1></div>
    <div class="content">
      <div class="row pad" onClick=${() => ctx.push({ kind: 'settings', page: 'account' })}><${Avatar} user=${me} size=${60} />
        <div class="grow"><b style=${{ fontSize: '1.2em' }}>${me.display}</b><div class="small muted">${me.friend_code}</div>${me.status_msg ? html`<div class="small">${me.status_msg}</div>` : null}
        <${Badges} list=${me.badges} max=${3} /></div></div>
      <div class="list">${PAGES.filter(([k]) => k !== 'admin' || me.role).map(([k, ic, label]) => html`<div class="item" style=${{ minHeight: '54px' }}
        onClick=${() => ctx.push({ kind: 'settings', page: k })}><span class="emoji" style=${{ fontSize: '1.3em', width: '30px', textAlign: 'center' }}>${ic}</span>
        <span class="grow">${tr(label)}</span><span class="muted">›</span></div>`)}</div>
      <div class="pad"><button class="btn block" onClick=${async () => { if (await ctx.confirm('Log out?')) ctx.logout(); }}>${tr('Log out')}</button></div>
    </div>`;
}

function Page({ title, children, sub }) {
  return html`<${TopBar} title=${tr(title)} /><div class="content" style=${{ padding: '4px 16px 40px' }}>${sub ? html`<div class="small muted" style=${{ margin: '10px 0' }}>${tr(sub)}</div>` : null}${children}</div>`;
}
const Sec = ({ t }) => html`<div class="section">${tr(t)}</div>`;
const Note = ({ t }) => html`<div class="small muted" style=${{ margin: '4px 0 8px' }}>${tr(t)}</div>`;

// server-side privacy setting
function Priv({ k, label, options }) {
  useBus(['store'], (ev, t) => t === 'user');
  const p = (ctx.store.me || {}).privacy || {};
  return html`<div class="row" style=${{ padding: '8px 0' }}><span class="grow">${tr(label)}</span>
    <select class="field" style=${{ width: 'auto', maxWidth: '60%' }} value=${String(p[k])} onChange=${(e) => {
      const o = options.find((x) => String(x[0]) === e.target.value);
      ctx.api('update_profile', { privacy: { [k]: o[0] } });
    }}>${options.map(([v, t]) => html`<option value=${String(v)}>${tr(t)}</option>`)}</select></div>`;
}
function PrivCheck({ k, label }) {
  useBus(['store'], (ev, t) => t === 'user');
  const p = (ctx.store.me || {}).privacy || {};
  return html`<label class="check" onClick=${(e) => { e.preventDefault(); ctx.api('update_profile', { privacy: { [k]: !p[k] } }); }}>
    <span class="grow">${tr(label)}</span><${Switch} on=${!!p[k]} /></label>`;
}

function Account() {
  useBus(['store'], (ev, t) => t === 'user');
  const me = ctx.store.me || {};
  const [disp, setDisp] = useState(me.display || '');
  const [status, setStatus] = useState(me.status_msg || '');
  const [bio, setBio] = useState(me.bio || '');
  const save = () => ctx.api('update_profile', { display: disp, status_msg: status, bio }).then(() => ctx.toast('Profile saved ✨', 'ok'));
  async function pic() {
    const [f] = await pickFiles({ accept: 'image/*', multiple: false });
    if (!f) return;
    ctx.toast('🖼 Preparing your picture...');
    try {
      const a = await prepareAvatar(f);
      if (a.kind === 'gif') ctx.toast('🖼 Uploading your animated GIF...');
      await ctx.api('set_avatar', a);
      ctx.toast(`✨ New profile ${a.kind === 'gif' ? 'animated GIF' : 'picture'} set!`, 'ok');
    } catch (e) { ctx.toast(e.message || String(e), 'error'); }
  }
  return html`<${Page} title="My Account">
    <div class="col" style=${{ alignItems: 'center', margin: '14px 0' }}><${Avatar} user=${me} size=${96} />
      <div class="row wrap" style=${{ justifyContent: 'center' }}><button class="btn small" onClick=${pic}>${tr('🖼 Use a picture or GIF...')}</button>
      ${me.pic ? html`<button class="btn small" onClick=${() => ctx.api('set_avatar', { kind: 'none' })}>${tr('Remove picture')}</button>` : null}</div></div>
    <${Note} t="Pictures are cropped to a square. GIFs stay animated on your profile, your sidebar card and the chat header (small lists show the first frame)." />
    <${Sec} t="Display name" /><input class="field" value=${disp} onInput=${(e) => setDisp(e.target.value)} maxlength="32" />
    <${Sec} t="Custom status" /><input class="field" placeholder=${tr("Custom status, e.g. 'grinding the hotel 🚪'")} value=${status} onInput=${(e) => setStatus(e.target.value)} maxlength="120" />
    <${Sec} t="About me" /><textarea class="field" rows="3" value=${bio} onInput=${(e) => setBio(e.target.value)} maxlength="500"></textarea>
    <div style=${{ marginTop: '12px' }}><button class="btn primary block" onClick=${save}>${tr('Save profile')}</button></div>
    <${Sec} t="Emoji avatar (used when you have no picture)" />
    <div class="egrid" style=${{ padding: 0 }}>${['', ...AVATAR_CHOICES].map((e) => html`<button style=${me.avatar === e ? { background: 'var(--accent)' } : null}
      onClick=${() => ctx.api('update_profile', { avatar: e })}>${e || 'Aa'}</button>`)}</div>
    <div class="row wrap" style=${{ marginTop: '8px' }}>${COLOR_CHOICES.map((c) => html`<button style=${{ width: '36px', height: '36px', borderRadius: '18px', background: c,
      border: me.color === c ? '3px solid var(--text)' : '1px solid var(--border)' }} onClick=${() => ctx.api('update_profile', { color: c })}></button>`)}</div>
    <${Sec} t="Friend code" /><div class="row"><b class="grow selectable">${me.friend_code}</b>
      <button class="btn small" onClick=${() => navigator.clipboard.writeText(me.friend_code).then(() => ctx.toast('Copied!'))}>${I('📋')}</button></div>
    <${Note} t="Share this so friends can add you even if someone else picked a similar name." />
    <${Sec} t="Account" /><${Note} t="Your account lives on your friends' and the relays' copies, not on a server. Your username + password generate your key, so they can't be changed or reset." />
    <${Check} k="remember" label="Stay logged in on this computer (stores your key on this PC)" />
  </${Page}>`;
}

function Privacy() {
  return html`<${Page} title="Privacy & Trust" sub="⭐ Trusted friends are your inner circle. You choose who's trusted, per friend.">
    <${Sec} t="Presence" /><${Priv} k="presence" label="My status" options=${[['online', '🟢 Online'], ['idle', '🌙 Idle'], ['dnd', '⛔ Do not disturb'], ['invisible', '👻 Invisible']]} />
    <${Note} t="Invisible: you look offline to everyone except trusted friends." />
    <${Sec} t="Who can..." />
    <${Priv} k="friend_requests" label="Send me friend requests" options=${[['everyone', 'Everyone'], ['nobody', 'Nobody']]} />
    <${Priv} k="calls_from" label="Call me" options=${[['friends', 'All friends'], ['trusted', '⭐ Trusted friends only']]} />
    <${Priv} k="group_invites" label="Add me to groups" options=${[['friends', 'All friends'], ['trusted', '⭐ Trusted friends only']]} />
    <${Priv} k="last_seen" label="See my last seen" options=${[['friends', 'Friends'], ['trusted', '⭐ Trusted only'], ['nobody', 'Nobody']]} />
    <${Sec} t="Signals" /><${PrivCheck} k="read_receipts" label="Send read receipts (✓✓ Seen)" /><${PrivCheck} k="typing" label="Show when I'm typing" />
    <${Sec} t="Trust perks" /><${Check} k="dnd_trusted_bypass" label="⭐ Trusted friends can still ring/notify me in Do Not Disturb & quiet hours" />
    <${Check} k="auto_answer_trusted" label="⭐ Auto-answer calls from trusted friends (walkie-talkie mode)" />
    <${Sec} t="Streamer mode" /><${Check} k="streamer_mode" label="Hide message previews in the chat list and notifications" />
  </${Page}>`;
}

function Notifications() {
  const s = currentSeason();
  return html`<${Page} title="Notifications">
    <${Check} k="notify_desktop" label="Phone notifications (pop-ups)" /><${Check} k="notify_preview" label="Show message text in notifications" />
    <${Check} k="vibrate" label="Vibrate" /><${Check} k="notify_only_mentions_groups" label="In groups, only notify me when I'm @mentioned" />
    <${Check} k="keep_alive" label="Stay connected in the background" sub="Keeps a small notification so messages and calls arrive even when Smult is closed. Uses a little battery." />
    <${Sec} t="Sounds" /><${Check} k="notify_sounds" label="Play sounds" /><${Check} k="sound_message" label="New message" />
    <${Check} k="sound_mention" label="Mentions (different sound)" /><${Check} k="sound_join_leave" label="Someone joins / leaves a call" />
    <${Check} k="sound_friend" label="Friend requests" /><${Check} k="nudges" label="Allow nudges (shakes the window 👋)" />
    <${Slider} k="ui_volume" label="Notification volume" min=${0} max=${100} suffix="%" />
    <${Slider} k="ring_volume" label="Ringtone volume" min=${0} max=${100} suffix="%" />
    <div class="row wrap"><button class="btn small" onClick=${() => ctx.play('message', { force: true })}>${tr('▶ Test message')}</button>
      <button class="btn small" onClick=${() => ctx.play('mention', { force: true })}>${tr('▶ Test mention')}</button>
      <button class="btn small" onClick=${() => ctx.play('ring', { force: true, vol: S.get('ring_volume') / 100 })}>${tr('▶ Test ringtone')}</button>
      <button class="btn small" onClick=${() => ctx.play('nudge', { force: true })}>${tr('▶ Test nudge')}</button></div>
    <${Select} k="season" label="Seasonal sounds" options=${SEASON_CHOICES} />
    <${Note} t=${s ? `${SEASON_ICON[s]} ${s === 'halloween' ? 'Halloween' : 'Christmas'} sounds are on right now.` : 'The ringtone and message sounds change by themselves with the season.'} />
    <${Sec} t="Quiet hours" /><${Check} k="quiet_hours" label="Silence notifications during these hours (works like DND)" />
    <div class="row"><span>${tr('From')}</span><input class="field" type="time" style=${{ width: 'auto' }} value=${S.get('quiet_from')} onInput=${(e) => S.set('quiet_from', e.target.value)} />
      <span>${tr('to')}</span><input class="field" type="time" style=${{ width: 'auto' }} value=${S.get('quiet_to')} onInput=${(e) => S.set('quiet_to', e.target.value)} /></div>
  </${Page}>`;
}

function Appearance() {
  const [, set] = useState(0);
  const [langNow] = useState(lang());
  const [want, setWant] = useState(detect());
  return html`<${Page} title="Appearance">
    <${Sec} t="Language" /><${Select} k="language" label="Language" options=${LANGS} onChange=${() => setWant(detect())} />
    ${want !== langNow ? html`<button class="btn primary block" onClick=${() => location.reload()}>${tr('🔄 Restart now')}</button>` : null}
    <${Note} t="Chat messages from your friends are never translated, only Smult's own buttons and text." />
    <${Sec} t="Theme" />
    <button class="btn primary block" onClick=${() => ctx.push({ kind: 'settings', page: 'themes' })}>${tr('🎨 Themes, theme editor & backgrounds')}</button>
    <div class="row" style=${{ marginTop: '10px' }}><span class="grow">${tr('🎨 Custom accent color')}</span>
      <input type="color" value=${palette().accent} onInput=${(e) => S.set('accent', e.target.value)} />
      <button class="btn small" onClick=${() => { S.set('accent', ''); set((x) => x + 1); }}>${tr('Reset accent')}</button></div>
    <${Sec} t="Style" /><${Select} k="ui_skin" label="Look" options=${[['neon', 'Neon Glass (default)'], ['lux', 'Hotel Lux'], ['clean', 'Clean Pro'], ['', 'Classic']]} />
    <${Sec} t="Font" /><${Select} k="font" label="Font" options=${[['cut', 'Smult Cut (default)'], ['comic', 'Comic Sans'], ['doors', 'DOORS'], ['system', 'System font']]} />
    <${Slider} k="font_size" label="Text size" min=${12} max=${22} suffix="px" />
    <${Sec} t="Messages" /><${Select} k="message_style" label="Layout" options=${[['rows', 'Rows (Discord-ish)'], ['bubbles', 'Bubbles (WhatsApp-ish)']]} />
    <${Check} k="compact" label="Compact spacing" /><${Check} k="show_avatars" label="Show avatars" /><${Check} k="big_emoji" label="Big emoji when a message is only emoji" /><${Check} k="drawn_icons" label="Smult's drawn icons (instead of emoji)" onChange=${() => ctx.bus.emit('nav')} />
    <${Check} k="time_24h" label="24-hour clock" /><${Check} k="show_seconds" label="Show seconds" /><${Check} k="show_edits" label="Show (edited) tag" />
    <${Check} k="show_presence_dots" label="Show online dots on avatars" /><${Check} k="animations" label="Animations" />
  </${Page}>`;
}

function Voice() {
  return html`<${Page} title="Voice & Video" sub="Tip: use headphones so your friends don't hear themselves back.">
    <${Slider} k="mic_gain" label="Mic volume" min=${0} max=${200} suffix="%" /><${Slider} k="out_volume" label="Output volume" min=${0} max=${200} suffix="%" />
    <${Slider} k="gate_db" label="Noise gate" min=${-80} max=${-20} suffix=" dB" />
    <${Note} t="Sounds quieter than the gate aren't sent. Raise it if friends hear your keyboard/fan. The bar turns green when you'd be heard." />
    <${Check} k="echo_cancel" label="Echo cancellation (phone speaker)" /><${Check} k="highpass" label="Remove low rumble (desk bumps, AC hum)" />
    <${Check} k="speaker" label="Use the loudspeaker in calls" />
    <${Select} k="voice_quality" label="Voice quality" options=${[[16000, 'Data saver (16 kHz · ~128 kbps)'], [24000, 'Normal (24 kHz · ~190 kbps)'], [48000, 'Studio (48 kHz · ~384 kbps)']]} />
    <${Check} k="join_muted" label="Join calls muted" /><${Check} k="confirm_leave_call" label="Ask before leaving a call" />
    <${Sec} t="Camera" /><${Select} k="cam_res" label="Resolution" options=${[[240, '240p (potato)'], [360, '360p'], [480, '480p'], [720, '720p HD']]} />
    <${Select} k="cam_fps" label="Frame rate" options=${[[8, '8 fps'], [12, '12 fps'], [15, '15 fps'], [24, '24 fps']]} />
    <${Check} k="mirror" label="Mirror my camera" />
    <${Sec} t="Screen Share" /><${Select} k="screen_res" label="Max resolution" options=${[[480, '480p'], [720, '720p'], [1080, '1080p']]} />
    <${Select} k="screen_fps" label="Frame rate" options=${[[5, '5 fps'], [8, '8 fps'], [12, '12 fps'], [15, '15 fps']]} />
    <${Select} k="screen_codec" label="Codec" options=${[['jpg', 'JPEG (fast)'], ['webp', 'WebP (sharper text, more CPU)']]} />
    <${Slider} k="screen_quality" label="Quality" min=${40} max=${95} suffix="%" />
    <${Check} k="screen_audio" label="Share my phone's sound too" sub="Games, videos, music (Android 10+). Friends' voices are never included." />
  </${Page}>`;
}

function Soundboard() {
  const [list, setList] = useState(S.get('sounds') || []);
  const board = useAsync(() => import('../util/sounds.js').then((m) => m.boardSounds()), []);
  async function add() {
    const files = await pickFiles({ accept: 'audio/*' });
    const { idb } = await import('../net/idb.js');
    const n = [...list];
    for (const f of files) {
      const id = 'snd:' + Date.now() + Math.random().toString(16).slice(2, 6);
      await idb.put('kv', id, new Uint8Array(await f.arrayBuffer()));
      n.push({ id, name: f.name.replace(/\.[^.]+$/, '').slice(0, 30), emoji: '🔊' });
    }
    setList(n); S.set('sounds', n);
  }
  return html`<${Page} title="Soundboard" sub="Sounds you can blast into calls. Everyone in the call hears them.">
    ${(board.data || []).map((b) => html`<div class="row" style=${{ padding: '6px 0' }}><span class="emoji">${b.emoji}</span><span class="grow">${b.name}</span><span class="tiny muted">${tr('(built-in)')}</span></div>`)}
    ${list.map((s, i) => html`<div class="row" style=${{ padding: '6px 0' }}><span class="emoji">${s.emoji}</span><span class="grow">${s.name}</span>
      <button class="btn small" onClick=${async () => { const n = await ctx.prompt('Name:', { value: s.name }); if (n) { const l = [...list]; l[i] = { ...s, name: n }; setList(l); S.set('sounds', l); } }}>${I('✏️')}</button>
      <button class="btn small" onClick=${async () => { const e = await ctx.prompt('Emoji for this sound:', { value: s.emoji }); if (e) { const l = [...list]; l[i] = { ...s, emoji: e }; setList(l); S.set('sounds', l); } }}>${I('😀')}</button>
      <button class="btn small" onClick=${() => { const l = list.filter((x) => x !== s); setList(l); S.set('sounds', l); }}>${I('🗑️')}</button></div>`)}
    <button class="btn block" style=${{ marginTop: '10px' }} onClick=${add}>${tr('➕ Add sounds...')}</button>
    <${Slider} k="sound_volume" label="Soundboard volume" min=${0} max=${100} suffix="%" />
    <${Slider} k="sound_cooldown" label="Cooldown between sounds" min=${0} max=${5} step=${0.5} suffix=" s" />
  </${Page}>`;
}

function Chat() {
  const [qr, setQr] = useState((S.get('quick_replies') || []).join('\n'));
  const sched = useAsync(() => ctx.api('list_scheduled', {}, { quiet: true }), []);
  const [schedList, setSched] = useState(null);
  const items = schedList || sched.data || [];
  return html`<${Page} title="Chat">
    <${Check} k="enter_to_send" label="Enter sends (Shift+Enter for new line)" />
    <${Check} k="markdown" label="Formatting: **bold** *italic* __underline__ ~~strike~~ \`code\` ||spoiler||" />
    <${Check} k="shortcodes" label="Turn :skull: :fire: <3 :) etc. into emoji" />
    <${Check} k="auto_download_images" label="Auto-load images" /><${Check} k="confirm_delete" label="Ask before deleting messages" />
    <${Check} k="autoplay_gifs" label="Play GIFs automatically (off = they play when you hover them)" />
    <${Select} k="load_count" label="Messages loaded per chat" options=${[[30, '30'], [60, '60'], [100, '100'], [200, '200']]} />
    <${Sec} t="GIF search" /><${Note} t="GIF search just works, no account or key needed (it uses GIPHY's and Tenor's public search). Optional: if you ever have a KLIPY or GIPHY API key, paste it here and it's used first." />
    <${Select} k="gif_provider" label="Search with" options=${[['auto', 'Automatic (no key)'], ['klipy', 'KLIPY key'], ['giphy', 'GIPHY key']]} />
    <input class="field" type="password" placeholder=${tr('optional API key')} value=${S.get('gif_key')} onInput=${(e) => S.set('gif_key', e.target.value.trim())} />
    <${Sec} t="Quick replies" /><textarea class="field" rows="5" value=${qr} onInput=${(e) => { setQr(e.target.value); S.set('quick_replies', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean)); }}></textarea>
    <${Note} t="One per line. Use them from the ➕ menu, or to decline a call with a message." />
    <${Sec} t="Scheduled messages" />
    ${items.length ? items.map((m) => html`<div class="row" style=${{ padding: '6px 0' }}><div class="grow"><div class="ellipsis">${m.body}</div>
      <div class="tiny muted">${new Date(m.send_at * 1000).toLocaleString()} · ${ctx.store.chats[m.chat_id] ? ctx.store.chatTitle(ctx.store.chats[m.chat_id]) : ''}</div></div>
      <button class="btn small" onClick=${async () => { await ctx.api('cancel_scheduled', { id: m.id }); setSched(items.filter((x) => x.id !== m.id)); }}>${I('✖')}</button></div>`)
      : html`<${Note} t="Nothing scheduled" />`}
    <${Sec} t="Slash commands" /><${Note} t="/shrug /tableflip /unflip /lenny /disapprove /me /spoiler /silent /roll [n] /coin /8ball /nudge /poll Q | a | b /schedule /call /help" />
  </${Page}>`;
}

function BrainSettings() {
  return html`<${Page} title="The Smult Brain">
    <${Check} k="brain_train" label="⚡ Help train it (uses a little CPU)" onChange=${(v) => { if (v) { ctx.brain && ctx.brain.ensureLoaded(); ctx.lang && ctx.lang.ensureLoaded(); } }} />
    <${Check} k="brain_train_charging_only" label="Only train while charging" sub="Saves battery: training pauses when the phone isn't plugged in." />
    <${Note} t="Training also pauses during calls and while Smult is in the background." />
  </${Page}>`;
}

function Advanced() {
  const [relays, setRelays] = useState((S.get('relays') || []).join('\n'));
  const n = ctx.net.backend ? ctx.net.backend.pool.connected() : 0;
  return html`<${Page} title="Advanced">
    <${Sec} t="Relays (how messages travel)" />
    <textarea class="field" rows="6" value=${relays} onInput=${(e) => { setRelays(e.target.value); S.set('relays', e.target.value.split('\n').map((x) => x.trim()).filter((x) => /^wss?:\/\//.test(x))); }}></textarea>
    <${Note} t=${`Connected to ${n} of ${(S.get('relays') || []).length} relays. Relays are free public Nostr servers; they only ever see encrypted data. Everyone in your friend group should share at least one relay. One per line, changes apply on next login.`} />
    <button class="btn small" onClick=${() => { const d = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://offchain.pub', 'wss://nostr.mom', 'wss://relay.nostr.net']; S.set('relays', d); setRelays(d.join('\n')); }}>${tr('Restore defaults')}</button>
    <${Sec} t="Calls: TURN server (optional)" />
    <${Note} t="Calls connect directly between PCs. On some strict networks (school, work, some mobile hotspots) that fails; a TURN server relays the call. Free ones need a sign-up (e.g. metered.ca, expressturn). Leave empty if calls work fine." />
    <input class="field" placeholder="turn:host:3478" value=${S.get('turn_url')} onInput=${(e) => S.set('turn_url', e.target.value.trim())} />
    <div class="row" style=${{ marginTop: '6px' }}><input class="field" placeholder=${tr('Username')} value=${S.get('turn_user')} onInput=${(e) => S.set('turn_user', e.target.value)} />
      <input class="field" type="password" placeholder=${tr('Password')} value=${S.get('turn_pass')} onInput=${(e) => S.set('turn_pass', e.target.value)} /></div>
    <${Sec} t="Storage" />
    <button class="btn block" onClick=${async () => { const k = await clearFileCache(); ctx.toast(`Removed ${k} cached files`, 'ok'); }}>${tr('🧹 Clear image/file cache')}</button>
    ${isNative ? html`<button class="btn block" style=${{ marginTop: '8px' }} onClick=${() => LobbyNative.batteryOptimizations().catch(() => {})}>${tr('🔋 Let Smult run in the background')}</button>
      <${Note} t="Some phones (Xiaomi, Samsung...) kill apps in the background. This opens the setting that lets Smult keep getting messages." />` : null}
  </${Page}>`;
}

function About() {
  return html`<${Page} title="About">
    <div class="center" style=${{ margin: '20px 0' }}><${AppLogo} size=${84} /><br /><b style=${{ fontSize: '1.8em', color: 'var(--accent)' }}>SMULT</b>
      <div class="muted">for Android · v1.0</div></div>
    <p>${tr('Smult — made for you and your friends.')}</p>
    <p class="small muted">${tr('Same accounts, chats, groups, calls and community brains as Smult on PC. Peer-to-peer over Nostr relays, end-to-end encrypted, calls go directly between devices (WebRTC).')}</p>
    <p class="small muted">Fonts: LDF Comic Sans (freeware), Comic Neue (OFL), DOORS. Emoji: Twemoji Mozilla (OFL 1.1; artwork © Twitter, CC-BY 4.0).</p>
  </${Page}>`;
}

export function SettingsPage({ page }) {
  if (page === 'account') return html`<${Account} />`;
  if (page === 'privacy') return html`<${Privacy} />`;
  if (page === 'notifications') return html`<${Notifications} />`;
  if (page === 'appearance') return html`<${Appearance} />`;
  if (page === 'themes') return html`<${ThemesPage} />`;
  if (page === 'voice') return html`<${Voice} />`;
  if (page === 'soundboard') return html`<${Soundboard} />`;
  if (page === 'chat') return html`<${Chat} />`;
  if (page === 'brain') return html`<${BrainSettings} />`;
  if (page === 'advanced') return html`<${Advanced} />`;
  if (page === 'admin') return html`<${AdminPage} />`;
  if (page === 'about') return html`<${About} />`;
  return null;
}

// ---------------------------------------------------------------- admins & badges
function AdminPage() {
  const [st, setSt] = useState(null);
  const reload = () => ctx.api('badge_state').then(setSt);
  useEffect(() => { reload(); }, []);
  const [name, setName] = useState(''), [emoji, setEmoji] = useState('🏅'), [color, setColor] = useState('#3d8bff'), [desc, setDesc] = useState('');
  if (!st) return html`<${Page} title="Admin & badges"><div class="empty">⏳</div></${Page}>`;
  const users = Object.values(ctx.store.users).filter((u) => u.username);
  return html`<${Page} title="Admin & badges">
    <div class="card"><b>${st.role === 'owner' ? '👑 ' + tr('Owner') : '🛡️ ' + tr('Admin')}</b>
      <div class="small muted">${tr('Badges you give are public: everyone sees them. Tap someone below to give or take badges.')}</div>
      ${st.role === 'owner' ? html`<div class="tiny muted selectable" style=${{ marginTop: '6px' }}>${tr('Your full key (paste into badges.py ADMIN_PUBKEY to lock ownership):')} ${st.my_pub}</div>` : null}</div>
    <${Sec} t="People" />
    ${users.map((u) => html`<div class="row" style=${{ padding: '6px 0' }} onClick=${() => ctx.sheet({ kind: 'custom', render: (s) => html`<${GrantSheet} s=${s} uid=${u.id} st=${st} reload=${reload} />` })}>
      <${Avatar} user=${u} size=${36} /><span class="grow">${u.display} <span class="tiny muted">@${u.username}</span></span><${Badges} list=${u.badges} max=${6} /></div>`)}
    <${Sec} t="Make a custom badge" />
    <div class="row"><input class="field" style=${{ width: '70px' }} value=${emoji} onInput=${(e) => setEmoji(e.target.value)} />
      <input class="field grow" placeholder=${tr('Badge name')} value=${name} onInput=${(e) => setName(e.target.value)} />
      <input type="color" value=${color} onInput=${(e) => setColor(e.target.value)} /></div>
    <input class="field" style=${{ marginTop: '6px' }} placeholder=${tr('What is it for?')} value=${desc} onInput=${(e) => setDesc(e.target.value)} />
    <button class="btn primary block" style=${{ marginTop: '8px' }} onClick=${async () => { await ctx.api('badge_make', { name, emoji, color, desc }); setName(''); setDesc(''); reload(); ctx.toast('Badge created', 'ok'); }}>${tr('Create badge')}</button>
    <${Sec} t="All badges" />
    ${st.catalog.map((b) => html`<div class="row" style=${{ padding: '4px 0' }}><span class="bchip" style=${{ background: b.color, color: b.fg }}><span class="emoji">${b.emoji}</span> ${tr(b.name)}</span>
      <span class="grow tiny muted">${tr(b.desc)}</span>${b.custom ? html`<button class="btn small" onClick=${async () => { if (await ctx.confirm('Delete this badge?', { danger: true })) { await ctx.api('badge_delete', { badge: b.id }); reload(); } }}>${I('🗑️')}</button>` : null}</div>`)}
  </${Page}>`;
}

export function GrantSheet({ s, uid, st, reload }) {
  useBus(['store'], (ev, t) => t === 'user');
  const u = ctx.store.users[uid] || {};
  const has = new Set((u.badges || []).map((b) => b.id));
  return html`<div><div class="row"><${Avatar} user=${u} size=${44} /><b class="grow">${u.display}</b></div>
    ${st.catalog.filter((b) => !b.auto).map((b) => html`<label class="check" onClick=${async (e) => { e.preventDefault(); await ctx.api('badge_grant', { user_id: uid, badge: b.id, on: !has.has(b.id) }); }}>
      <span class="bchip" style=${{ background: b.color, color: b.fg }}><span class="emoji">${b.emoji}</span> ${tr(b.name)}</span><span class="grow tiny muted">${tr(b.desc)}</span><${Switch} on=${has.has(b.id)} /></label>`)}
    ${st.role === 'owner' && uid !== ctx.store.myId ? html`<button class="btn block" style=${{ marginTop: '10px' }} onClick=${async () => { await ctx.api('badge_admin', { user_id: uid, on: u.role !== 'admin' }); reload(); }}>
      ${u.role === 'admin' ? tr('Remove admin') : tr('Make admin')}</button>` : null}</div>`;
}
