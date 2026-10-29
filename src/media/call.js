// Call sessions (port of ui_call.CallSession + the call parts of client.py)
import { CallAudio } from './audio.js';
import { Camera, Screen, decodeFrame } from './video.js';
import { S } from '../util/settings.js';
import { tr } from '../util/i18n.js';
import * as sounds from '../util/sounds.js';
import { isNative, LobbyNative } from '../native.js';
import { idb } from '../net/idb.js';

export class CallSession {
  constructor(ctx, call, muted) {
    this.ctx = ctx;
    this.callId = call.id;
    this.chatId = call.chat_id;
    this.started = call.started;
    this.members = new Map(call.members.map((m) => [m.user_id, m]));
    this.ringing = new Set(call.ringing || []);
    this.frames = new Map();       // `${uid}:${kind}` -> ImageBitmap
    this.frameTime = new Map();
    this.muted = !!(muted === undefined || muted === null ? S.get('join_muted') : muted);
    this.deaf = false;
    this.cam = null;
    this.screen = null;
    this.speaker = S.get('speaker');
    this.lastSound = 0;
    this.localMuted = new Set();
    this.audio = new CallAudio((pkt) => ctx.net.sendMedia(1, pkt));
    this.audio.muted = this.muted;
    this.outgoingOn = false;
  }
  async start() {
    await this.audio.start();   // mic permission first, so the call service can be a 'microphone' service (Android 14+)
    if (isNative) {
      await LobbyNative.callService({ on: true, title: 'Smult', text: tr('🔊 Voice connected') }).catch(() => {});
      await LobbyNative.callAudio({ on: true, speaker: this.speaker }).catch(() => {});
    }
    if (this.audio.error) this.ctx.toast(this.audio.error, 'error', 5000);
    this.ctx.music && this.ctx.music.update();
    this.outgoingTone();
  }
  onMedia(uid, kind, bytes) {
    if (kind === 1) { this.audio.receive(uid, bytes); return; }
    decodeFrame(bytes).then((bmp) => {
      if (!bmp) return;
      const k = `${uid}:${kind}`;
      const old = this.frames.get(k);
      if (old) old.close();
      this.frames.set(k, bmp);
      this.frameTime.set(k, Date.now());
      this.ctx.bus.emit('callframe', uid, kind);
    });
  }
  update(call) {
    if (!call) return;
    const old = new Set(this.members.keys());
    this.members = new Map(call.members.map((m) => [m.user_id, m]));
    this.ringing = new Set(call.ringing || []);
    const nw = new Set(this.members.keys());
    const me = this.ctx.store.myId;
    if (S.get('sound_join_leave')) {
      if ([...nw].some((u) => !old.has(u) && u !== me)) this.ctx.play('join');
      else if ([...old].some((u) => !nw.has(u))) this.ctx.play('leave');
    }
    for (const k of [...this.frames.keys()]) {
      const [uid, kind] = k.split(':').map(Number);
      const st = this.members.get(uid);
      if (!st || (kind === 2 && !st.cam) || (kind === 3 && !st.screen)) { this.frames.get(k).close(); this.frames.delete(k); }
    }
    this.outgoingTone();
    this.ctx.bus.emit('callstate');
  }
  outgoingTone() {
    const want = this.ringing.size > 0 && this.members.size <= 1;
    if (want && !this.outgoingOn) sounds.startLoop('outgoing', 'outgoing', 0.5);
    else if (!want && this.outgoingOn) sounds.stopLoop('outgoing');
    this.outgoingOn = want;
  }
  setMuted(on) {
    this.muted = on;
    if (!on && this.deaf) return this.setDeaf(false);
    this.audio.setMuted(on);
    this.ctx.play(on ? 'mute' : 'unmute', { vol: 0.35 });
    this.ctx.try(this.ctx.api('call_state', { muted: on }));
    this.ctx.bus.emit('callstate');
  }
  setDeaf(on) {
    this.deaf = on;
    this.audio.setDeaf(on);
    this.ctx.play(on ? 'mute' : 'unmute', { vol: 0.35 });
    this.ctx.try(this.ctx.api('call_state', { deaf: on, muted: on || this.muted }));
    this.ctx.bus.emit('callstate');
  }
  async setSpeaker(on) {
    this.speaker = on;
    S.set('speaker', on);
    if (isNative) await LobbyNative.callAudio({ on: true, speaker: on }).catch(() => {});
    this.ctx.bus.emit('callstate');
  }
  async startCam() {
    try {
      this.cam = new Camera((f) => this.ctx.net.sendMedia(2, f));
      this.camStream = await this.cam.start();
      this.ctx.try(this.ctx.api('call_state', { cam: true }));
    } catch (e) {
      this.cam = null;
      this.ctx.toast("Couldn't open the camera: " + (e.message || e), 'error');
    }
    this.ctx.bus.emit('callstate');
  }
  async flipCam() { if (this.cam) { await this.cam.flip(); this.camStream = this.cam.stream; this.ctx.bus.emit('callstate'); } }
  stopCam() {
    if (this.cam) { this.cam.stop(); this.cam = null; this.camStream = null; }
    this.ctx.try(this.ctx.api('call_state', { cam: false }));
    this.ctx.bus.emit('callstate');
  }
  async startScreen() {
    try {
      this.screen = new Screen((f) => this.ctx.net.sendMedia(3, f), () => this.stopScreen());
      await this.screen.start();
      this.ctx.try(this.ctx.api('call_state', { screen: true }));
    } catch (e) {
      this.screen = null;
      if (!/cancel|denied|dismiss/i.test(String(e.message || e))) this.ctx.toast("Couldn't share the screen: " + (e.message || e), 'error');
    }
    this.ctx.bus.emit('callstate');
  }
  async stopScreen() {
    if (this.screen) { const s = this.screen; this.screen = null; await s.stop(); }
    this.ctx.try(this.ctx.api('call_state', { screen: false }));
    this.ctx.bus.emit('callstate');
  }
  react(emoji) { this.ctx.try(this.ctx.api('call_react', { emoji })); }
  async playSound(s) {
    if (Date.now() / 1000 - this.lastSound < S.get('sound_cooldown')) return;
    this.lastSound = Date.now() / 1000;
    try {
      let buf;
      if (s.file) buf = await sounds.buffer(s.file);
      else {
        const raw = await idb.get('kv', s.id);
        const { audioCtx } = await import('../util/audioctx.js');
        buf = await audioCtx().decodeAudioData(raw.slice().buffer);
      }
      const max = buf.duration > 20 ? null : buf;
      if (!max) return this.ctx.toast('That sound is longer than 20 s', 'error');
      this.audio.playToCall(buf, S.get('sound_volume') / 100);
      this.ctx.try(this.ctx.api('call_react', { emoji: s.emoji || '🔊', sound: s.name }));
    } catch (e) { this.ctx.toast(`Can't play ${s.name}: ${e.message || e}`, 'error'); }
  }
  toggleLocalMute(uid) {
    if (this.localMuted.has(uid)) this.localMuted.delete(uid); else this.localMuted.add(uid);
    this.audio.setLocalMuted([...this.localMuted]);
    this.ctx.bus.emit('callstate');
  }
  async stop() {
    sounds.stopLoop('outgoing');
    if (this.cam) this.cam.stop();
    if (this.screen) await this.screen.stop();
    this.audio.stop();
    for (const b of this.frames.values()) b.close();
    if (isNative) {
      LobbyNative.callAudio({ on: false }).catch(() => {});
      LobbyNative.callService({ on: false }).catch(() => {});
    }
  }
}

