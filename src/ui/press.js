// long-press (touch) + right-click helper: <div ...${longPress(fn)}>
export function longPress(fn, onTap) {
  let t = null, moved = false, fired = false, sx = 0, sy = 0;
  return {
    onPointerDown: (e) => {
      moved = false; fired = false; sx = e.clientX; sy = e.clientY;
      clearTimeout(t);
      t = setTimeout(() => { fired = true; if (navigator.vibrate) navigator.vibrate(15); fn(e); }, 460);
    },
    onPointerMove: (e) => { if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) { moved = true; clearTimeout(t); } },
    onPointerUp: () => { clearTimeout(t); },
    onPointerCancel: () => { clearTimeout(t); },
    onContextMenu: (e) => { e.preventDefault(); clearTimeout(t); if (!fired) { fired = true; fn(e); } },
    onClick: (e) => { if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; return; } if (!moved && onTap) onTap(e); },
  };
}
