// tiny promise wrapper around a Web Worker
export function rpc(worker) {
  let n = 0;
  const wait = new Map();
  worker.onmessage = (e) => {
    const { id, ok, res, err } = e.data;
    const w = wait.get(id);
    if (!w) return;
    wait.delete(id);
    ok ? w[0](res) : w[1](new Error(err));
  };
  return (op, d, transfer) => new Promise((res, rej) => {
    const id = ++n;
    wait.set(id, [res, rej]);
    worker.postMessage({ id, op, d }, transfer || []);
  });
}

// should background training run right now? (setting on, not in a call, app visible, charging if asked)
let charging = true;
try {
  navigator.getBattery && navigator.getBattery().then((b) => {
    charging = b.charging;
    b.addEventListener('chargingchange', () => { charging = b.charging; });
  });
} catch (e) { /* no battery api */ }
export function mayTrain(ctx, S) {
  if (!S.get('brain_train')) return false;
  if (ctx.call || document.hidden) return false;
  if (S.get('brain_train_charging_only') && !charging) return false;
  return true;
}
