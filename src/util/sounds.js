// UI sounds (message, mention, ring...), seasonal packs (Halloween / Christmas) and the built-in soundboard -
// the exact sounds PC Smult synthesises, pre-rendered to files.
import { audioCtx } from './audioctx.js';
import { S } from './settings.js';

let manifest = null;
const buffers = new Map();     // file -> AudioBuffer
const loops = new Map();       // tag -> {src, gain}

export const SEASON_CHOICES = [['auto', '🗓️ Automatic (by date)'], ['off', 'Off (normal sounds)'], ['halloween', '🎃 Halloween'], ['christmas', '🎄 Christmas']];
export const SEASON_ICON = { halloween: '🎃', christmas: '🎄' };

export function currentSeason(setting = S.get('season'), today = new Date()) {
  if (setting === 'halloween' || setting === 'christmas') return setting;
  if (setting === 'off') return null;
  const m = today.getMonth() + 1, d = today.getDate();
  if ((m === 10 && d >= 15) || (m === 11 && d <= 2)) return 'halloween';
  if ((m === 12 && d >= 15) || (m === 1 && d <= 2)) return 'christmas';
  return null;
}

export async function loadManifest() {
  if (!manifest) manifest = await (await fetch('assets/sounds/manifest.json')).json();
  return manifest;
}

export async function buffer(file) {
  let b = buffers.get(file);
  if (!b) {
    const raw = await (await fetch('assets/sounds/' + file)).arrayBuffer();
    b = await audioCtx().decodeAudioData(raw);
    buffers.set(file, b);
  }
  return b;
}

async function fileFor(name) {
  const m = await loadManifest();
  const s = currentSeason();
  return (s && m[s] && m[s][name]) || m.normal[name] || null;
}

export function out() {
  // where UI sounds go (the call engine taps this too so soundboard reaches the call)
  return audioCtx().destination;
}

export async function play(name, vol) {
  try {
    const f = await fileFor(name);
    if (!f) return;
    playBuffer(await buffer(f), vol === undefined ? S.get('ui_volume') / 100 : vol);
  } catch (e) { /* audio not ready yet */ }
}

export function playBuffer(buf, vol = 1, dest = null) {
  const ac = audioCtx();
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = vol;
  src.connect(g).connect(dest || out());
  src.start();
  return src;
}

export async function startLoop(tag, name, vol) {
  stopLoop(tag);
  const f = await fileFor(name);
  if (!f) return;
  const ac = audioCtx();
  const src = ac.createBufferSource();
  src.buffer = await buffer(f);
  src.loop = true;
  const g = ac.createGain();
  g.gain.value = vol;
  src.connect(g).connect(out());
  src.start();
  loops.set(tag, { src, g });
}

export function stopLoop(tag) {
  const l = loops.get(tag);
  if (l) { try { l.src.stop(); } catch (e) {} loops.delete(tag); }
}

export async function boardSounds() {
  const m = await loadManifest();
  return m.board;
}
