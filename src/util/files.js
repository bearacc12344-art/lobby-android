// Files: picking (gallery / camera / any file), saving to the phone, and a cache of decrypted attachments.
import { ctx } from '../ctx.js';
import { idb } from '../net/idb.js';
import { b64 } from '../net/crypto.js';
import { isNative, LobbyNative } from '../native.js';

export function pickFiles({ accept = '*/*', multiple = true, capture = null } = {}) {
  return new Promise((res) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.multiple = multiple;
    if (capture) inp.setAttribute('capture', capture);
    inp.style.display = 'none';
    document.body.appendChild(inp);
    let done = false;
    inp.onchange = () => { done = true; res([...inp.files]); inp.remove(); };
    window.addEventListener('focus', () => setTimeout(() => { if (!done) { res([]); inp.remove(); } }, 1500), { once: true });
    inp.click();
  });
}

export async function readFile(f) { return new Uint8Array(await f.arrayBuffer()); }

export const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  webm: 'audio/webm', mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', pdf: 'application/pdf', txt: 'text/plain', zip: 'application/zip' };
export const extOf = (name) => (String(name).split('.').pop() || '').toLowerCase();
export const mimeOf = (name) => MIME[extOf(name)] || 'application/octet-stream';
export const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'opus', 'webm', 'wma', 'aiff']);
export const VIDEO_EXT = new Set(['mp4', 'mov', 'mkv', 'webm', 'm4v', '3gp']);
export const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

export async function saveFile(name, bytes) {
  if (isNative) {
    try {
      const r = await LobbyNative.saveFile({ name, mime: mimeOf(name), data: b64(bytes) });
      ctx.toast(`💾 Saved to Downloads/${r.name || name}`, 'ok');
      return;
    } catch (e) { ctx.toast("Couldn't save: " + (e.message || e), 'error'); return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: mimeOf(name) }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export async function openFile(name, bytes) {
  if (isNative) {
    try { await LobbyNative.openFile({ name, mime: mimeOf(name), data: b64(bytes) }); return; } catch (e) { ctx.toast("Couldn't open: " + (e.message || e), 'error'); }
  } else window.open(URL.createObjectURL(new Blob([bytes], { type: mimeOf(name) })));
}

// ---- decrypted attachment cache (memory + IndexedDB, capped)
const urls = new Map();
const waiting = new Map();
const CACHE_MAX = 300;

export async function getFile(fid) {
  const hit = await idb.get('files', fid).catch(() => null);
  if (hit) return hit;
  if (waiting.has(fid)) return waiting.get(fid);
  const p = ctx.net.req('get_file', { file_id: fid }).then(async (f) => {
    const rec = { name: f.name, bytes: f.bytes, t: Date.now() };
    if (f.bytes.length < 25 * 1024 * 1024) {
      await idb.put('files', fid, rec).catch(() => {});
      trimCache();
    }
    return rec;
  }).finally(() => waiting.delete(fid));
  waiting.set(fid, p);
  return p;
}

let trimming = false;
async function trimCache() {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await idb.keys('files');
    if (keys.length > CACHE_MAX) for (const k of keys.slice(0, keys.length - CACHE_MAX)) await idb.del('files', k);
  } catch (e) {} finally { trimming = false; }
}

export async function fileUrl(fid) {
  if (urls.has(fid)) return urls.get(fid);
  const f = await getFile(fid);
  const u = URL.createObjectURL(new Blob([f.bytes], { type: mimeOf(f.name) }));
  urls.set(fid, u);
  return u;
}
export const cachedUrl = (fid) => urls.get(fid) || null;
export async function clearFileCache() {
  const n = (await idb.keys('files')).length;
  await idb.clear('files');
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
  return n;
}
