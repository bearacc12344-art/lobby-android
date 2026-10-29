# Lobby for Android

The phone version of Lobby (v15): the same accounts, chats, groups, calls, screen share, badges, music and community brains as Lobby on PC. It talks to PCs over the same Nostr relays, uses the same encryption and the same brain checkpoints.

## Get the APK (no PC needed)
1. Put this folder in a GitHub repository (main branch).
2. GitHub Actions builds it automatically (`.github/workflows/build-apk.yml`: Node 20, JDK 17, Android SDK).
3. Open the repo's **Releases** page on your phone and tap **Lobby.apk**.

## Build it yourself
```
npm ci
npm run build
npx cap sync android
cd android && ./gradlew assembleRelease
# -> android/app/build/outputs/apk/release/app-release.apk
```
Needs Node 20, JDK 17 and the Android SDK (platform 34).

## What's where
- `src/net/`: the P2P backend (port of p2p.py), store, crypto, badges
- `src/media/`: calls (WebRTC, audio worklets, camera, screen share)
- `src/brain/`: the picture CNN and the language network (exact ports, PC-compatible checkpoints), trained in Web Workers
- `src/music.js`: background music, local files, YouTube (native)
- `android/app/src/main/java/com/lobby/chat/`: native helpers: screen capture (MediaProjection), foreground service, incoming-call notification, YouTube (NewPipeExtractor), HTTP, files
