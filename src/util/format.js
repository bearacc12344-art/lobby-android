import { S } from './settings.js';
import { tr } from './i18n.js';

const pad = (n) => String(n).padStart(2, '0');
export function fmtTime(ts) {
  const d = new Date(ts * 1000);
  let h = d.getHours();
  const m = pad(d.getMinutes()), s = S.get('show_seconds') ? ':' + pad(d.getSeconds()) : '';
  if (S.get('time_24h')) return `${pad(h)}:${m}${s}`;
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m}${s} ${ap}`;
}
export function dayLabel(ts) {
  const d = new Date(ts * 1000), n = new Date();
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, n)) return tr('Today');
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (same(d, y)) return tr('Yesterday');
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric' });
}
export function fmtShort(ts) {
  const d = new Date(ts * 1000), n = new Date();
  if (d.toDateString() === n.toDateString()) return fmtTime(ts);
  if (n - d < 6 * 86400000) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
export function fmtAgo(ts) {
  if (!ts) return tr('a long time ago');
  const s = Date.now() / 1000 - ts;
  if (s < 60) return tr('just now');
  if (s < 3600) return tr(`${Math.floor(s / 60)} min ago`);
  if (s < 86400) return tr(`${Math.floor(s / 3600)} h ago`);
  return dayLabel(ts);
}
export function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
export function fmtDur(s) {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`;
}
export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : [...parts[0]].slice(0, 2).join('')).toUpperCase();
}
export const PRESENCE_LABEL = { online: 'Online', idle: 'Idle', dnd: 'Do not disturb', invisible: 'Invisible', offline: 'Offline' };
export const PRESENCE_COLOR = { online: '#3fbf72', idle: '#e6b34a', dnd: '#d0473a', invisible: '#8a8a8a', offline: '#5a5a5a' };
