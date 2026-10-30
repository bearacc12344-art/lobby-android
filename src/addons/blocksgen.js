// blocks -> Lua, same as PC Smult's blocks.generate() (so a blocks project makes the same add-on on both)
import { BLOCKS } from './blocksdef.js';

const q = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';

export function textExpr(s, scope) {
  const toks = { text: scope.includes('msg') ? 'msg.Text' : '""', sender: scope.includes('msg') ? 'msg.Sender.Name' : '""',
    chat: scope.includes('chat') ? 'chat.Name' : '""', args: scope.includes('args') ? 'args' : '""',
    me: 'Smult.LocalUser.Name', time: 'os.date("%H:%M")', random: 'math.random(100)' };
  const parts = [];
  let pos = 0;
  const rx = /\$(text|sender|chat|args|me|time|random)\b|\{([A-Za-z_]\w{0,30})\}/g;
  let m;
  s = String(s);
  while ((m = rx.exec(s))) {
    if (m.index > pos) parts.push(q(s.slice(pos, m.index)));
    parts.push(m[1] ? 'tostring(' + toks[m[1]] + ')' : 'tostring(vars["' + m[2] + '"] or "")');
    pos = m.index + m[0].length;
  }
  if (pos < s.length) parts.push(q(s.slice(pos)));
  return parts.length ? parts.join(' .. ') : '""';
}

export function numExpr(s, scope) {
  s = String(s).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  const m = /^\{([A-Za-z_]\w{0,30})\}$/.exec(s);
  if (m) return '(tonumber(vars["' + m[1] + '"]) or 0)';
  return '(tonumber(' + textExpr(s, scope) + ') or 0)';
}

const rawName = (s) => String(s).replace(/[^\w#. -]/g, '').trim().slice(0, 40) || 'x';
const ind = (code, n = 1) => code.split('\n').map((l) => (l.trim() ? '    '.repeat(n) + l : l)).join('\n');

export function generate(stacks, title = 'My add-on') {
  const perms = new Set(), used = new Set();
  const top = [], start = [];
  function gen(b, scope) {
    const out = [];
    while (b) {
      const d = BLOCKS[b.t];
      if (!d) { b = b.n; continue; }
      (d.perms || []).forEach((p) => perms.add(p));
      used.add(d.cat); used.add(b.t);
      const f = b.f || {}, sc = [...scope, ...(d.scope || [])], vals = {};
      for (const [name, spec] of Object.entries(d.fields || {})) {
        const v = name in f ? f[name] : spec[1];
        if (spec[0] === 'text') vals[name] = textExpr(v, sc);
        else if (spec[0] === 'num') vals[name] = numExpr(v, sc);
        else if (spec[0] === 'choice') vals[name] = q(v);
        else { vals[name] = rawName(v); vals[name + '_q'] = q(rawName(v)); }
      }
      const slots = b.s || [];
      const body = slots.length ? gen(slots[0], sc) : '';
      vals.body = body ? ind(body) : '    -- (put blocks here)';
      vals.body2 = body ? ind(body, 2) : '        -- (put blocks here)';
      let code = d.lua;
      for (const [k, v] of Object.entries(vals)) code = code.split('{' + k + '}').join(v);
      out.push(code);
      if (d.kind === 'cap') break;
      b = b.n;
    }
    return out.join('\n');
  }
  function genHat(b) {
    const d = BLOCKS[b.t];
    let code = gen(b, []);
    const scope = d.scope || [];
    if (scope.includes('msg')) code = code.replace('function(msg)\n', 'function(msg)\n    current_msg = msg\n');
    if (scope.includes('chat') && b.t === 'command') code = code.replace('function(args, chat)\n', 'function(args, chat)\n    current_msg, current_chat = nil, chat\n');
    else if (scope.includes('chat')) code = code.replace('function(chat)\n', 'function(chat)\n    current_chat = chat\n');
    else if (code.includes('sendHere(')) code = code.replace('function()\n', 'function()\n    current_msg, current_chat = nil, nil\n');
    return code;
  }
  for (const st of [...stacks].sort((a, b) => (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0))) {
    const b = st.b, d = BLOCKS[(b || {}).t];
    if (!d || d.kind !== 'hat') continue;
    if (d.start) { const body = gen(b.n, []); if (body) start.push(body); }
    else top.push(genHat({ ...b, s: [b.n], n: null }));
  }
  const head = ['-- Made with blocks in the Coding Cult (blocks.json).', '-- Changing the blocks rewrites this file, so edit the blocks, not this.', ''];
  const has = (x) => perms.has(x);
  const svc = [['Chat', 'ChatService', has('chat.read') || has('chat.send') || used.has('chat') || ['msg', 'msgsays', 'sent', 'opened'].some((x) => used.has(x))],
    ['Commands', 'CommandService', has('commands')], ['UI', 'UIService', has('ui')], ['Notify', 'NotificationService', has('notify')],
    ['Theme', 'ThemeService', has('theme')], ['Layout', 'LayoutService', has('layout')], ['Sound', 'SoundService', has('sound')]];
  for (const [v, name, on] of svc) if (on) head.push(`local ${v} = Smult:GetService("${name}")`);
  head.push('local Data = Smult:GetService("DataStoreService")',
    'local vars = Data:Get("vars", {})                       -- your variables (kept between restarts)',
    'local function save() Data:Set("vars", vars) end');
  if (has('ui')) head.push('local panel, label',
    `local function getPanel() if not panel then panel = UI:CreatePanel({ Title = ${q(title)}, Icon = "🧱" }) end return panel end`,
    'local function panelText() if not label then label = getPanel():AddLabel("") end return label end');
  if (has('chat.send')) head.push('local current_msg, current_chat', 'local function sendHere(text)',
    '    local id = (current_msg and current_msg.ChatId) or (current_chat and current_chat.Id) or Chat:GetCurrentChat()',
    '    if id then Chat:Send(id, text) end', 'end');
  let lua = head.join('\n') + '\n\n' + top.join('\n\n');
  lua += '\n\nfunction Plugin:OnLoad()\n' + (start.length ? ind(start.join('\n')) : '    -- (nothing on start)') + '\nend\n';
  return [lua, [...perms].sort()];
}
