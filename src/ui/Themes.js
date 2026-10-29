// Settings → Themes: theme tiles, a DOORS-styled theme editor (shares codes with PC Smult), and picture / GIF backgrounds
import { html, useState } from './h.js';
import { I } from '../util/icons.js';
import { ctx } from '../ctx.js';
import { S } from '../util/settings.js';
import { tr } from '../util/i18n.js';
import { THEMES, PALETTE_KEYS, palette, applyBackground } from './theme.js';
import { TopBar, Slider, Check } from './common.js';
import { pickFiles } from '../util/files.js';
import { idb } from '../net/idb.js';

const NICE = { bg: 'Background', panel: 'Panels', panel2: 'Cards', panel3: 'Raised bits', border: 'Borders', text: 'Text', muted: 'Quiet text',
  accent: 'Accent', accent2: 'Accent 2', accent_text: 'Text on accent', danger: 'Danger', ok: 'Good', bubble_me: 'My bubbles', bubble: 'Their bubbles',
  link: 'Links', mention: 'Mentions' };

const light = (hex) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 160;
};

function Mini({ p, big }) {
  const C = big ? 'bigprev' : 'pv';
  return html`<div class=${C} style=${{ background: `radial-gradient(90% 70% at 10% 0%, ${p.accent}55, transparent 60%), ${p.bg}` }}>
    <i style=${{ left: '4%', top: '6%', width: '9%', height: '88%', background: p.panel }}></i>
    <i style=${{ left: '6%', top: '14%', width: '5%', height: '9%', background: p.accent }}></i>
    <i style=${{ left: '16%', top: '6%', width: '28%', height: '88%', background: p.panel }}></i>
    <i style=${{ left: '18%', top: '14%', width: '24%', height: '12%', background: p.mention }}></i>
    <i style=${{ left: '18%', top: '30%', width: '24%', height: '12%', background: p.panel3 }}></i>
    <i style=${{ left: '47%', top: '6%', width: '49%', height: '88%', background: p.panel }}></i>
    <i style=${{ left: '50%', top: '20%', width: '26%', height: '14%', background: p.bubble }}></i>
    <i style=${{ left: '67%', top: '42%', width: '26%', height: '14%', background: p.bubble_me }}></i>
    <i style=${{ left: '50%', top: '74%', width: '43%', height: '12%', background: p.panel2 }}></i>
    ${big ? html`<i style=${{ left: '52%', top: '22%', color: p.text, fontStyle: 'normal', fontSize: '11px', fontWeight: 700 }}>hey!</i>` : null}
  </div>`;
}

