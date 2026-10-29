import { html, useEffect, useRef, useState } from './h.js';
import { ctx } from '../ctx.js';
import { tr } from '../util/i18n.js';
import { search, downloadGif, myGifs, saveMyGif, removeMyGif, touchMyGif } from '../gifs.js';
import { pickFiles, readFile } from '../util/files.js';
import { longPress } from './press.js';

function MyGif({ g, onPick, onRemoved }) {
  const [url] = useState(() => URL.createObjectURL(new Blob([g.bytes], { type: 'image/gif' })));
  useEffect(() => () => URL.revokeObjectURL(url), []);
  return html`<img src=${url} ...${longPress(async () => { if (await ctx.confirm('🗑 Remove from My GIFs')) { await removeMyGif(g.key); onRemoved(); } }, () => onPick(g))} />`;
}

export function GifPicker({ s }) {
  const [tab, setTab] = useState('search');
  const [q, setQ] = useState('');
  const [items, setItems] = useState(null);
  const [status, setStatus] = useState('');
  const [src, setSrc] = useState('GIPHY');
  const [mine, setMine] = useState([]);
  const req = useRef(0);
  const deb = useRef(null);
  const run = (query) => {
    const id = ++req.current;
    setStatus(tr(query.trim() ? 'searching...' : 'trending...'));
    search(query).then(([list, source]) => {
      if (id !== req.current) return;
      setItems(list); setSrc(source); setStatus(list.length ? '' : tr('no GIFs found 🤷'));
    }, (e) => { if (id === req.current) { setItems([]); setStatus(tr(`can't reach the GIF sites — check your internet (${e.message || e})`)); } });
  };
  useEffect(() => { run(''); }, []);
  const loadMine = () => myGifs().then(setMine);
  useEffect(() => { if (tab === 'mine') loadMine(); }, [tab]);
  const send = (bytes, name = 'gif.gif') => { ctx.closeSheet(s); s.onPick(new File([bytes], name, { type: 'image/gif' })); };
  async function pickRemote(it) {
    setStatus(tr('getting the GIF...'));
    try { send(await downloadGif(it)); } catch (e) { setStatus(tr("⚠️ couldn't download that GIF")); }
  }
  return html`<div style=${{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <div class="row" style=${{ padding: '10px 10px 0' }}>
      <button class=${'chip' + (tab === 'search' ? ' on' : '')} onClick=${() => setTab('search')}>${tr('🔍 Search')}</button>
      <button class=${'chip' + (tab === 'mine' ? ' on' : '')} onClick=${() => setTab('mine')}>${tr('⭐ My GIFs')}</button>
      <span class="spacer"></span>
      ${tab === 'mine' ? html`<button class="btn small" onClick=${async () => { for (const f of await pickFiles({ accept: 'image/gif,image/webp' })) await saveMyGif(f.name, await readFile(f)); loadMine(); }}>${tr('➕ Add GIF files')}</button>` : null}
      <button class="iconbtn" onClick=${() => ctx.closeSheet(s)}>✖️</button></div>
    ${tab === 'search' ? html`<div style=${{ padding: '8px 10px 0' }}><input class="field" placeholder=${tr('Search GIFs...')} value=${q}
      onInput=${(e) => { setQ(e.target.value); clearTimeout(deb.current); const v = e.target.value; deb.current = setTimeout(() => run(v), 450); }} /></div>` : null}
    ${status ? html`<div class="small muted" style=${{ padding: '6px 12px' }}>${status}</div>` : null}
    <div style=${{ flex: 1, overflowY: 'auto' }}>
      ${tab === 'search' ? html`<div class="ggrid">${(items || []).map((it) => html`<img src=${it.preview} loading="lazy" onClick=${() => pickRemote(it)}
          onError=${(e) => { if (it.alt && e.target.src !== it.alt) e.target.src = it.alt; }} />`)}</div>`
        : html`${mine.length ? null : html`<div class="empty">${tr('No saved GIFs yet. Right-click any GIF in a chat → ⭐ Save to my GIFs, or add GIF files from your PC.')}</div>`}
          <div class="ggrid">${mine.map((g) => html`<${MyGif} key=${g.key} g=${g} onPick=${(x) => { touchMyGif(x); send(x.bytes, x.name); }} onRemoved=${loadMine} />`)}</div>`}
    </div>
    <div class="tiny muted" style=${{ padding: '6px 12px calc(6px + env(safe-area-inset-bottom))' }}>${tab === 'search' ? tr(`Powered by ${src}`) : tr('Right-click a GIF in chat → ⭐ Save to my GIFs')}</div>
  </div>`;
}
