// GIF search with no key (reads GIPHY's public search page, Tenor as backup - same as PC Smult), optional API keys,
// and "My GIFs" favourites kept on the phone.
import { S } from './util/settings.js';
import { httpText, httpGet } from './net/http.js';
import { idb } from './net/idb.js';

const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const DEFAULT_QUERY = 'reaction';
const slug = (q) => q.trim().toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, '-').replace(/^-+|-+$/g, '') || DEFAULT_QUERY;

const GIPHY_ID = /(?:media\d?|i)\.giphy\.com\/media\/(?:v1\.[A-Za-z0-9_=.-]+\/)?([A-Za-z0-9]{6,32})\/(?:giphy|200w?|200w?_d|100w?|giphy-downsized|200_s)\.(?:gif|webp)/g;
const GIPHY_PATH = /giphy\.com\/gifs\/(?:[\w-]*-)?([A-Za-z0-9]{10,32})["'/?]/g;
export function parseGiphy(html, limit = 30) {
  html = html.replace(/\\\//g, '/');
  const ids = [];
  for (const rx of [GIPHY_ID, GIPHY_PATH]) {
    for (const m of html.matchAll(rx)) if (!ids.includes(m[1])) ids.push(m[1]);
    if (ids.length >= 6) break;
  }
  return ids.slice(0, limit).map((i) => ({ preview: `https://media.giphy.com/media/${i}/200w.gif`, full: `https://media.giphy.com/media/${i}/giphy.gif`,
    alt: `https://media.giphy.com/media/${i}/200.gif`, title: '' }));
}
const TENOR = /https?:(?:\\?\/){2}media1?\.tenor\.com(?:\\?\/)(?:m(?:\\?\/))?([A-Za-z0-9_-]{12,})(?:\\?\/)([\w%.-]+?)\.gif/g;
export function parseTenor(html, limit = 30) {
  const out = [], seen = new Set();
  for (const m of html.matchAll(TENOR)) {
    const tid = m[1], name = m[2];
    const base = tid.length > 12 ? tid.slice(0, -2) : tid;
    if (seen.has(base)) continue;
    seen.add(base);
    out.push({ preview: `https://media.tenor.com/${base}AM/${name}.gif`, full: `https://media.tenor.com/${base}AC/${name}.gif`,
      alt: `https://media1.tenor.com/m/${tid}/${name}.gif`, title: name.replace(/-/g, ' ') });
  }
  return out.slice(0, limit);
}

async function searchFree(query, limit) {
  const q = query.trim() || DEFAULT_QUERY;
  const errs = [];
  for (const [name, url, parse] of [['GIPHY', `https://giphy.com/search/${encodeURIComponent(slug(q))}`, parseGiphy],
    ['Tenor', `https://tenor.com/search/${encodeURIComponent(slug(q))}-gifs`, parseTenor]]) {
    try {
      const items = parse(await httpText(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, preferNative: true }), limit);
      if (items.length) return [items, name];
    } catch (e) { errs.push(e); }
  }
  if (errs.length === 2) throw errs[0];
  return [[], 'GIPHY'];
}

async function searchApi(query, limit, prov, key) {
  const q = encodeURIComponent(query.trim());
  if (prov === 'giphy') {
    const base = 'https://api.giphy.com/v1/gifs/';
    const url = (query.trim() ? `${base}search?q=${q}&` : `${base}trending?`) + `api_key=${encodeURIComponent(key)}&limit=${limit}&rating=pg-13`;
    const res = JSON.parse(await httpText(url));
    return (res.data || []).map((it) => {
      const im = it.images || {};
      return { preview: (im.fixed_width_small || im.fixed_width || {}).url, full: (im.fixed_height || im.downsized || im.original || {}).url, title: it.title || '' };
    }).filter((x) => x.preview && x.full);
  }
  let cid = localStorage.getItem('gif_cid');
  if (!cid) { cid = crypto.randomUUID().replace(/-/g, ''); localStorage.setItem('gif_cid', cid); }
  const base = `https://api.klipy.com/api/v1/${encodeURIComponent(key)}/gifs/`;
  const url = (query.trim() ? `${base}search?q=${q}&` : `${base}trending?`) + `per_page=${Math.min(limit, 50)}&page=1&rating=pg-13&customer_id=${cid}`;
  const res = JSON.parse(await httpText(url));
  const items = res.data && typeof res.data === 'object' && !Array.isArray(res.data) ? res.data.data : res.results || [];
  return (items || []).map((it) => {
    const f = it.file || it.files || {};
    const g = (k) => f[k] && f[k].gif && f[k].gif.url;
    return { preview: g('xs') || g('sm') || g('md'), full: g('sm') || g('md') || g('hd') || g('xs'), title: it.title || '' };
  }).filter((x) => x.preview && x.full);
}

export async function search(query, limit = 30) {
  const prov = S.get('gif_provider'), key = (S.get('gif_key') || '').trim();
  if (!key || prov === 'auto') return searchFree(query, limit);
  try {
    const items = await searchApi(query, limit, prov, key);
    if (items.length) return [items, prov === 'giphy' ? 'GIPHY' : 'KLIPY'];
  } catch (e) {}
  return searchFree(query, limit);
}

export async function downloadGif(item) {
  for (const u of [item.full, item.alt, item.preview].filter(Boolean)) {
    try {
      const b = await httpGet(u, { headers: { 'User-Agent': UA } });
      if (b.length && b.length < 8 * 1024 * 1024) return b;
    } catch (e) {}
  }
  throw new Error("couldn't download that GIF");
}

// ---- my GIFs
export async function myGifs() {
  const keys = (await idb.keys('kv')).filter((k) => String(k).startsWith('mygif:'));
  const all = [];
  for (const k of keys) { const v = await idb.get('kv', k); if (v) all.push({ key: k, ...v }); }
  return all.sort((a, b) => b.t - a.t);
}
export async function saveMyGif(name, bytes) {
  await idb.put('kv', 'mygif:' + Date.now() + Math.random().toString(16).slice(2, 6), { name, bytes, t: Date.now() });
}
export async function touchMyGif(g) { await idb.put('kv', g.key, { name: g.name, bytes: g.bytes, t: Date.now() }); }
export async function removeMyGif(key) { await idb.del('kv', key); }
