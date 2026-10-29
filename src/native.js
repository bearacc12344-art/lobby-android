// Bridge to the app's own Android code (android/app/src/main/java/.../LobbyNativePlugin.java):
// screen capture, keep-alive/call foreground service, native HTTP (no CORS limits), saving files, misc.
import { Capacitor, registerPlugin } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();
export const LobbyNative = registerPlugin('LobbyNative');
