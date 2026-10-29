import { S } from '../util/settings.js';

export const THEMES = {
  Hotel: { bg: '#0f0b08', panel: '#17110d', panel2: '#211812', panel3: '#2b1f17', border: '#3a2b1f', text: '#f2e4cc', muted: '#a48b70', accent: '#e0a94a', accent_text: '#1a120b', danger: '#d0473a', ok: '#7bc96f', bubble_me: '#3a2814', bubble: '#241a13', link: '#f0c674', mention: '#4a3412' },
  Midnight: { bg: '#090c13', panel: '#0f1420', panel2: '#151c2c', panel3: '#1d2639', border: '#263149', text: '#e6ecf7', muted: '#8592ad', accent: '#6aa8ff', accent_text: '#081022', danger: '#ef5b5b', ok: '#5fd38a', bubble_me: '#1d3358', bubble: '#182134', link: '#8fc1ff', mention: '#22385e' },
  Seek: { bg: '#040404', panel: '#0b0b0b', panel2: '#121212', panel3: '#1a1a1a', border: '#262626', text: '#ececec', muted: '#8a8a8a', accent: '#d8d8d8', accent_text: '#050505', danger: '#ff4d4d', ok: '#79e07b', bubble_me: '#262626', bubble: '#161616', link: '#ffffff', mention: '#333333' },
  Rush: { bg: '#06100a', panel: '#0b1810', panel2: '#102217', panel3: '#162d1f', border: '#1f3d2a', text: '#dff5e5', muted: '#7fa58b', accent: '#58e07f', accent_text: '#03130a', danger: '#ff5d5d', ok: '#58e07f', bubble_me: '#174028', bubble: '#11261a', link: '#8ff0aa', mention: '#1d4a2e' },
  'Guiding Light': { bg: '#07101c', panel: '#0c1828', panel2: '#112136', panel3: '#172b44', border: '#21395a', text: '#e2f1ff', muted: '#86a5c4', accent: '#7fd3ff', accent_text: '#03101c', danger: '#ff6b6b', ok: '#7fe0b0', bubble_me: '#173a5c', bubble: '#122539', link: '#a8e2ff', mention: '#1d4266' },
  'Lobby Light': { bg: '#f3ece1', panel: '#fbf7f0', panel2: '#efe6d8', panel3: '#e5d9c6', border: '#d8c8b0', text: '#2a1d12', muted: '#7b6550', accent: '#b8761c', accent_text: '#ffffff', danger: '#c0392b', ok: '#3f9a4a', bubble_me: '#f0d9b0', bubble: '#ffffff', link: '#9a5a0a', mention: '#f6dfae' },
};

export function palette() {
  const p = { ...(THEMES[S.get('theme')] || THEMES.Hotel) };
  const acc = S.get('accent');
  if (acc) {
    p.accent = acc;
    const r = parseInt(acc.slice(1, 3), 16), g = parseInt(acc.slice(3, 5), 16), b = parseInt(acc.slice(5, 7), 16);
    p.accent_text = (0.299 * r + 0.587 * g + 0.114 * b) > 140 ? '#111111' : '#ffffff';
  }
  return p;
}

export function applyTheme() {
  const p = palette();
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(p)) root.setProperty('--' + k.replace('_', '-'), v);
  const fonts = { comic: "'LobbyComic', 'ComicNeue'", doors: "'Doors', 'ComicNeue'", system: "system-ui, 'Roboto'" };
  root.setProperty('--font', `${fonts[S.get('font')] || fonts.comic}, 'Twemoji', 'Noto Color Emoji', sans-serif`);
  root.setProperty('--fs', S.get('font_size') + 'px');
  document.documentElement.classList.toggle('compact', !!S.get('compact'));
  document.documentElement.classList.toggle('noanim', !S.get('animations'));
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = p.panel;
}