function endSession(ctx) {
  if (ctx.call) { const c = ctx.call; ctx.call = null; c.stop(); }
  ctx.callFull = false;
  ctx.music && ctx.music.update();
  ctx.bus.emit('callstate');
}

async function begin(ctx, call, video, muted) {
  if (ctx.call && ctx.call.callId === call.id) { ctx.callFull = true; ctx.bus.emit('callstate'); return; }
  if (ctx.call) endSession(ctx);
  for (const id of [...ctx.rings.keys()]) stopRing(ctx, id);
  const s = new CallSession(ctx, call, muted);
  ctx.call = s;
  ctx.callFull = true;
  ctx.bus.emit('callstate');
  await s.start();
  if (video) await s.startCam();
}

export async function startCall(ctx, cid, video = false) {
  const c = ctx.store.chats[cid];
  if (c && c.call && (!ctx.call || ctx.call.callId !== c.call.id)) return joinCall(ctx, c.call.id, { video });
  if (ctx.call && ctx.call.chatId === cid) { ctx.callFull = true; ctx.bus.emit('callstate'); return; }
  const call = await ctx.api('call_start', { chat_id: cid, video });
  await begin(ctx, call, video);
}

export async function joinCall(ctx, callId, { video = false, muted } = {}) {
  if (ctx.call && ctx.call.callId === callId) { ctx.callFull = true; ctx.bus.emit('callstate'); return; }
  const call = await ctx.api('call_join', { call_id: callId, muted: !!muted });
  await begin(ctx, call, video, muted);
}

