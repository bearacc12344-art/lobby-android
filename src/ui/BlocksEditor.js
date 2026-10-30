// DOORS-styled blocks on the phone (same blocks + same Lua as PC Smult). Drag with your finger: blocks snap under
// each other and into "if"/"repeat" mouths; drop on the trash to delete; long-press for more.
import { html, useEffect, useRef, useState } from './h.js';
import { tr } from '../util/i18n.js';
import { ctx } from '../ctx.js';
import { CATS, BLOCKS } from '../addons/blocksdef.js';
import { generate } from '../addons/blocksgen.js';
import { THEMES } from './theme.js';
import { S } from '../util/settings.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const fresh = (t) => ({ t, f: Object.fromEntries(Object.entries(BLOCKS[t].fields || {}).map(([k, s]) => [k, s[1]])), s: BLOCKS[t].kind === 'c' ? [null] : [], n: null });

// paths inside the model: ['stack', i] then any of 'n' / 's'
function getAt(model, path) {
  let b = model.stacks[path[1]].b;
  for (const p of path.slice(2)) b = p === 'n' ? b.n : b.s[0];
  return b;
}
function detach(model, path) {
  if (path.length === 2) { const st = model.stacks.splice(path[1], 1)[0]; return st.b; }
  const parent = getAt(model, path.slice(0, -1));
  const last = path[path.length - 1];
  const b = last === 'n' ? parent.n : parent.s[0];
  if (last === 'n') parent.n = null; else parent.s[0] = null;
  return b;
}
const tail = (b) => { while (b.n) b = b.n; return b; };

function Field({ b, name, spec, onChange }) {
  if (spec[0] === 'choice') {
    const opts = spec[2] || [...Object.keys(THEMES), ...Object.keys(S.get('custom_themes') || {})];
    return html`<select class="bfield" value=${b.f[name]} onPointerDown=${(e) => e.stopPropagation()} onChange=${(e) => { b.f[name] = e.target.value; onChange(); }}>
      ${opts.map((o) => html`<option value=${o}>${o}</option>`)}</select>`;
  }
  return html`<input class="bfield" value=${b.f[name]} size=${Math.max(3, Math.min(24, String(b.f[name]).length + 1))} autocapitalize="off"
    onPointerDown=${(e) => e.stopPropagation()} onInput=${(e) => { b.f[name] = e.target.value; e.target.size = Math.max(3, Math.min(24, e.target.value.length + 1)); onChange(true); }} />`;
}

function Block({ b, path, ed }) {
  const d = BLOCKS[b.t];
  const col = CATS[d.cat][0];
  const bits = d.text.split(/(\{\w+\})/);
  return html`<div class="bstackpart">
    <div class=${'dblock ' + d.kind} style=${{ '--bc': col }} data-path=${JSON.stringify(path)}
      onPointerDown=${(e) => ed.startDrag(e, path)}>
      <div class="bhead">${bits.map((bit) => {
        const m = /^\{(\w+)\}$/.exec(bit);
        return m && d.fields && d.fields[m[1]] ? html`<${Field} b=${b} name=${m[1]} spec=${d.fields[m[1]]} onChange=${ed.changed} />` : bit.trim() ? html`<span>${bit.trim()}</span>` : null;
      })}</div>
      ${d.kind === 'c' ? html`<div class="bmouth" data-slot=${JSON.stringify([...path, 's'])}>${b.s[0] ? html`<${Block} b=${b.s[0]} path=${[...path, 's']} ed=${ed} />` : html`<div class="bempty"></div>`}</div><div class="bfoot"></div>` : null}
    </div>
    ${b.n ? html`<${Block} b=${b.n} path=${[...path, 'n']} ed=${ed} />` : null}</div>`;
}

