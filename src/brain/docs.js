// Reading documents for the language brain: TXT/MD/CSV, DOCX (unzip + XML) and PDF (pdf.js), streamed page by page.
import pako from 'pako';

export const DOC_EXTS = ['pdf', 'docx', 'txt', 'md', 'markdown', 'text', 'csv', 'log'];
export const CHUNK = 6000;
export const MAX_DOC_CHARS = 3000000;

async function* iterTxt(file) {
  const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  let enc = 'utf-8';
  try { new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, Math.max(0, head.length - 4))); } catch (e) { enc = 'windows-1252'; }
  const dec = new TextDecoder(enc);
  for (let o = 0; o < file.size; o += 1 << 18) {
    const b = new Uint8Array(await file.slice(o, o + (1 << 18)).arrayBuffer());
    yield dec.decode(b, { stream: true });
  }
  yield dec.decode();
}

// minimal zip reader: find one entry via the central directory
async function unzipEntry(file, name) {
  const tailLen = Math.min(file.size, 65536 + 22);
  const tail = new Uint8Array(await file.slice(file.size - tailLen).arrayBuffer());
  const dv = new DataView(tail.buffer);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a valid .docx');
  const cdSize = dv.getUint32(eocd + 12, true), cdOff = dv.getUint32(eocd + 16, true);
  const cd = new Uint8Array(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const cv = new DataView(cd.buffer);
  for (let p = 0; p < cd.length;) {
    if (cv.getUint32(p, true) !== 0x02014b50) break;
    const method = cv.getUint16(p + 10, true), csize = cv.getUint32(p + 20, true);
    const nlen = cv.getUint16(p + 28, true), xlen = cv.getUint16(p + 30, true), clen = cv.getUint16(p + 32, true);
    const loc = cv.getUint32(p + 42, true);
    const n = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nlen));
    if (n === name) {
      const lh = new DataView(await file.slice(loc, loc + 30).arrayBuffer());
      const start = loc + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      const data = new Uint8Array(await file.slice(start, start + csize).arrayBuffer());
      return method === 0 ? data : pako.inflateRaw(data);
    }
    p += 46 + nlen + xlen + clen;
  }
  throw new Error('no text inside this .docx');
}
async function* iterDocx(file) {
  const xml = new TextDecoder().decode(await unzipEntry(file, 'word/document.xml'));
  const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:(?:br|cr)\/>|<\/w:p>/g;
  let parts = [], m, count = 0;
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) parts.push(decode(m[1]));
    else if (m[0] === '<w:tab/>') parts.push(' ');
    else if (m[0] === '</w:p>') { parts.push('\n'); if (++count % 50 === 0) { yield parts.join(''); parts = []; } } else parts.push('\n');
  }
  if (parts.length) yield parts.join('');
}
async function* iterPdf(file, state) {
  const pdfjs = await import('pdfjs-dist/build/pdf.min.mjs');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), password: '' }).promise;
  state.pages = doc.numPages;
  for (let i = 1; i <= doc.numPages; i++) {
    state.page = i;
    let txt = '';
    try {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      for (const it of tc.items) txt += it.str + (it.hasEOL ? '\n' : ' ');
      page.cleanup();
    } catch (e) { /* skip unreadable page */ }
    yield txt + '\n\n';
  }
  doc.destroy();
}
export function iterText(file, state) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return iterPdf(file, state);
  if (ext === 'docx') return iterDocx(file);
  return iterTxt(file);
}
