import { h } from 'preact';
import htm from 'htm';
import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import { ctx } from '../ctx.js';
import { swapEmoji } from '../util/icons.js';

// every emoji written in the app's own templates becomes one of Smult's drawn icons. People's text never goes through
// here (messages are rendered as HTML, and widgets that show typed text carry data-raw).
function hx(type, props, ...children) {
  if (!(props && props['data-raw']) && type !== 'textarea' && type !== 'option') {
    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      if (typeof c === 'string') children[i] = swapEmoji(c);
      else if (Array.isArray(c)) children[i] = c.map((x) => (typeof x === 'string' ? swapEmoji(x) : x));
    }
  }
  return h(type, props, ...children);
}
export const html = htm.bind(hx);
export { useEffect, useRef, useState };

// re-render when any of the given bus events fire (optionally filtered)
export function useBus(events, filter = null) {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    const offs = events.map((ev) => ctx.bus.on(ev, (...a) => { if (!filter || filter(ev, ...a)) force(); }));
    return () => offs.forEach((o) => o());
  }, []);
}
export function useForce() { const [, f] = useReducer((x) => x + 1, 0); return f; }
