import { S } from '../util/settings.js';

export const THEMES = {
  Hotel: { bg: '#0f0b08', panel: '#17110d', panel2: '#211812', panel3: '#2b1f17', border: '#3a2b1f', text: '#f2e4cc', muted: '#a48b70', accent: '#e0a94a', accent_text: '#1a120b', danger: '#d0473a', ok: '#7bc96f', bubble_me: '#3a2814', bubble: '#241a13', link: '#f0c674', mention: '#4a3412' },
  Midnight: { bg: '#090c13', panel: '#0f1420', panel2: '#151c2c', panel3: '#1d2639', border: '#263149', text: '#e6ecf7', muted: '#8592ad', accent: '#6aa8ff', accent_text: '#081022', danger: '#ef5b5b', ok: '#5fd38a', bubble_me: '#1d3358', bubble: '#182134', link: '#8fc1ff', mention: '#22385e' },
  Seek: { bg: '#040404', panel: '#0b0b0b', panel2: '#121212', panel3: '#1a1a1a', border: '#262626', text: '#ececec', muted: '#8a8a8a', accent: '#d8d8d8', accent_text: '#050505', danger: '#ff4d4d', ok: '#79e07b', bubble_me: '#262626', bubble: '#161616', link: '#ffffff', mention: '#333333' },
  Rush: { bg: '#06100a', panel: '#0b1810', panel2: '#102217', panel3: '#162d1f', border: '#1f3d2a', text: '#dff5e5', muted: '#7fa58b', accent: '#58e07f', accent_text: '#03130a', danger: '#ff5d5d', ok: '#58e07f', bubble_me: '#174028', bubble: '#11261a', link: '#8ff0aa', mention: '#1d4a2e' },
  'Guiding Light': { bg: '#07101c', panel: '#0c1828', panel2: '#112136', panel3: '#172b44', border: '#21395a', text: '#e2f1ff', muted: '#86a5c4', accent: '#7fd3ff', accent_text: '#03101c', danger: '#ff6b6b', ok: '#7fe0b0', bubble_me: '#173a5c', bubble: '#122539', link: '#a8e2ff', mention: '#1d4266' },
  'Neon Glass': { bg: '#07061a', panel: '#0c0a24', panel2: '#14113a', panel3: '#1d1950', border: '#2b2566', text: '#eef0ff', muted: '#9a97cc', accent: '#29e0ff', accent2: '#b44dff', accent_text: '#04121a', danger: '#ff4d7a', ok: '#3dffa8', bubble_me: '#3a1e6e', bubble: '#17143f', link: '#7cf3ff', mention: '#2a1f66' },
  'Smult Light': { bg: '#f3ece1', panel: '#fbf7f0', panel2: '#efe6d8', panel3: '#e5d9c6', border: '#d8c8b0', text: '#2a1d12', muted: '#7b6550', accent: '#b8761c', accent_text: '#ffffff', danger: '#c0392b', ok: '#3f9a4a', bubble_me: '#f0d9b0', bubble: '#ffffff', link: '#9a5a0a', mention: '#f6dfae' },
};

export const PALETTE_KEYS = ['bg', 'panel', 'panel2', 'panel3', 'border', 'text', 'muted', 'accent', 'accent2', 'accent_text', 'danger', 'ok', 'bubble_me', 'bubble', 'link', 'mention'];

