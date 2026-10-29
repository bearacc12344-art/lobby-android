// Smult's drawn icons (same set as PC Smult): I('📞') -> inline SVG that follows the theme colours.
// Anything without a drawn icon stays the emoji. People's messages never go through this.
import { h } from 'preact';
import { ICON_MAP, ICON_SVG } from './icons_data.js';
import { S } from './settings.js';

const VS = /[︎️‍⃣]/g;
export function iconName(e) {
  if (!e || typeof e !== 'string') return null;
  return ICON_MAP[e] || ICON_MAP[e.replace(VS, '')] || ICON_MAP[e + '️'] || ICON_MAP[e.replace(VS, '').replace('̸', '')] || null;
}
export function I(e, cls = '') {
  let n = S.get('drawn_icons') !== false && iconName(e);
  if (!n) return e;
  let col = null;
  if (n.includes('|')) [n, col] = n.split('|');
  if (n === 'call' && cls === 'red') n = 'hangup';
  if (!ICON_SVG[n]) return e;
  return h('svg', { class: 'ico ' + cls + (col ? ' col' : ''), style: col ? `--icf:${col}` : undefined, viewBox: '0 0 100 100', 'aria-hidden': 'true',
    dangerouslySetInnerHTML: { __html: ICON_SVG[n] } });
}
// any text -> the same text with every drawn emoji swapped for its icon (string if nothing changed)
const EM = /(?:[\u{1F1E6}-\u{1F1FF}]{2})|(?:[\u{1F000}-\u{1FAFF}\u2600-\u27BF\u2B00-\u2BFF\u2300-\u23FF\u2139\u2705\u2190-\u21FF](?:[\uFE0F\uFE0E\u0338]|\u200D[\u{1F000}-\u{1FAFF}\u2600-\u27BF])*)/gu;
const QUICK = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF\u2B00-\u2BFF\u2300-\u23FF\u2139\u2705\u2190-\u21FF]/u;
export function swapEmoji(text) {
  if (!text || !QUICK.test(text) || S.get('drawn_icons') === false) return text;
  const out = [];
  let last = 0, hit = false;
  for (const m of text.matchAll(EM)) {
    if (!iconName(m[0])) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(I(m[0]));
    last = m.index + m[0].length;
    hit = true;
  }
  if (!hit) return text;
  if (last < text.length) out.push(text.slice(last));
  return out;
}
// '📌 Pin to top' -> [icon, ' Pin to top']
export function IT(text) {
  if (typeof text !== 'string') return text;
  const t = text.trimStart();
  for (const n of [3, 2, 1]) {
    const head = [...t].slice(0, n).join('');
    if (iconName(head) && head.length < t.length && /\s/.test(t[head.length])) return [I(head), t.slice(head.length)];
    if (iconName(head) && head.length === t.length) return I(head);
  }
  return text;
}
