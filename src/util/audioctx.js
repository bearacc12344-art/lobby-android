// One shared Web Audio context for UI sounds, ringtones, soundboard and call audio
let ctx = null;
export function audioCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive', sampleRate: 48000 });
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
// browsers only allow audio after a touch: unlock on the first one
const unlock = () => { audioCtx(); window.removeEventListener('pointerdown', unlock, true); };
window.addEventListener('pointerdown', unlock, true);
