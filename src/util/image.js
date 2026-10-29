// picture helpers: profile pictures (same format as PC Smult: 160 px JPEG still, GIFs kept animated), thumbnails
import { b64 } from '../net/crypto.js';

export function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("couldn't read that picture")); i.src = src; });
}

export async function squareJpeg(blobOrUrl, size = 160, quality = 0.85) {
  const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  const img = await loadImage(url);
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
  if (typeof blobOrUrl !== 'string') URL.revokeObjectURL(url);
  return c.toDataURL('image/jpeg', quality).split(',')[1];
}

export async function prepareAvatar(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isGif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
  if (isGif && countGifFrames(bytes) > 1) {
    if (bytes.length > 3 * 1024 * 1024) throw new Error('that GIF is too big even after shrinking');
    return { kind: 'gif', still: await squareJpeg(file), data: b64(bytes) };
  }
  let still = await squareJpeg(file);
  if (still.length > 48000) still = await squareJpeg(file, 128, 0.7);
  return { kind: 'image', still };
}

function countGifFrames(b) {
  let n = 0;
  for (let i = 0; i < b.length - 2 && n < 3; i++) if (b[i] === 0x21 && b[i + 1] === 0xf9 && b[i + 2] === 0x04) n++;
  return n;
}
