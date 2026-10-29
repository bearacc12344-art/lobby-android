// Checks Nostr signatures off the main thread (thousands arrive at login; a phone shouldn't stutter)
import { verifyEvent } from './crypto.js';

self.onmessage = (e) => {
  const { id, evs } = e.data;
  const ok = evs.map(verifyEvent);
  self.postMessage({ id, ok });
};
