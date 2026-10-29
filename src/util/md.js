// Same tiny markdown as PC Lobby: **b** *i* __u__ ~~s~~ `code` ```block``` ||spoiler|| > quote, links, @mentions, :shortcodes:
import { S } from './settings.js';

export const SHORTCODES = { ':)': '🙂', ':D': '😄', ';)': '😉', ':(': '🙁', ':P': '😛', '<3': '❤️', ':o': '😮', xD: '😆',
  ':skull:': '💀', ':fire:': '🔥', ':heart:': '❤️', ':thumbsup:': '👍', ':thumbsdown:': '👎', ':eyes:': '👀', ':joy:': '😂', ':sob:': '😭',
  ':clown:': '🤡', ':100:': '💯', ':pray:': '🙏', ':ok:': '👌', ':wave:': '👋', ':door:': '🚪', ':key:': '🔑', ':ghost:': '👻', ':eye:': '👁️',
  ':candle:': '🕯️', ':moai:': '🗿', ':sparkles:': '✨', ':party:': '🥳', ':think:': '🤔', ':cry:': '😢', ':angry:': '😠', ':cool:': '😎',
  ':nerd:': '🤓', ':shrug:': '🤷', ':star:': '⭐', ':check:': '✅', ':x:': '❌', ':warning:': '⚠️', ':gift:': '🎁', ':music:': '🎵',
  ':game:': '🎮', ':pizza:': '🍕', ':coffee:': '☕', ':sleep:': '😴', ':flushed:': '😳', ':pleading:': '🥺', ':salute:': '🫡', ':melt:': '🫠',
  ':rofl:': '🤣', ':hug:': '🤗' };
export const SLASH = { '/shrug': '¯\\_(ツ)_/¯', '/tableflip': '(╯°□°)╯︵ ┻━┻', '/unflip': '┬─┬ノ( º _ ºノ)', '/lenny': '( ͡° ͜ʖ ͡°)',
  '/disapprove': 'ಠ_ಠ', '/sparkle': '✧･ﾟ: *✧･ﾟ:*' };

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let scRe = null;
export function applyShortcodes(text) {
  if (!S.get('shortcodes')) return text;
  if (!scRe) {
    const keys = Object.keys(SHORTCODES).sort((a, b) => b.length - a.length);
    scRe = new RegExp(keys.map((k) => (k.startsWith(':') && k.endsWith(':') ? reEsc(k) : `(?<!\\S)${reEsc(k)}(?!\\S)`)).join('|'), 'g');
  }
  return text.replace(scRe, (m) => SHORTCODES[m] || m);
}

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;

export function mdHtml(text, myUsername = '', spoilersOpen = false) {
  const stash = [];
  const keep = (s) => { stash.push(s); return `\x00${stash.length - 1}\x00`; };
  let t = String(text || '');
  t = t.replace(/```(?:\w+\n)?([\s\S]*?)```/g, (_, c) => keep(`<pre class="md-pre">${esc(c.replace(/^\n+|\n+$/g, ''))}</pre>`));
  t = t.replace(/`([^`\n]+)`/g, (_, c) => keep(`<code class="md-code">${esc(c)}</code>`));
  t = t.replace(URL_RE, (u) => keep(`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`));
  t = esc(t);
  if (S.get('markdown')) {
    t = t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    t = t.replace(/__(.+?)__/g, '<u>$1</u>');
    t = t.replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, '<i>$1</i>');
    t = t.replace(/~~(.+?)~~/g, '<s>$1</s>');
    t = t.replace(/\|\|(.+?)\|\|/g, (_, c) => (spoilersOpen ? `<span class="spoiler open">${c}</span>` : `<span class="spoiler">${c}</span>`));
    t = t.replace(/^&gt; (.*)$/gm, '<span class="md-quote">▎ $1</span>');
  }
  t = t.replace(/(?<![\w/])@([A-Za-z0-9_.]{2,20})/g, (_, name) => {
    const mine = name.toLowerCase() === (myUsername || '').toLowerCase() || name.toLowerCase() === 'everyone';
    return `<span class="mention${mine ? ' me' : ''}">@${name}</span>`;
  });
  t = t.replace(/\n/g, '<br>');
  return t.replace(/\x00(\d+)\x00/g, (_, i) => stash[+i]);
}

const EMOJI_ONLY = /^(?:[\u{1F000}-\u{1FAFF}☀-➿⬀-⯿️‍⃣\u{E0000}-\u{E007F}\s]){1,24}$/u;
export function isEmojiOnly(text) {
  const t = String(text || '').trim();
  return !!t && [...t].length <= 24 && EMOJI_ONLY.test(t) && !/^[\x00-\x7f]*$/.test(t);
}