export function BlocksEditor({ files, man, onCode }) {
  const [model, setModel] = useState(() => { try { return JSON.parse(files['blocks.json']); } catch (e) { return { version: 1, stacks: [] }; } });
  const [cat, setCat] = useState('events');
  const [drag, setDrag] = useState(null);       // {b, x, y, ox, oy}
  const [, force] = useState(0);
  const ws = useRef(null), trash = useRef(null);
  const emit = useRef(null);
  const changed = (soft) => {
    if (!soft) force((x) => x + 1);
    clearTimeout(emit.current);
    emit.current = setTimeout(() => { const [lua, perms] = generate(model.stacks, man.name); onCode(lua, perms, JSON.stringify(model)); }, 300);
  };
  useEffect(() => { changed(true); }, []);

  const ed = {
    changed,
    startDrag(e, path) {
      if (e.button > 0) return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget, r = el.getBoundingClientRect();
      const ox = e.clientX - r.left, oy = e.clientY - r.top;
      const t0 = Date.now(), sx = e.clientX, sy = e.clientY;
      let started = false, lp = setTimeout(() => { if (!started) { lp = null; menu(path); } }, 550);
      const move = (ev) => {
        if (!started && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) {
          started = true;
          clearTimeout(lp);
          const b = detach(model, path);
          setDrag({ b, x: ev.clientX - ox, y: ev.clientY - oy, ox, oy });
        } else if (started) setDrag((d) => d && { ...d, x: ev.clientX - ox, y: ev.clientY - oy });
      };
      const up = (ev) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        clearTimeout(lp);
        if (started) drop(ev.clientX - ox, ev.clientY - oy, ev);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
  };
  const dragRef = useRef(null);
  dragRef.current = drag;

  function menu(path) {
    ctx.menu([
      { ic: '📋', label: 'Duplicate', fn: () => { const b = clone(getAt(model, path)); if (BLOCKS[b.t].kind !== 'c') b.n = null; const r = ws.current.getBoundingClientRect(); model.stacks.push({ x: 40 + ws.current.scrollLeft, y: 40 + ws.current.scrollTop, b }); changed(); } },
      { ic: '🗑️', label: 'Delete it and what is under it', danger: true, fn: () => { detach(model, path); changed(); } },
    ], tr('Block'));
  }

  function paletteDrag(e, t) {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const b = fresh(t);
    setDrag({ b, x: e.clientX - ox, y: e.clientY - oy, ox, oy });
    const move = (ev) => setDrag((d) => d && { ...d, x: ev.clientX - ox, y: ev.clientY - oy });
    const up = (ev) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); drop(ev.clientX - ox, ev.clientY - oy, ev, true); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function drop(x, y, ev, fromPalette = false) {
    const d = dragRef.current;
    setDrag(null);
    if (!d) return;
    const b = d.b;
    const tr_ = trash.current && trash.current.getBoundingClientRect();
    if (tr_ && ev.clientX >= tr_.left && ev.clientX <= tr_.right && ev.clientY >= tr_.top && ev.clientY <= tr_.bottom) return changed();
    const wr = ws.current.getBoundingClientRect();
    if (ev.clientY > wr.bottom || ev.clientY < wr.top) { if (fromPalette) return changed(); }
    // snap targets: under a block, into a mouth, or above a loose stack
    const isHat = BLOCKS[b.t].kind === 'hat';
    let best = null, bd = 44;
    if (!isHat) {
      for (const el of ws.current.querySelectorAll('.dblock')) {
        const p = JSON.parse(el.dataset.path), blk = getAt(model, p), k = BLOCKS[blk.t].kind;
        const r = el.getBoundingClientRect();
        const head = el.querySelector('.bhead').getBoundingClientRect();
        if (k !== 'cap') { const dd = Math.hypot(x - r.left, y - r.bottom); if (dd < bd) { bd = dd; best = ['next', p]; } }
        if (k === 'c') { const m = el.querySelector('.bmouth').getBoundingClientRect(); const dd = Math.hypot(x - m.left, y - head.bottom); if (dd < bd) { bd = dd; best = ['slot', p]; } }
        if (p.length === 2 && k !== 'hat' && BLOCKS[tail(b).t].kind !== 'cap') {
          const dd = Math.hypot(x - r.left, (y + 40) - r.top); if (dd < bd) { bd = dd; best = ['above', p]; }
        }
      }
    }
    if (best) {
      const [kind, p] = best;
      const tgt = getAt(model, p);
      if (kind === 'next') { const old = tgt.n; tgt.n = b; if (old) { const tl = tail(b); if (BLOCKS[tl.t].kind === 'cap') model.stacks.push({ x: 20, y: 20, b: old }); else tl.n = old; } }
      else if (kind === 'slot') { const old = tgt.s[0]; tgt.s[0] = b; if (old) tail(b).n = old; }
      else { const st = model.stacks[p[1]]; tail(b).n = st.b; st.b = b; st.y = Math.max(0, st.y - 46); }
    } else {
      model.stacks.push({ x: Math.max(0, Math.round(x - wr.left + ws.current.scrollLeft)), y: Math.max(0, Math.round(y - wr.top + ws.current.scrollTop)), b });
    }
    changed();
  }

  const pal = Object.entries(BLOCKS).filter(([, d]) => d.cat === cat);
  return html`<div class="blocksed">
    <div class="bws" ref=${ws}>
      <div class="bcanvas">${model.stacks.map((st, i) => html`<div class="bstack" style=${{ left: st.x + 'px', top: st.y + 'px' }} key=${i}>
        <${Block} b=${st.b} path=${['stack', i]} ed=${ed} /></div>`)}
        ${!model.stacks.length ? html`<div class="bhint">${tr('Drag blocks up here from the drawer. Start with a gold event block!')}</div>` : null}</div>
      <div class="btrash" ref=${trash}>🗑</div>
    </div>
    <div class="bcats">${Object.entries(CATS).map(([k, [c, l]]) => html`<button style=${{ background: c, opacity: cat === k ? 1 : 0.65 }} onClick=${() => setCat(k)}>${tr(l)}</button>`)}</div>
    <div class="bpal">${pal.map(([t, d]) => html`<div class=${'dblock ' + d.kind + ' pal'} style=${{ '--bc': CATS[d.cat][0] }} onPointerDown=${(e) => paletteDrag(e, t)}>
      <div class="bhead">${d.text.split(/(\{\w+\})/).map((bit) => (/^\{\w+\}$/.test(bit) ? html`<span class="bfield ghost">…</span>` : bit.trim() ? html`<span>${bit.trim()}</span>` : null))}</div>
      ${d.kind === 'c' ? html`<div class="bmouth"><div class="bempty"></div></div><div class="bfoot"></div>` : null}</div>`)}</div>
    ${drag ? html`<div class="bdrag" style=${{ left: drag.x + 'px', top: drag.y + 'px' }}><${Block} b=${drag.b} path=${['drag']} ed=${{ startDrag() {}, changed() {} }} /></div>` : null}
  </div>`;
}
