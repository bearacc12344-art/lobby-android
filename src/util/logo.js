// The Smult logo follows the theme: same hand-cut door, the theme's colours (same table as the PC app).
import { html } from '../ui/h.js';
import { S } from './settings.js';
import TEMPLATE from '../assets/appicon_template.svg?raw';

export const ICON_SCHEMES = {
  'Neon Glass': { tile1: '#1b1060', tile2: '#07061a', rim1: '#29e0ff', rim2: '#b44dff', glow: '#29e0ff', door: '#f2f3ff', shadow: '#3b3378', knob: '#29e0ff' },
  Hotel: { tile1: '#3a2814', tile2: '#0f0b08', rim1: '#f0c674', rim2: '#b5651d', glow: '#e0a94a', door: '#f2e4cc', shadow: '#4a3412', knob: '#e0a94a' },
  Midnight: { tile1: '#1d3358', tile2: '#090c13', rim1: '#8fc1ff', rim2: '#4a5cff', glow: '#6aa8ff', door: '#e6ecf7', shadow: '#22385e', knob: '#6aa8ff' },
  Seek: { tile1: '#222222', tile2: '#040404', rim1: '#ffffff', rim2: '#4a4a4a', glow: '#bdbdbd', door: '#ececec', shadow: '#333333', knob: '#ff4d4d' },
  Rush: { tile1: '#174028', tile2: '#06100a', rim1: '#8ff0aa', rim2: '#1f9a48', glow: '#58e07f', door: '#dff5e5', shadow: '#1d4a2e', knob: '#58e07f' },
  'Guiding Light': { tile1: '#173a5c', tile2: '#07101c', rim1: '#a8e2ff', rim2: '#3d7bff', glow: '#7fd3ff', door: '#e2f1ff', shadow: '#1d4266', knob: '#7fd3ff' },
  'Smult Light': { tile1: '#fffaf2', tile2: '#e8dcc8', rim1: '#f0c674', rim2: '#b8761c', glow: '#f0c674', door: '#2a1d12', shadow: '#cdb999', knob: '#e0a94a' },
};

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0');
  return '#' + ch(n >> 16) + ch((n >> 8) & 255) + ch(n & 255);
}

export function iconScheme() {
  const theme = S.get('theme') === 'Lobby Light' ? 'Smult Light' : S.get('theme');
  const neon = S.get('ui_skin') === 'neon' && theme !== 'Smult Light';
  const sch = { ...(ICON_SCHEMES[neon ? 'Neon Glass' : theme] || ICON_SCHEMES['Neon Glass']) };
  const acc = S.get('accent');
  if (acc) Object.assign(sch, { rim1: shade(acc, 1.3), rim2: shade(acc, 0.66), glow: acc, knob: acc });
  const ct = S.get('custom_theme');
  if (S.get('theme') === 'Custom' && ct) Object.assign(sch, { tile1: ct.panel2 || sch.tile1, tile2: ct.bg || sch.tile2, rim1: ct.accent || sch.rim1, glow: ct.accent || sch.glow, knob: ct.accent || sch.knob });
  return sch;
}

let cacheKey = '', cacheUrl = '';
export function logoUrl() {
  const sch = iconScheme();
  const k = JSON.stringify(sch);
  if (k !== cacheKey) {
    let svg = TEMPLATE;
    for (const [n, v] of Object.entries(sch)) svg = svg.split('{' + n + '}').join(v);
    cacheUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    cacheKey = k;
  }
  return cacheUrl;
}

export function AppLogo({ size = 96, cls = 'applogo' }) {
  return html`<img src=${logoUrl()} class=${cls} style=${{ width: size + 'px', height: size + 'px' }} alt="Smult" />`;
}
