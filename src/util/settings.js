// Settings (same keys as PC Lobby where they make sense), saved on the phone.
export const DEFAULTS = {
  username: '', token: '', remember: true,
  relays: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://offchain.pub', 'wss://nostr.mom', 'wss://relay.nostr.net'],
  turn_url: '', turn_user: '', turn_pass: '',
  language: 'auto', season: 'auto',
  theme: 'Hotel', accent: '', drawn_icons: true, font: 'comic', font_size: 15, message_style: 'bubbles', compact: false,
  time_24h: true, show_seconds: false, show_avatars: true, big_emoji: true, animations: true, show_presence_dots: true,
  notify_desktop: true, notify_sounds: true, notify_preview: true, dnd_trusted_bypass: true,
  quiet_hours: false, quiet_from: '23:00', quiet_to: '08:00', nudges: true, vibrate: true,
  sound_message: true, sound_mention: true, sound_join_leave: true, sound_friend: true, ui_volume: 70,
  notify_only_mentions_groups: false, keep_alive: true,
  enter_to_send: false, auto_download_images: true, markdown: true, shortcodes: true,
  quick_replies: ['omw', 'brb 5 min', "can't talk rn, text me", 'gg', 'lmaooo', 'on it 👍'],
  drafts: {}, recent_emoji: [], load_count: 60, confirm_delete: true, show_edits: true,
  mic_gain: 100, out_volume: 100, gate_db: -50, voice_quality: 24000, highpass: true, join_muted: false,
  auto_answer_trusted: false, user_volumes: {}, ring_volume: 70, speaker: true, echo_cancel: true,
  cam_res: 360, cam_fps: 12, cam_quality: 70, mirror: true, cam_facing: 'user',
  screen_res: 720, screen_fps: 8, screen_quality: 70, screen_codec: 'jpg',
  sounds: [], sound_volume: 80, sound_cooldown: 1.0,
  idle_minutes: 10, confirm_leave_call: false, streamer_mode: false,
  music: true, music_volume: 30, music_pause_in_call: true, music_pause_background: true, music_file: '',
  music_library: [], music_mode: 'loop', music_builtin_hidden: false,
  brain_train: false, brain_train_charging_only: false,
  gif_provider: 'auto', gif_key: '', autoplay_gifs: true,
};

const KEY = 'lobby_settings';

class Settings {
  constructor() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
    this.v = { ...structuredClone(DEFAULTS), ...saved };
    this.listeners = new Set();
    this.t = null;
  }
  get(k) { return this.v[k]; }
  set(k, val) {
    this.v[k] = val;
    this.save();
    for (const f of [...this.listeners]) f(k, val);
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  save() {
    clearTimeout(this.t);
    this.t = setTimeout(() => this.flush(), 300);
  }
  flush() {
    const data = { ...this.v };
    if (!data.remember) data.token = '';
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
  }
}

export const S = new Settings();
