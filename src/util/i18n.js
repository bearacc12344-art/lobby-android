// English / Português / Español - same tables and matching rules as the PC app (i18n.py).
// tr("Bob is calling you") -> "Bob está te ligando". People's chat messages are never passed through this.
import { S } from './settings.js';

export const LANGS = [['auto', '🌐 Automatic (system language)'], ['en', '🇺🇸 English'], ['pt', '🇧🇷 Português (Brasil)'], ['es', '🇪🇸 Español']];
let LANG = 'en';
const EXACT = new Map(), UPPER = new Map(), TEMPLATES = [], PREFIXES = [], CACHE = new Map();
const norm = (s) => s.trim().replace(/^·+|·+$/g, '').trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function detect() {
  const want = S.get('language');
  if (['en', 'pt', 'es'].includes(want)) return want;
  const nav = (navigator.language || 'en').toLowerCase();
  return nav.startsWith('pt') ? 'pt' : nav.startsWith('es') ? 'es' : 'en';
}
export const lang = () => LANG;

export async function loadI18n() {
  LANG = detect();
  EXACT.clear(); UPPER.clear(); TEMPLATES.length = 0; PREFIXES.length = 0; CACHE.clear();
  if (LANG === 'en') return;
  const T = await (await fetch('assets/i18n.json')).json();
  Object.assign(T, (await import('./i18n_mobile.js')).MOBILE);
  const col = LANG === 'pt' ? 0 : 1;
  for (const [en, tt] of Object.entries(T)) {
    const t = tt[col];
    if (!t) continue;
    const k = norm(en);
    if (/\{\d+\}/.test(k)) {
      const rx = esc(k).replace(/\\\{(\d+)\\\}/g, (_, n) => `(?<g${n}>(?:(?! · ).)+?)`);
      TEMPLATES.push([new RegExp('^' + rx + '$', 's'), norm(t), rx.length]);
    } else {
      EXACT.set(k, norm(t));
      if (!UPPER.has(k.toUpperCase())) UPPER.set(k.toUpperCase(), norm(t).toUpperCase());
      if (/[:—-]$/.test(k) && k.length >= 3) PREFIXES.push([k, norm(t)]);
    }
  }
  PREFIXES.sort((a, b) => b[0].length - a[0].length);
  TEMPLATES.sort((a, b) => b[2] - a[2]);
}

function core(t, depth = 0) {
  if (EXACT.has(t)) return EXACT.get(t);
  if (t === t.toUpperCase() && UPPER.has(t)) return UPPER.get(t);
  if (depth > 2) return null;
  const m0 = /^([^\p{L}\p{N}\s]+\s+)([\p{L}\p{N}].*)$/su.exec(t);
  if (m0 && EXACT.has(m0[2])) return m0[1] + EXACT.get(m0[2]);
  for (const [rx, out] of TEMPLATES) {
    const m = rx.exec(t);
    if (m) return out.replace(/\{(\d+)\}/g, (_, n) => { const v = m.groups['g' + n]; return core(v, depth + 1) ?? v; });
  }
  for (const [pre, out] of PREFIXES) {
    if (t.startsWith(pre)) { const rest = t.slice(pre.length).trimStart(); return out + ' ' + (core(rest, depth + 1) ?? rest); }
  }
  return null;
}

function piece(seg) {
  const m = /^([\s ·]*)(.*?)([\s ·]*)$/s.exec(seg);
  const [, lead, c, trail] = m;
  if (!c || !/[A-Za-z]/.test(c)) return seg;
  let t = core(c);
  if (t === null && c.includes(' · ')) {
    const parts = c.split(' · ');
    const tt = parts.map((x) => core(x) ?? x);
    if (tt.some((x, i) => x !== parts[i])) t = tt.join(' · ');
  }
  return t === null ? seg : lead + t + trail;
}

export function tr(text) {
  if (LANG === 'en' || !text || typeof text !== 'string') return text;
  const hit = CACHE.get(text);
  if (hit !== undefined) return hit;
  const out = text.includes('\n') ? text.split('\n').map(piece).join('\n') : piece(text);
  if (CACHE.size > 20000) CACHE.clear();
  CACHE.set(text, out);
  return out;
}
