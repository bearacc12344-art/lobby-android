// Stickers (like WhatsApp), same as PC Smult: your own library of pictures / GIFs that send big, without a bubble.
// Kept on the phone (IndexedDB). After the first send we remember the encrypted-file details, so sending the same
// sticker again is instant and uploads nothing. On the wire: a picture message with file.sticker = 1.
import { idb } from './net/idb.js';
import { ctx } from './ctx.js';
import { getFile, extOf } from './util/files.js';
import { loadImage } from './util/image.js';

const P = 'sticker:';
const STATIC_MAX = 320;
const ANIM_MAX = 8 * 1024 * 1024;
const MIMES = { gif: 'image/gif', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const META_KEYS = ['name', 'size', 'k', 'inline', 'url', 'parts', 'psize'];

export async function list() {
  const keys = (await idb.keys('kv')).filter((k) => String(k).startsWith(P));
  const out = [];
  for (const k of keys) { const v = await idb.get('kv', k); if (v && v.bytes) out.push(v); }
  return out.sort((a, b) => (a.order ?? -a.t) - (b.order ?? -b.t));
}
const put = (e) => idb.put('kv', P + e.id, e);
export const remove = (id) => idb.del('kv', P + id);
export async function toFront(e) { await put({ ...e, order: -Date.now() * 2 }); }
export const recent = (all, n = 8) => all.filter((e) => e.used).sort((a, b) => b.used - a.used).slice(0, n);
export const mimeOfSticker = (e) => MIMES[e.ext] || 'image/png';

function isAnimated(bytes, ext) {
  if (ext === 'gif') {
    let n = 0;
    for (let i = 0; i < bytes.length - 2 && n < 2; i++) if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) n++;
    return n > 1;
  }
  if (ext === 'webp') { // animated WebP has an ANIM chunk
    for (let i = 12; i < Math.min(bytes.length - 4, 200); i++) if (bytes[i] === 0x41 && bytes[i + 1] === 0x4e && bytes[i + 2] === 0x49 && bytes[i + 3] === 0x4d) return true;
  }
  return false;
}

async function shrinkStatic(bytes, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  try {
    const img = await loadImage(url);
    const k = Math.min(1, STATIC_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    let blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.88));
    let ext = 'webp';
    if (!blob || blob.type !== 'image/webp') { blob = await new Promise((r) => c.toBlob(r, 'image/png')); ext = 'png'; }
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext };
  } finally { URL.revokeObjectURL(url); }
}

// a picture / GIF -> a sticker in the library
export async function make(name, bytes, extra = {}) {
  let ext = extOf(name);
  if (!MIMES[ext]) ext = 'png';
  let out = { bytes, ext };
  if (isAnimated(bytes, ext)) {
    if (bytes.length > ANIM_MAX) throw new Error('That GIF is too big for a sticker (max 8 MB)');
  } else out = await shrinkStatic(bytes, MIMES[ext]);
  const e = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), ext: out.ext, bytes: out.bytes, t: Date.now(), used: 0, meta: null, ...extra };
  await put(e);
  return e;
}

export async function addFiles(files) {
  let n = 0;
  const errs = [];
  for (const f of files) {
    try { await make(f.name || 'sticker.png', new Uint8Array(await f.arrayBuffer())); n++; } catch (e) { errs.push(e.message || String(e)); }
  }
  return [n, errs];
}

// "Add to stickers" on a picture someone sent: keep it + its encrypted-file details (re-sending uploads nothing)
export async function addFromMessage(m) {
  const all = await list();
  if (all.some((e) => e.src === m.file.id)) return ctx.toast('You already have that sticker');
  const f = await getFile(m.file.id);
  const ext = extOf(f.name);
  let e;
  if (m.file.sticker || isAnimated(f.bytes, ext)) {
    e = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), ext: MIMES[ext] ? ext : 'png', bytes: f.bytes, t: Date.now(), used: 0, meta: null, src: m.file.id };
    await put(e);
    try { const meta = await ctx.api('file_meta', { msg_id: m.id }); await setMeta(e.id, meta); } catch (x) { /* it'll upload on first send */ }
  } else e = await make(f.name, f.bytes, { src: m.file.id });
  ctx.toast('🎴 Added to your stickers', 'ok');
  return e;
}

async function setMeta(id, meta) {
  if (!meta || !meta.k) return;
  const e = await idb.get('kv', P + id);
  if (!e) return;
  e.meta = Object.fromEntries(META_KEYS.filter((k) => k in meta).map((k) => [k, meta[k]]));
  await put(e);
}

export async function send(cid, e, replyTo) {
  const cur = (await idb.get('kv', P + e.id)) || e;
  cur.used = Date.now();
  await put(cur);
  const extra = replyTo ? { reply_to: replyTo } : {};
  if (cur.meta) {
    try { return await ctx.net.req('send', { chat_id: cid, body: '', file: { reuse: cur.meta, sticker: true }, ...extra }); } catch (x) {
      cur.meta = null; await put(cur);            // the old upload expired - upload it fresh below
    }
  }
  const r = await ctx.api('send', { chat_id: cid, body: '', file: { name: 'sticker.' + cur.ext, bytes: cur.bytes, sticker: true }, ...extra });
  if (r && r.file) await setMeta(cur.id, r.file);
  return r;
}
