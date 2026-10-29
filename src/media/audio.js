// Call audio engine (port of media.AudioEngine): mic -> worklet -> packets to peers; packets from peers -> jitter
// buffers -> speaker. Remote audio is played through a local WebRTC loopback so Android's echo canceller can hear it.
import workletUrl from './callWorklet.js?url';
import { audioCtx } from '../util/audioctx.js';
import { S } from '../util/settings.js';
import { playBuffer } from '../util/sounds.js';

let loaded = null;
async function ensureWorklet(ac) {
  if (!loaded) loaded = ac.audioWorklet.addModule(workletUrl);
  return loaded;
}

export class CallAudio {
  constructor(onPacket) {
    this.onPacket = onPacket;
    this.levels = {};       // uid -> level (0 = me)
    this.micDb = -100;
    this.muted = false;
    this.deaf = false;
    this.error = null;
  }
  async start() {
    const ac = audioCtx();
    await ensureWorklet(ac);
    this.out = new AudioWorkletNode(ac, 'lobby-out', { numberOfInputs: 0, outputChannelCount: [2] });
    this.out.port.onmessage = (e) => { if (e.data.levels) Object.assign(this.levels, e.data.levels); };
    await this.routeOutput(ac);
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: S.get('echo_cancel'), noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      this.src = ac.createMediaStreamSource(this.stream);
      this.mic = new AudioWorkletNode(ac, 'lobby-mic', { numberOfInputs: 1, numberOfOutputs: 0 });
      this.mic.port.onmessage = (e) => {
        const d = e.data;
        if (d.pkt) this.onPacket(d.pkt);
        else { this.levels[0] = d.level; this.micDb = d.db; }
      };
      this.src.connect(this.mic);
    } catch (e) {
      this.error = 'Microphone error: ' + (e.message || e);
    }
    this.apply();
  }
  async routeOutput(ac) {
    this.outGain = ac.createGain();
    this.out.connect(this.outGain);
    if (!S.get('echo_cancel')) { this.outGain.connect(ac.destination); return; }
    // WebAudio output isn't seen by the phone's echo canceller; WebRTC playout is. So loop it through a local
    // peer connection and play the received track with an <audio> element.
    try {
      const dest = ac.createMediaStreamDestination();
      this.outGain.connect(dest);
      const a = new RTCPeerConnection(), b = new RTCPeerConnection();
      a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate);
      b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);
      const got = new Promise((res) => { b.ontrack = (e) => res(e.streams[0] || new MediaStream([e.track])); });
      dest.stream.getTracks().forEach((t) => a.addTrack(t, dest.stream));
      await a.setLocalDescription(await a.createOffer());
      await b.setRemoteDescription(a.localDescription);
      await b.setLocalDescription(await b.createAnswer());
      await a.setRemoteDescription(b.localDescription);
      const stream = await Promise.race([got, new Promise((_, rej) => setTimeout(() => rej(new Error('loopback timeout')), 4000))]);
      this.el = new Audio();
      this.el.srcObject = stream;
      this.el.autoplay = true;
      await this.el.play().catch(() => {});
      this.loop = [a, b];
    } catch (e) {
      console.warn('loopback failed, direct output', e);
      this.outGain.disconnect();
      this.out.disconnect();
      this.out.connect(this.outGain);
      this.outGain.connect(ac.destination);
    }
  }
  apply() {
    const cfg = { gain: S.get('mic_gain') / 100, gateDb: S.get('gate_db'), highpass: S.get('highpass'), muted: this.muted || this.deaf,
      sendRate: S.get('voice_quality'), inCall: true };
    if (this.mic) this.mic.port.postMessage({ cfg });
    if (this.out) this.out.port.postMessage({ cfg: { deaf: this.deaf, vol: S.get('user_volumes') || {}, out: S.get('out_volume') / 100, muted: this.localMuted || [] } });
  }
  setMuted(on) { this.muted = on; this.apply(); }
  setDeaf(on) { this.deaf = on; this.apply(); }
  setLocalMuted(list) { this.localMuted = list; this.apply(); }
  receive(uid, bytes) { if (this.out) this.out.port.postMessage({ uid, pkt: bytes }); }
  // soundboard: I hear it and it's mixed into what I send
  playToCall(buffer, vol) {
    playBuffer(buffer, vol);
    if (this.mic) {
      const ac = audioCtx();
      let data = buffer.getChannelData(0);
      if (buffer.sampleRate !== ac.sampleRate) {
        const n = Math.round(data.length * ac.sampleRate / buffer.sampleRate), r = new Float32Array(n);
        for (let i = 0; i < n; i++) r[i] = data[Math.min(data.length - 1, Math.floor(i * buffer.sampleRate / ac.sampleRate))];
        data = r;
      }
      this.mic.port.postMessage({ effect: new Float32Array(data), vol });
    }
  }
  stop() {
    try { this.src && this.src.disconnect(); } catch (e) {}
    try { this.mic && this.mic.disconnect(); } catch (e) {}
    try { this.out && this.out.disconnect(); this.outGain && this.outGain.disconnect(); } catch (e) {}
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.el) { this.el.pause(); this.el.srcObject = null; }
    if (this.loop) this.loop.forEach((p) => p.close());
  }
}
