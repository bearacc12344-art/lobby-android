// Tiny IndexedDB helper: key/value stores for the database file and the (big) community-brain data
const STORES = ['kv', 'brain_ex', 'brain_ckpt', 'lang_txt', 'lang_ckpt', 'files'];
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open('lobby', 2);
    r.onupgradeneeded = () => {
      for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}
const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const idb = {
  get: (store, key) => tx(store, 'readonly', (s) => req2p(s.get(key))),
  put: (store, key, val) => tx(store, 'readwrite', (s) => { s.put(val, key); }),
  del: (store, key) => tx(store, 'readwrite', (s) => { s.delete(key); }),
  has: (store, key) => tx(store, 'readonly', (s) => req2p(s.getKey(key)).then((k) => k !== undefined)),
  all: (store) => tx(store, 'readonly', (s) => req2p(s.getAll())),
  keys: (store) => tx(store, 'readonly', (s) => req2p(s.getAllKeys())),
  putMany: (store, items) => tx(store, 'readwrite', (s) => { for (const [k, v] of items) s.put(v, k); }),
  clear: (store) => tx(store, 'readwrite', (s) => { s.clear(); }),
};
