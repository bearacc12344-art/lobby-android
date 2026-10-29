// HTTP that works for every site: normal fetch first; if the site blocks browsers (CORS), the Android side does it.
import { isNative, LobbyNative } from '../native.js';
import { b64, unb64, te } from './crypto.js';

export async function nativeRequest(url, { method = 'GET', headers = {}, body = null, timeout = 60000 } = {}) {
  const r = await LobbyNative.http({ url, method, headers, body: body ? b64(body) : null, timeout });
  if (r.status < 200 || r.status >= 300) {
    const e = new Error('HTTP ' + r.status);
    e.status = r.status;
    throw e;
  }
  return { status: r.status, bytes: unb64(r.body || ''), headers: r.headers || {} };
}

export async function httpGet(url, { headers = {}, preferNative = false } = {}) {
  if (!(preferNative && isNative)) {
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      if (!isNative || e.status) throw e;
    }
  }
  return (await nativeRequest(url, { headers })).bytes;
}

export async function httpText(url, opts = {}) {
  return new TextDecoder().decode(await httpGet(url, opts));
}

export async function httpPost(url, fields, file) {
  const bnd = '----lobby' + Math.random().toString(16).slice(2, 12);
  const parts = [];
  for (const [k, v] of Object.entries(fields || {})) parts.push(te.encode(`--${bnd}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  if (file) {
    parts.push(te.encode(`--${bnd}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
    parts.push(file.data);
    parts.push(te.encode('\r\n'));
  }
  parts.push(te.encode(`--${bnd}--\r\n`));
  const len = parts.reduce((a, p) => a + p.length, 0);
  const body = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { body.set(p, o); o += p.length; }
  const headers = { 'Content-Type': `multipart/form-data; boundary=${bnd}` };
  if (isNative) return new TextDecoder().decode((await nativeRequest(url, { method: 'POST', headers, body, timeout: 120000 })).bytes);
  const r = await fetch(url, { method: 'POST', headers, body });
  return r.text();
}
