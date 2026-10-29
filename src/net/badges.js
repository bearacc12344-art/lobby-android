// Admins & badges - same rules as badges.py (only events signed by the owner, or admins the owner named, count)
export const ADMIN_USERNAME = 'sandndnid';
export const ADMIN_CODE = '6f2e';
export const ADMIN_PUBKEY = '';
export const D_BADGES = 'lobby-badges';
export const HEX64 = /^[0-9a-f]{64}$/;
export const MAX_CUSTOM = 40;
const MAX_GRANTS = 600;

export const TIERS = {
  legendary: ['#ffb300', '#2b1d00'],
  epic: ['#b455ff', '#ffffff'],
  rare: ['#3d8bff', '#ffffff'],
  common: ['#3fbf72', '#ffffff'],
};

export const BUILTIN = {
  owner: { name: 'Owner', emoji: '👑', tier: 'legendary', desc: 'Runs Lobby', auto: true },
  admin: { name: 'Admin', emoji: '🛡️', tier: 'epic', desc: 'Can give out badges', auto: true },
  first: { name: 'First to join', emoji: '🥇', tier: 'legendary', desc: 'The very first person in Lobby' },
  early: { name: 'Early bird', emoji: '🌅', tier: 'epic', desc: 'Joined when Lobby was brand new' },
  og: { name: 'OG', emoji: '🔥', tier: 'epic', desc: 'Been here since the start' },
  legend: { name: 'Legend', emoji: '🏆', tier: 'legendary', desc: 'A true Lobby legend' },
  vip: { name: 'VIP', emoji: '💎', tier: 'epic', desc: 'Very important person' },
  helper: { name: 'Helper', emoji: '🤝', tier: 'rare', desc: 'Always helps others out' },
  bug: { name: 'Bug hunter', emoji: '🐛', tier: 'rare', desc: 'Found a bug and told us' },
  builder: { name: 'Builder', emoji: '🛠️', tier: 'rare', desc: 'Helped build Lobby' },
  party: { name: 'Life of the party', emoji: '🎉', tier: 'common', desc: 'Makes every call fun' },
  owl: { name: 'Night owl', emoji: '🦉', tier: 'common', desc: 'Always awake in the late calls' },
  star: { name: 'Rising star', emoji: '⭐', tier: 'common', desc: 'Going places' },
  brain: { name: 'Brain trainer', emoji: '🧠', tier: 'rare', desc: 'Taught the Lobby Brain a lot' },
};
export const GRANTABLE = Object.keys(BUILTIN).filter((k) => !BUILTIN[k].auto);

const clean = (s, n) => String(s ?? '').replace(/[\x00-\x1f]/g, '').trim().slice(0, n);
export const cleanColor = (c, d = '#3d8bff') => (/^#[0-9a-fA-F]{6}$/.test(String(c || '')) ? c : d);

export function cleanBody(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { admins: [], grants: {}, custom: {} };
  const admins = (Array.isArray(b.admins) ? b.admins : []).filter((a) => typeof a === 'string' && HEX64.test(a)).slice(0, 100);
  const custom = {};
  for (const [k, v] of Object.entries(b.custom && typeof b.custom === 'object' ? b.custom : {}).slice(0, MAX_CUSTOM)) {
    if (/^c_[a-z0-9]{4,12}$/.test(String(k)) && v && typeof v === 'object') {
      custom[k] = { name: clean(v.name, 24) || 'Badge', emoji: clean(v.emoji, 8) || '🏅', color: cleanColor(v.color), desc: clean(v.desc, 80) };
    }
  }
  const grants = {};
  let total = 0;
  for (const [pub, ids0] of Object.entries(b.grants && typeof b.grants === 'object' ? b.grants : {})) {
    if (!(typeof pub === 'string' && HEX64.test(pub) && Array.isArray(ids0))) continue;
    const ids = [...new Set(ids0)].filter((i) => typeof i === 'string' && (GRANTABLE.includes(i) || i in custom)).slice(0, 20);
    if (ids.length && total < MAX_GRANTS) { grants[pub] = ids; total += ids.length; }
  }
  return { admins, grants, custom };
}

export function trustedAdmins(root, events) {
  if (!root) return new Set();
  const s = new Set([root]);
  for (const a of events[root]?.admins || []) s.add(a);
  return s;
}

export function catalog(admins, events) {
  const cat = {};
  for (const [k, v] of Object.entries(BUILTIN)) cat[k] = { ...v, id: k };
  for (const a of admins) {
    for (const [k, v] of Object.entries(events[a]?.custom || {})) {
      cat[k] = { id: k, name: v.name, emoji: v.emoji, desc: v.desc, tier: 'custom', color: v.color, custom: true };
    }
  }
  return cat;
}

export function badgeView(b) {
  let [glow, fg] = TIERS[b.tier] || [b.color || '#3d8bff', '#ffffff'];
  if (b.tier === 'custom') { glow = b.color || '#3d8bff'; fg = '#ffffff'; }
  return { id: b.id, name: b.name, emoji: b.emoji, desc: b.desc || '', tier: b.tier || 'common', color: glow, fg };
}

const ORDER = ['owner', 'admin', 'first', 'legend', 'og', 'early', 'vip'];

export function badgesOf(pub, root, admins, events) {
  const cat = catalog(admins, events);
  const ids = [];
  if (root && pub === root) ids.push('owner');
  else if (admins.has(pub)) ids.push('admin');
  for (const a of [...admins].sort()) {
    for (const i of events[a]?.grants?.[pub] || []) if (i in cat && !ids.includes(i)) ids.push(i);
  }
  const rank = (i) => { const n = ORDER.indexOf(i); return n < 0 ? 99 : n; };
  ids.sort((x, y) => rank(x) - rank(y) || (x < y ? -1 : x > y ? 1 : 0));
  return ids.map((i) => badgeView(cat[i]));
}
