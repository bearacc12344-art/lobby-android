// picture -> the brain's 32x32 colour input (port of brain_model.photo_input / doodle_input / to_bytes)
export const SIDE = 32;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
// downscale in halving steps so small output still averages all pixels (like cv2 INTER_AREA)
function shrink(src, sw, sh, dw, dh) {
  let cur = src, cw = sw, ch = sh;
  while (cw / 2 >= dw && ch / 2 >= dh) {
    const nw = Math.max(dw, Math.floor(cw / 2)), nh = Math.max(dh, Math.floor(ch / 2));
    const c = canvas(nw, nh);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh);
    cur = c; cw = nw; ch = nh;
  }
  const c = canvas(dw, dh);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(cur, 0, 0, cw, ch, 0, 0, dw, dh);
  return c;
}
// letterbox into a black size x size square
export function squareCanvas(src, sw, sh, size, sx = 0, sy = 0) {
  const crop = canvas(sw, sh);
  crop.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  const sc = size / Math.max(sw, sh);
  const nw = Math.max(1, Math.round(sw * sc)), nh = Math.max(1, Math.round(sh * sc));
  const small = shrink(crop, sw, sh, nw, nh);
  const out = canvas(size, size);
  const g = out.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  g.drawImage(small, Math.floor((size - nw) / 2), Math.floor((size - nh) / 2));
  return out;
}
function toBytes(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const out = new Uint8Array(c.width * c.height * 3);
  for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { out[j] = d[i]; out[j + 1] = d[i + 1]; out[j + 2] = d[i + 2]; }
  return out;
}
export function photoInput(src, w, h) {
  return toBytes(squareCanvas(src, w, h, SIDE));
}
// drawing on black -> crop to what was drawn, centre it in 26px with a 3px border
export function doodleInput(cv) {
  const { width: w, height: h } = cv;
  const d = cv.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  const thr = 0.08 * 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (Math.max(d[i], d[i + 1], d[i + 2]) > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const inner = squareCanvas(cv, x1 - x0 + 1, y1 - y0 + 1, 26, x0, y0);
  const out = canvas(SIDE, SIDE);
  const g = out.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, SIDE, SIDE);
  g.drawImage(inner, 3, 3);
  return toBytes(out);
}
export async function fileToBitmap(blob, maxSide = 600) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(async () => {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  });
  const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
  const sc = Math.min(1, maxSide / Math.max(w, h));
  // transparency goes onto black, like the drawing pad
  const c = canvas(Math.max(1, Math.round(w * sc)), Math.max(1, Math.round(h * sc)));
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  return c;
}
export function bytesToCanvas(x, side = SIDE) {
  const c = canvas(side, side);
  const g = c.getContext('2d');
  const im = g.createImageData(side, side);
  for (let i = 0, j = 0; j < x.length; i += 4, j += 3) { im.data[i] = x[j]; im.data[i + 1] = x[j + 1]; im.data[i + 2] = x[j + 2]; im.data[i + 3] = 255; }
  g.putImageData(im, 0, 0);
  return c;
}
export function bytesToUrl(x) { return bytesToCanvas(x).toDataURL(); }
export function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