export async function leaveCall(ctx) {
  if (!ctx.call) return;
  ctx.try(ctx.api('call_leave', {}, { quiet: true }));
  endSession(ctx);
  ctx.play('leave');
}

function stopRing(ctx, callId) {
  if (!ctx.rings.has(callId)) return;
  ctx.rings.delete(callId);
  if (!ctx.rings.size) sounds.stopLoop('ring');
  if (isNative) LobbyNative.callNotify({ show: false, callId }).catch(() => {});
  ctx.bus.emit('callstate');
}

export function declineCall(ctx, callId, reason = '') {
  stopRing(ctx, callId);
  ctx.try(ctx.api('call_decline', { call_id: callId, reason }, { quiet: true }));
}

export function onCallEvent(ctx, d) {
  const t = d.t;
  if (t === 'call_ring') {
    const call = d.call;
    if (ctx.call && ctx.call.callId === call.id) return;
    if (ctx.rings.has(call.id)) return;
    const frm = d.from;
    if (ctx.store.isTrusted(frm) && S.get('auto_answer_trusted') && !ctx.call) {
      ctx.toast(`⭐ Auto-answered ${ctx.store.name(frm)}`);
      return joinCall(ctx, call.id);
    }
    const silent = ctx.dndBlocks(frm);
    ctx.rings.set(call.id, { call, from: frm, video: !!d.video, silent });
    if (!silent) {
      sounds.startLoop('ring', 'ring', S.get('ring_volume') / 100);
      if (isNative) {
        LobbyNative.callNotify({ show: true, callId: call.id, title: tr('📞 Incoming call'), text: tr(`${ctx.store.name(frm)} is calling you`) }).catch(() => {});
        import('@capacitor/haptics').then((h) => h.Haptics.vibrate({ duration: 600 })).catch(() => {});
      } else ctx.notify(tr('Incoming call'), tr(`${ctx.store.name(frm)} is calling you`), { force: true });
    }
    ctx.bus.emit('callstate');
  } else if (t === 'call_ring_stop') {
    stopRing(ctx, d.call_id);
  } else if (t === 'call_update') {
    const s = ctx.call;
    if (s && s.chatId === d.chat_id) {
      if (!d.call || d.call.id !== s.callId) endSession(ctx);
      else if (!d.call.members.some((m) => m.user_id === ctx.store.myId)) endSession(ctx);
      else s.update(d.call);
    }
    ctx.bus.emit('callstate');
  } else if (t === 'call_react') {
    if (ctx.call) {
      ctx.bus.emit('callreact', d);
      if (!ctx.callFull && d.sound && d.from !== ctx.store.myId) ctx.toast(`${d.emoji} ${ctx.store.name(d.from)} played ${d.sound}`);
    }
  } else if (t === 'call_declined') {
    ctx.toast(`📵 ${ctx.store.name(d.user_id)} declined` + (d.reason ? `: ${d.reason}` : ''));
  }
}

export function onNativeCallAction(ctx, e) {
  // buttons on the incoming-call notification (Android)
  const callId = e.callId;
  if (e.action === 'accept') joinCall(ctx, callId);
  else if (e.action === 'decline') declineCall(ctx, callId);
  else if (e.action === 'open') { ctx.bus.emit('callstate'); }
}
