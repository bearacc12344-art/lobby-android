// Camera + screen capture -> JPEG/WebP frames (same as PC Lobby's CameraThread / ScreenThread), and drawing frames.
import { S } from '../util/settings.js';
import { isNative, LobbyNative } from '../native.js';
import { unb64 } from '../net/crypto.js';

function encodeFrame(canvas, type, quality) {
  return new Promise((res) => canvas.toBlob((b) => (b ? b.arrayBuffer().then((a) => res(new Uint8Array(a))) : res(null)), type, quality));
}

export class Camera {
  constructor(onFrame) { this.onFrame = onFrame; this.facing = S.get('cam_facing') || 'user'; }
  async start() {
    const h = S.get('cam_res');
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: this.facing, height: { ideal: h }, width: { ideal: Math.round(h * 16 / 9) }, frameRate: { ideal: S.get('cam_fps') } } });
    this.video = document.createElement('video');
    this.video.muted = true; this.video.playsInline = true;
    this.video.srcObject = this.stream;
    await this.video.play();
    this.canvas = document.createElement('canvas');
    this.running = true;
    this.loop();
    return this.stream;
  }
  async flip() {
    this.facing = this.facing === 'user' ? 'environment' : 'user';
    S.set('cam_facing', this.facing);
    this.stopTracks();
    await this.start();
  }
  async loop() {
    const fps = S.get('cam_fps');
    while (this.running) {
      const t0 = performance.now();
      const v = this.video;
      if (v.videoWidth) {
        const h = Math.min(S.get('cam_res'), v.videoHeight), w = Math.round(v.videoWidth * h / v.videoHeight);
        this.canvas.width = w; this.canvas.height = h;
        const g = this.canvas.getContext('2d');
        const mirror = S.get('mirror') && this.facing === 'user';
        if (mirror) { g.setTransform(-1, 0, 0, 1, w, 0); }
        g.drawImage(v, 0, 0, w, h);
        g.setTransform(1, 0, 0, 1, 0, 0);
        const f = await encodeFrame(this.canvas, 'image/jpeg', S.get('cam_quality') / 100);
        if (f && this.running) this.onFrame(f);
      }
      await new Promise((r) => setTimeout(r, Math.max(10, 1000 / fps - (performance.now() - t0))));
    }
  }
  stopTracks() { this.running = false; if (this.stream) this.stream.getTracks().forEach((t) => t.stop()); }
  stop() { this.stopTracks(); }
}

// Screen share: Android -> native MediaProjection (LobbyNativePlugin); browsers -> getDisplayMedia
export class Screen {
  constructor(onFrame, onEnd) { this.onFrame = onFrame; this.onEnd = onEnd; }
  async start() {
    if (isNative) {
      this.sub = await LobbyNative.addListener('screenFrame', (e) => { if (e.data) this.onFrame(unb64(e.data)); });
      this.endSub = await LobbyNative.addListener('screenStopped', () => this.onEnd && this.onEnd());
      await LobbyNative.startScreen({ fps: S.get('screen_fps'), maxHeight: S.get('screen_res'), quality: S.get('screen_quality'),
        codec: S.get('screen_codec'), title: 'Lobby', text: 'Sharing your screen in a call' });
      return null;
    }
    this.stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: S.get('screen_fps') }, audio: false });
    this.stream.getVideoTracks()[0].onended = () => this.onEnd && this.onEnd();
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.srcObject = this.stream;
    await this.video.play();
    this.canvas = document.createElement('canvas');
    this.running = true;
    this.loop();
    return this.stream;
  }
  async loop() {
    let last = null;
    while (this.running) {
      const t0 = performance.now();
      const v = this.video;
      if (v.videoWidth) {
        const maxH = S.get('screen_res') || v.videoHeight;
        const h = Math.min(maxH, v.videoHeight), w = Math.round(v.videoWidth * h / v.videoHeight);
        this.canvas.width = w; this.canvas.height = h;
        const g = this.canvas.getContext('2d');
        g.drawImage(v, 0, 0, w, h);
        // skip unchanged frames (saves tons of bandwidth), like PC
        const probe = g.getImageData(0, 0, w, h).data;
        let sig = 0;
        for (let i = 0; i < probe.length; i += 997) sig = (sig * 31 + probe[i]) | 0;
        if (sig !== last) {
          last = sig;
          const f = await encodeFrame(this.canvas, S.get('screen_codec') === 'webp' ? 'image/webp' : 'image/jpeg', S.get('screen_quality') / 100);
          if (f && this.running) this.onFrame(f);
        }
      }
      await new Promise((r) => setTimeout(r, Math.max(10, 1000 / S.get('screen_fps') - (performance.now() - t0))));
    }
  }
  async stop() {
    this.running = false;
    if (isNative) {
      await LobbyNative.stopScreen().catch(() => {});
      this.sub && this.sub.remove();
      this.endSub && this.endSub.remove();
    }
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
  }
}

// latest decoded frame per (uid, kind) as an ImageBitmap
export async function decodeFrame(bytes) {
  try { return await createImageBitmap(new Blob([bytes])); } catch (e) { return null; }
}
