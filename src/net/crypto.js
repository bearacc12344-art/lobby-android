// Same crypto as PC Lobby (p2p.py): scrypt key from username+password, BIP340 Schnorr (Nostr) signatures,
// ECDH -> AES-256-GCM end-to-end encryption.
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';

export const te = new TextEncoder();
export const td = new TextDecoder();

export function hex(b) {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}
export function unhex(s) {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}
export function b64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
export function unb64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function concat(...arrs) {
  const n = arrs.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
export function randBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }
export function sha256hex(data) { return hex(sha256(typeof data === 'string' ? te.encode(data) : data)); }
export { sha256 };

const N = secp256k1.Point.CURVE().n;
function validSecret(s) {
  let x = 0n;
  for (const b of s) x = (x << 8n) | BigInt(b);
  return x > 0n && x < N;
}

export async function deriveSecret(username, password, onProgress) {
  const salt = te.encode('lobby-v1:' + username.toLowerCase());
  let s = await scryptAsync(te.encode(password), salt, { N: 2 ** 16, r: 8, p: 1, dkLen: 32, onProgress, asyncTick: 25 });
  while (!validSecret(s)) s = sha256(s);
  return s;
}

const aesCache = new Map();
async function aesKey(raw) {
  const k = hex(raw);
  let key = aesCache.get(k);
  if (!key) {
    key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    if (aesCache.size > 500) aesCache.clear();
    aesCache.set(k, key);
  }
  return key;
}

// one big-file part: nonce + AES-GCM(data) with the part number as additional data (same as PC upload_parts)
export async function encPart(keyRaw, data, i) {
  const key = await crypto.subtle.importKey('raw', keyRaw, 'AES-GCM', false, ['encrypt']);
  const n = randBytes(12);
  const ad = new Uint8Array([i >>> 24, (i >>> 16) & 255, (i >>> 8) & 255, i & 255]);
  return concat(n, new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: n, additionalData: ad }, key, data)));
}
export async function decPart(keyRaw, blob, i) {
  const key = await crypto.subtle.importKey('raw', keyRaw, 'AES-GCM', false, ['decrypt']);
  const ad = new Uint8Array([i >>> 24, (i >>> 16) & 255, (i >>> 8) & 255, i & 255]);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.subarray(0, 12), additionalData: ad }, key, blob.subarray(12)));
}
export async function encBytes(keyRaw, data) {
  const n = randBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: n }, await aesKey(keyRaw), data));
  return concat(n, ct);
}
export async function decBytes(keyRaw, blob) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.subarray(0, 12) }, await aesKey(keyRaw), blob.subarray(12));
  return new Uint8Array(pt);
}
export async function enc(keyRaw, obj) { return b64(await encBytes(keyRaw, te.encode(JSON.stringify(obj)))); }
export async function dec(keyRaw, s) { return JSON.parse(td.decode(await decBytes(keyRaw, unb64(s)))); }

export function serialize(ev) {
  return JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]);
}

export class Keys {
  constructor(secret) {
    this.secret = secret;
    this.pubBytes = schnorr.getPublicKey(secret);
    this.pub = hex(this.pubBytes);
    this._shared = new Map();
    this.selfKey = sha256(concat(te.encode('lobby-self'), secret));
  }
  shared(pub) {
    let k = this._shared.get(pub);
    if (!k) {
      const pt = secp256k1.getSharedSecret(this.secret, unhex('02' + pub));
      k = sha256(concat(te.encode('lobby-ecdh'), pt.subarray(1, 33)));
      this._shared.set(pub, k);
    }
    return k;
  }
  sign(kind, tags, content, created) {
    const ev = { pubkey: this.pub, created_at: Math.floor(created || Date.now() / 1000), kind, tags, content };
    const id = sha256(te.encode(serialize(ev)));
    ev.id = hex(id);
    ev.sig = hex(schnorr.sign(id, this.secret, randBytes(32)));
    return ev;
  }
}

export function verifyEvent(ev) {
  try {
    const id = sha256(te.encode(serialize(ev)));
    if (hex(id) !== ev.id) return false;
    return schnorr.verify(unhex(ev.sig), id, unhex(ev.pubkey));
  } catch (e) {
    return false;
  }
}
