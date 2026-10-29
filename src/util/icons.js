// Lobby's drawn icons (same set as PC Lobby): I('📞') -> inline SVG that follows the theme colours.
// Anything without a drawn icon stays the emoji. People's messages never go through this.
import { h } from 'preact';
import { ICON_MAP, ICON_SVG } from './icons_data.js';
import { S } from './settings.js';

const VS = /[︎️‍]/g;
export function iconName(e) {
  if (!e || typeof e !== 'string') return null;
  return ICON_MAP[e] || ICON_MAP[e.replace(VS, '')] || ICON_MAP[e + '️'] || null;
}
export function I(e, cls = '') {
  let n = S.get('drawn_icons') !== false && iconName(e);
  if (!n) return e;
  if (n === 'call' && cls === 'red') n = 'hangup';
  return h('svg', { class: 'ico ' + cls, viewBox: '0 0 100 100', 'aria-hidden': 'true', dangerouslySetInnerHTML: { __html: ICON_SVG[n] } });
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
