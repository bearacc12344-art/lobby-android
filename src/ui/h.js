import { h } from 'preact';
import htm from 'htm';
import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import { ctx } from '../ctx.js';

export const html = htm.bind(h);
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
