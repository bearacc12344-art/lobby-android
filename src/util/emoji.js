export const EMOJI = {
  Smileys: '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 🫠 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🫢 🤫 🤔 🫡 🤐 🤨 😐 😑 😶 🫥 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 😵‍💫 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 🫤 😟 🙁 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👹 👺 👻 👽 👾 🤖',
  Hands: '👋 🤚 🖐️ ✋ 🖖 🫱 🫲 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 🖕 👇 ☝️ 🫵 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💅 💪 🦾 👀 👁️ 🫦 🧠',
  Hearts: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❤️‍🔥 ❤️‍🩹 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 💢 💥 💫 💦 💨 🕳️ 💬 💭 💤',
  Hotel: '🚪 🔑 🗝️ 🕯️ 💡 🔦 🏨 🛏️ 🪑 🖼️ 📚 📖 🧱 ⛓️ 🔒 🔓 👁️ 🫥 🌑 🌒 🌫️ 🕸️ 🕷️ 🦇 🩸 ⚡ 🔥 🧪 💊 🩹 ⏰ ⌛ 🎒 💰 🪙 💎 🧭 📻 🎵',
  Animals: '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐢 🐍 🦖 🐙 🦑 🦀 🐡 🐠 🐬 🐳 🦈 🐊',
  Food: '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🌽 🌶️ 🥕 🥔 🍞 🧀 🥚 🍳 🥓 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🍝 🍜 🍣 🍱 🍩 🍪 🎂 🍰 🍫 🍬 🍭 🍿 ☕ 🧋 🥤 🧃',
  Fun: '⚽ 🏀 🏈 ⚾ 🎾 🏐 🎱 🏓 🎮 🕹️ 🎲 🧩 ♟️ 🎯 🎳 🎤 🎧 🎸 🎹 🥁 🎺 🎻 🎬 🎨 🏆 🥇 🎉 🎊 🎈 🎁 🎀 🪅 🪩 🛹 🚗 🚀 ✈️ 🛸 🏠 🌍 🌙 ⭐ 🌈 ☀️ ⛈️ ❄️',
  Symbols: '✅ ❌ ⭕ ❗ ❓ ‼️ ⁉️ ⚠️ 🚫 🔞 ♻️ ✨ 🌟 💠 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟥 🟧 🟨 🟩 🟦 🟪 ⬛ ⬜ ➡️ ⬅️ ⬆️ ⬇️ 🔁 🔀 ▶️ ⏸️ ⏹️ 🔔 🔕 🔊 🔇 📌 📎 🔗 💲 ™️ ©️',
};
for (const k of Object.keys(EMOJI)) EMOJI[k] = EMOJI[k].split(' ');
export const EMOJI_NAMES = { '💀': 'skull', '🔥': 'fire', '🚪': 'door', '😂': 'joy laugh', '😭': 'sob cry', '👍': 'thumbsup like', '❤️': 'heart love',
  '👀': 'eyes', '🗿': 'moai', '🤡': 'clown', '😎': 'cool', '🤔': 'think', '🥺': 'pleading', '🫡': 'salute', '🎉': 'party', '✨': 'sparkles',
  '👻': 'ghost', '🔑': 'key', '🕯️': 'candle', '👁️': 'eye', '🍕': 'pizza', '🎮': 'game', '😴': 'sleep', '🥳': 'party', '💯': '100', '🙏': 'pray',
  '👋': 'wave hi', '😢': 'cry sad', '😡': 'angry', '😳': 'flushed', '🤣': 'rofl', '🫠': 'melt', '🤗': 'hug', '⭐': 'star', '✅': 'check yes', '❌': 'x no' };
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '💀', '🔥', '👀'];
export const CALL_REACTIONS = ['👍', '😂', '❤️', '🔥', '💀', '😮', '👏', '🎉', '😭', '👀', '🤡', '🗿'];
export const AVATAR_CHOICES = '🚪 👁️ 👻 💀 🕯️ 🔑 🦇 🕷️ 🤖 👾 😎 🤠 🥸 🐸 🐱 🐶 🦊 🐼 🐧 🦉 🐙 🦖 🍕 🍩 🎮 🎧 ⚡ 🔥 🌙 ⭐ 🌈 ❄️'.split(' ');
export const COLOR_CHOICES = ['#e0a94a', '#d0473a', '#c46bd9', '#6a8cff', '#3fb6c9', '#5ec26a', '#e6d34a', '#ef7f3a', '#ff6fae', '#8c6b52', '#9aa3ad', '#f2e4cc'];