export function palette() {
  const name = S.get('theme') === 'Lobby Light' ? 'Smult Light' : S.get('theme');
  const custom = (S.get('custom_themes') || {})[name];
  if (custom) return { ...THEMES['Neon Glass'], ...Object.fromEntries(Object.entries(custom).filter(([k, v]) => PALETTE_KEYS.includes(k) && /^#[0-9a-f]{3,8}$/i.test(v))) };
  const p = { ...(THEMES[name] || THEMES.Hotel) };
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
  root.setProperty('--g1', p.accent);
  root.setProperty('--g2', p.accent2 || p.accent);
  applyBackground();
  // icon shadow: halfway between the muted text colour and the background
  const mix = (a, b) => '#' + [1, 3, 5].map((i) => Math.round((parseInt(a.slice(i, i + 2), 16) + parseInt(b.slice(i, i + 2), 16)) / 2).toString(16).padStart(2, '0')).join('');
  root.setProperty('--ico-sh', mix(p.muted, p.bg));
  const fonts = { cut: "'SmultCut', 'ComicNeue'", comic: "'LobbyComic', 'ComicNeue'", doors: "'Doors', 'ComicNeue'", system: "system-ui, 'Roboto'" };
  root.setProperty('--font', `${fonts[S.get('font')] || fonts.cut}, 'Twemoji', 'Noto Color Emoji', sans-serif`);
  root.setProperty('--fs', S.get('font_size') + 'px');
  document.documentElement.classList.toggle('compact', !!S.get('compact'));
  for (const k of ['neon', 'lux', 'clean']) document.documentElement.classList.toggle('skin-' + k, S.get('ui_skin') === k);
  document.documentElement.classList.toggle('noanim', !S.get('animations'));
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = p.panel;
}


// ---------------------------------------------------------------- backgrounds (Settings → Themes):
// picture / GIF, interactive (livebg.js), or a YouTube video (embedded, muted, looping)
let bgUrl = '', bgKey = '', live = null, liveKey = '', ytKey = '';
export function liveConfig() {
  const name = S.get('bg_live') || 'Neon Web';
  const mine = S.get('live_bgs') || {};
  return { name, cfg: mine[name] || null };
}
export async function applyBackground() {
  const mode = S.get('bg_mode');
  const on = (mode === 'image' && S.get('bg_key')) || mode === 'live' || (mode === 'video' && S.get('bg_yt'));
  let layer = document.getElementById('bgLayer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'bgLayer';
    layer.innerHTML = '<i class="pic"></i><canvas class="live"></canvas><div class="yt"></div><i class="tint"></i>';
    document.body.prepend(layer);
  }
  document.documentElement.classList.toggle('has-bg', !!on);
  const root = document.documentElement.style;
  root.setProperty('--glass-a', String(Math.max(0.2, Math.min(1, (S.get('glass_opacity') ?? 78) / 100))));
  const pic = layer.querySelector('.pic'), tint = layer.querySelector('.tint'), canvas = layer.querySelector('.live'), yt = layer.querySelector('.yt');
  // interactive
  const lk = mode === 'live' ? JSON.stringify(liveConfig()) : '';
  if (lk !== liveKey) {
    liveKey = lk;
    if (live) { live.stop(); live = null; }
    if (mode === 'live') {
      const L = await import('./livebg.js');
      const { name, cfg } = liveConfig();
      live = L.runCanvas(canvas, L.clean(cfg || L.PRESETS[name] || L.DEFAULT), () => { const p = palette(); return { accent: p.accent, accent2: p.accent2 || p.accent }; },
        { input: window });
    }
  }
  canvas.style.display = mode === 'live' ? '' : 'none';
  // YouTube
  const yk = mode === 'video' ? S.get('bg_yt') || '' : '';
  if (yk !== ytKey) {
    ytKey = yk;
    yt.innerHTML = '';
    if (yk) {
      const f = document.createElement('iframe');
      f.src = `https://www.youtube-nocookie.com/embed/${yk}?autoplay=1&mute=1&loop=1&playlist=${yk}&controls=0&playsinline=1&modestbranding=1&rel=0&disablekb=1&iv_load_policy=3`;
      f.allow = 'autoplay; encrypted-media';
      f.setAttribute('frameborder', '0');
      f.setAttribute('tabindex', '-1');
      yt.appendChild(f);
    }
  }
  yt.style.display = mode === 'video' ? '' : 'none';
  if (!on) { layer.style.display = 'none'; return; }
  layer.style.display = '';
  const isPic = mode === 'image', soft = mode !== 'live';
  pic.style.display = isPic ? '' : 'none';
  const op = String((S.get('bg_opacity') ?? 60) / 100);
  pic.style.opacity = op; yt.style.opacity = op;
  const blur = S.get('bg_blur') ? `blur(${S.get('bg_blur')}px)` : '';
  pic.style.filter = blur; yt.style.filter = blur;
  tint.style.display = soft ? '' : 'none';
  tint.style.opacity = String((S.get('bg_tint') ?? 25) / 100);
  if (!isPic) return;
  const key = S.get('bg_key');
  if (key !== bgKey) {
    bgKey = key;
    try {
      const { idb } = await import('../net/idb.js');
      const rec = await idb.get('kv', key);
      if (rec) {
        if (bgUrl) URL.revokeObjectURL(bgUrl);
        bgUrl = URL.createObjectURL(new Blob([rec.bytes || rec], { type: rec.mime || 'image/gif' }));
        pic.style.backgroundImage = `url("${bgUrl}")`;
      }
    } catch (e) { console.warn('background', e); }
  }
}