export function ThemesPage() {
  const [, set] = useState(0);
  const refresh = () => set((x) => x + 1);
  const customs = S.get('custom_themes') || {};
  const cur = S.get('theme');
  const all = [...Object.entries(THEMES), ...Object.entries(customs).map(([n, c]) => [n, { ...THEMES['Neon Glass'], ...c }])];
  const start = customs[cur] ? { ...THEMES['Neon Glass'], ...customs[cur] } : palette();
  const [pal, setPal] = useState(() => Object.fromEntries(PALETTE_KEYS.map((k) => [k, start[k] || (k === 'accent2' ? start.accent : '#888888')])));
  const [name, setName] = useState(customs[cur] ? cur : '');
  const use = (n) => { S.set('theme', n); S.set('accent', ''); refresh(); };
  const tileMenu = (n) => {
    if (!customs[n]) return use(n);
    ctx.menu([
      { ic: '✅', label: 'Use it', fn: () => use(n) },
      { ic: '✏️', label: 'Edit in the editor', fn: () => { setPal({ ...THEMES['Neon Glass'], ...customs[n] }); setName(n); } },
      { ic: '🗑', label: 'Delete', danger: true, fn: () => { const c = { ...customs }; delete c[n]; S.set('custom_themes', c); if (cur === n) S.set('theme', 'Neon Glass'); refresh(); } },
    ], n);
  };
  const save = () => {
    let n = (name.trim() || 'My theme').slice(0, 28);
    if (THEMES[n]) n += ' (mine)';
    S.set('custom_themes', { ...customs, [n]: { ...pal } });
    S.set('theme', n);
    S.set('accent', '');
    ctx.toast(`🎨 Saved '${n}'`, 'ok');
    refresh();
  };
  const share = async () => {
    const code = 'SMULT-THEME:' + btoa(unescape(encodeURIComponent(JSON.stringify({ n: name.trim() || 'Shared theme', p: pal })))).replace(/\+/g, '-').replace(/\//g, '_');
    try { await navigator.clipboard.writeText(code); ctx.toast('📋 Theme code copied — send it to a friend', 'ok'); } catch (e) { await ctx.prompt('Theme code', { value: code }); }
  };
  const paste = async () => {
    let t = '';
    try { t = await navigator.clipboard.readText(); } catch (e) { /* no permission */ }
    if (!t.startsWith('SMULT-THEME:')) t = (await ctx.prompt('Paste a theme code', { placeholder: 'SMULT-THEME:...' })) || '';
    try {
      const d = JSON.parse(decodeURIComponent(escape(atob(t.split(':')[1].replace(/-/g, '+').replace(/_/g, '/')))));
      const p = Object.fromEntries(Object.entries(d.p || {}).filter(([k, v]) => PALETTE_KEYS.includes(k) && /^#[0-9a-f]{3,8}$/i.test(v)));
      setPal({ ...pal, ...p });
      setName(String(d.n || 'Shared theme').slice(0, 28));
      ctx.toast('📥 Theme loaded — tap Save to keep it', 'ok');
    } catch (e) { ctx.toast('That is not a Smult theme code', 'error'); }
  };
  const pickBg = async () => {
    const [f] = await pickFiles({ accept: 'image/*', multiple: false });
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) return ctx.toast('That file is too big (max 25 MB)', 'error');
    const key = 'bg:' + Date.now().toString(36);
    const old = S.get('bg_key');
    await idb.put('kv', key, { bytes: new Uint8Array(await f.arrayBuffer()), mime: f.type || 'image/gif' });
    if (old) idb.del('kv', old).catch(() => {});
    S.set('bg_key', key);
    S.set('bg_mode', 'image');
    ctx.toast('🖼 New background!', 'ok');
    refresh();
  };
  const bgOn = S.get('bg_mode') === 'image' && S.get('bg_key');
  return html`<${TopBar} title=${tr('Themes')} /><div class="content" style=${{ padding: '4px 16px 40px' }}>
    <div class="small muted" style=${{ margin: '10px 0' }}>${tr('Pick a look, make your own, or put a picture or GIF behind everything.')}</div>
    <div class="section">${tr('Themes')}</div>
    <div class="ttiles">${all.map(([n, p]) => html`<button class=${'ttile' + (cur === n ? ' on' : '')} onClick=${() => tileMenu(n)}>
      <${Mini} p=${p} /><small>${cur === n ? '✓ ' : ''}${n}</small></button>`)}</div>

    <div class="doors">
      <h3>THEME EDITOR</h3>
      <div class="sub">${tr('Every colour in Smult. Tap a plaque to change it — the preview updates live. Codes work on PC Smult too.')}</div>
      <input class="field" placeholder=${tr('Name your theme (e.g. Room 100)')} value=${name} onInput=${(e) => setName(e.target.value)} />
      <select class="field" style=${{ marginTop: '8px' }} onChange=${(e) => { const b = THEMES[e.target.value] || { ...THEMES['Neon Glass'], ...(customs[e.target.value] || {}) }; setPal(Object.fromEntries(PALETTE_KEYS.map((k) => [k, b[k] || b.accent]))); }}>
        <option value="">${tr('Start from…')}</option>${all.map(([n]) => html`<option value=${n}>${n}</option>`)}</select>
      <div style=${{ marginTop: '10px' }}><${Mini} p=${pal} big=${true} /></div>
      <div class="plaques">${PALETTE_KEYS.map((k) => html`<label class="plaque" style=${{ background: pal[k], color: light(pal[k]) ? '#111' : '#fff' }}>
        ${tr(NICE[k] || k)}<input type="color" value=${pal[k].slice(0, 7)} onInput=${(e) => setPal({ ...pal, [k]: e.target.value })} /></label>`)}</div>
      <div class="row wrap" style=${{ gap: '8px' }}>
        <button class="btn" onClick=${save}>${I('💾')} ${tr('Save & use')}</button>
        <button class="btn" onClick=${share}>${I('📋')} ${tr('Copy code')}</button>
        <button class="btn" onClick=${paste}>${I('📥')} ${tr('Paste code')}</button>
      </div>
    </div>

    <div class="section">${tr('Background')}</div>
    <div class="row" style=${{ gap: '8px' }}>
      <button class="btn primary" onClick=${pickBg}>${I('🖼')} ${tr(bgOn ? 'Change picture / GIF' : 'Pick a picture or GIF')}</button>
      ${bgOn ? html`<button class="btn" onClick=${() => { S.set('bg_mode', 'theme'); refresh(); }}>${tr('Remove')}</button>` : null}
    </div>
    ${bgOn ? html`
      <${Slider} k="bg_opacity" label="Picture opacity" min=${0} max=${100} suffix="%" onChange=${applyBackground} />
      <${Slider} k="bg_tint" label="Theme tint over it" min=${0} max=${90} suffix="%" onChange=${applyBackground} />
      <${Slider} k="bg_blur" label="Blur" min=${0} max=${30} suffix="px" onChange=${applyBackground} />` : null}
    <div class="section">${tr('Glass')}</div>
    <${Slider} k="glass_opacity" label="Panel opacity" min=${20} max=${100} suffix="%" onChange=${applyBackground} />
  </div>`;
}
