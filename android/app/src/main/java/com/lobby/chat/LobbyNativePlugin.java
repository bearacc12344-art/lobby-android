package com.lobby.chat;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Everything the web app needs from Android that the WebView can't do itself. */
@CapacitorPlugin(name = "LobbyNative")
public class LobbyNativePlugin extends Plugin {
    static LobbyNativePlugin instance;
    static Context appContext;
    static final String CALL_CHANNEL = "lobby_calls";
    static final int CALL_NOTIF = 4402;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final ExecutorService ytPool = Executors.newSingleThreadExecutor();
    private static final Handler main = new Handler(Looper.getMainLooper());

    @Override
    public void load() {
        instance = this;
        appContext = getContext().getApplicationContext();
    }

    static void emit(String event, String key, String value) {
        LobbyNativePlugin p = instance;
        if (p == null) return;
        JSObject o = new JSObject();
        o.put(key, value);
        main.post(() -> p.notifyListeners(event, o, true));
    }

    static void callAction(Context c, String action, long callId) {
        NotificationManagerCompat.from(c).cancel(CALL_NOTIF);
        LobbyNativePlugin p = instance;
        if (p == null) return;
        JSObject o = new JSObject();
        o.put("action", action);
        o.put("callId", callId);
        main.post(() -> p.notifyListeners("callAction", o, true));
    }

    // ------------------------------------------------------------------ HTTP without CORS limits (GIFs, avatars, uploads)
    @PluginMethod
    public void http(PluginCall call) {
        pool.execute(() -> {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(call.getString("url")).openConnection();
                int timeout = call.getInt("timeout", 60000);
                c.setConnectTimeout(Math.min(timeout, 20000));
                c.setReadTimeout(timeout);
                c.setInstanceFollowRedirects(true);
                c.setRequestMethod(call.getString("method", "GET"));
                JSObject headers = call.getObject("headers", new JSObject());
                boolean ua = false;
                for (Iterator<String> it = headers.keys(); it.hasNext(); ) {
                    String k = it.next();
                    if (k.equalsIgnoreCase("user-agent")) ua = true;
                    c.setRequestProperty(k, headers.getString(k));
                }
                if (!ua) c.setRequestProperty("User-Agent", YouTube.UA);
                String body = call.getString("body");
                if (body != null) {
                    c.setDoOutput(true);
                    try (OutputStream o = c.getOutputStream()) { o.write(Base64.decode(body, Base64.DEFAULT)); }
                }
                int code = c.getResponseCode();
                InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                byte[] data = in == null ? new byte[0] : YouTube.readAll(in);
                JSObject r = new JSObject();
                r.put("status", code);
                r.put("body", Base64.encodeToString(data, Base64.NO_WRAP));
                JSObject hs = new JSObject();
                for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet())
                    if (e.getKey() != null && !e.getValue().isEmpty()) hs.put(e.getKey().toLowerCase(), e.getValue().get(0));
                r.put("headers", hs);
                r.put("url", c.getURL().toString());
                call.resolve(r);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    // ------------------------------------------------------------------ files
    @PluginMethod
    public void saveFile(PluginCall call) {
        pool.execute(() -> {
            try {
                String name = safeName(call.getString("name", "file"));
                String mime = call.getString("mime", "application/octet-stream");
                byte[] data = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
                String saved = name;
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentResolver cr = getContext().getContentResolver();
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    v.put(MediaStore.Downloads.MIME_TYPE, mime);
                    v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Lobby");
                    Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new Exception("couldn't create the file");
                    try (OutputStream o = cr.openOutputStream(uri)) { o.write(data); }
                    saved = "Lobby/" + name;
                } else {
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Smult");
                    dir.mkdirs();
                    File f = new File(dir, name);
                    for (int i = 1; f.exists(); i++) f = new File(dir, i + "_" + name);
                    try (OutputStream o = new FileOutputStream(f)) { o.write(data); }
                    saved = "Lobby/" + f.getName();
                }
                JSObject r = new JSObject();
                r.put("name", saved);
                call.resolve(r);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }

    @PluginMethod
    public void openFile(PluginCall call) {
        try {
            String name = safeName(call.getString("name", "file"));
            String mime = call.getString("mime", "application/octet-stream");
            File dir = new File(getContext().getCacheDir(), "open");
            dir.mkdirs();
            File f = new File(dir, name);
            try (OutputStream o = new FileOutputStream(f)) { o.write(Base64.decode(call.getString("data", ""), Base64.DEFAULT)); }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(Intent.createChooser(i, name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("no app on this phone can open that kind of file");
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        String path = call.getString("path", "");
        File f = new File(path);
        // only inside our own storage
        if (path.startsWith(getContext().getFilesDir().getAbsolutePath())) f.delete();
        call.resolve();
    }

    static String safeName(String n) {
        String s = n.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]", "_").trim();
        return s.isEmpty() ? "file" : (s.length() > 120 ? s.substring(s.length() - 120) : s);
    }

    // ------------------------------------------------------------------ staying connected / calls
    @PluginMethod
    public void keepAlive(PluginCall call) {
        LobbyService.keepAlive = call.getBoolean("on", false);
        LobbyService.title = call.getString("title", "Smult");
        LobbyService.text = call.getString("text", "Connected");
        try { LobbyService.refresh(getContext()); } catch (Exception e) { call.reject(String.valueOf(e.getMessage())); return; }
        call.resolve();
    }

    @PluginMethod
    public void callService(PluginCall call) {
        LobbyService.inCall = call.getBoolean("on", false);
        try { LobbyService.refresh(getContext()); } catch (Exception e) { call.reject(String.valueOf(e.getMessage())); return; }
        call.resolve();
    }

    @PluginMethod
    public void callAudio(PluginCall call) {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        boolean on = call.getBoolean("on", false);
        boolean speaker = call.getBoolean("speaker", true);
        try {
            if (on) {
                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                if (Build.VERSION.SDK_INT >= 31) {
                    AudioDeviceInfo pick = null;
                    for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
                        int t = d.getType();
                        boolean headset = t == AudioDeviceInfo.TYPE_WIRED_HEADSET || t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES
                                || t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || t == AudioDeviceInfo.TYPE_USB_HEADSET || t == AudioDeviceInfo.TYPE_BLE_HEADSET;
                        if (headset) { pick = d; break; }
                        if (speaker && t == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) pick = d;
                        if (!speaker && t == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) pick = d;
                    }
                    if (pick != null) am.setCommunicationDevice(pick);
                    else am.clearCommunicationDevice();
                } else {
                    am.setSpeakerphoneOn(speaker && !am.isWiredHeadsetOn() && !am.isBluetoothScoOn());
                }
            } else {
                if (Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice();
                else am.setSpeakerphoneOn(false);
                am.setMode(AudioManager.MODE_NORMAL);
            }
        } catch (Exception ignored) { }
        call.resolve();
    }

    @PluginMethod
    public void callNotify(PluginCall call) {
        Context c = getContext();
        NotificationManagerCompat nm = NotificationManagerCompat.from(c);
        if (!call.getBoolean("show", false)) {
            nm.cancel(CALL_NOTIF);
            call.resolve();
            return;
        }
        long callId = call.getLong("callId", 0L);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager m = c.getSystemService(NotificationManager.class);
            if (m.getNotificationChannel(CALL_CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(CALL_CHANNEL, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("Rings when someone calls you on Smult");
                ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                        new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build());
                ch.enableVibration(true);
                ch.setVibrationPattern(new long[]{0, 800, 600, 800, 600, 800});
                ch.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
                m.createNotificationChannel(ch);
            }
        }
        PendingIntent open = actionIntent(c, "open", callId, 10);
        PendingIntent accept = actionIntent(c, "accept", callId, 11);
        PendingIntent decline = actionIntent(c, "decline", callId, 12);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CALL_CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_lobby)
                .setContentTitle(call.getString("title", "📞 Incoming call"))
                .setContentText(call.getString("text", "Someone is calling you"))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(true)
                .setTimeoutAfter(60000)
                .setContentIntent(open)
                .setFullScreenIntent(open, true)
                .addAction(0, "✖ Decline", decline)
                .addAction(0, "📞 Accept", accept);
        try {
            if (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
                nm.notify(CALL_NOTIF, b.build());
        } catch (SecurityException ignored) { }
        call.resolve();
    }

    private static PendingIntent actionIntent(Context c, String action, long callId, int req) {
        Intent i = new Intent(c, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra("lobby_call_action", action)
                .putExtra("lobby_call_id", callId);
        return PendingIntent.getActivity(c, req, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    @PluginMethod
    public void batteryOptimizations(PluginCall call) {
        Context c = getContext();
        try {
            PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
            if (Build.VERSION.SDK_INT >= 23 && !pm.isIgnoringBatteryOptimizations(c.getPackageName())) {
                Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + c.getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                c.startActivity(i);
            } else {
                Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + c.getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                c.startActivity(i);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }

    // ------------------------------------------------------------------ screen sharing
    @PluginMethod
    public void startScreen(PluginCall call) {
        ScreenCapture.fps = call.getInt("fps", 8);
        ScreenCapture.maxHeight = call.getInt("maxHeight", 720);
        ScreenCapture.quality = call.getInt("quality", 70);
        ScreenCapture.webp = "webp".equals(call.getString("codec", "jpg"));
        ScreenCapture.audio = call.getBoolean("audio", true);
        MediaProjectionManager mpm = (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        startActivityForResult(call, mpm.createScreenCaptureIntent(), "screenResult");
    }

    @ActivityCallback
    private void screenResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("cancelled");
            return;
        }
        ScreenCapture.resultCode = result.getResultCode();
        ScreenCapture.resultData = result.getData();
        LobbyService.sharing = true;
        try {
            LobbyService.refresh(getContext());   // the service (type mediaProjection) starts the capture
            call.resolve();
        } catch (Exception e) {
            LobbyService.sharing = false;
            call.reject(String.valueOf(e.getMessage()));
        }
    }

    @PluginMethod
    public void stopScreen(PluginCall call) {
        ScreenCapture.stop();
        LobbyService.sharing = false;
        try { LobbyService.refresh(getContext()); } catch (Exception ignored) { }
        call.resolve();
    }

    // ------------------------------------------------------------------ YouTube music
    @PluginMethod
    public void ytResolve(PluginCall call) {
        ytPool.execute(() -> {
            try {
                JSArray arr = new JSArray();
                for (YouTube.Item it : YouTube.resolve(call.getString("q", ""))) {
                    JSObject o = new JSObject();
                    o.put("id", it.id);
                    o.put("title", it.title);
                    o.put("url", it.url);
                    o.put("dur", it.dur);
                    arr.put(o);
                }
                JSObject r = new JSObject();
                r.put("items", arr);
                call.resolve(r);
            } catch (Throwable e) {
                call.reject(String.valueOf(e.getMessage() != null ? e.getMessage() : e.toString()));
            }
        });
    }

    @PluginMethod
    public void ytDownload(PluginCall call) {
        final int n = call.getInt("n", 1), idx = call.getInt("i", 0);
        ytPool.execute(() -> {
            try {
                String[] r = YouTube.download(getContext(), call.getString("url", ""), call.getString("id", "song"), (frac, text) -> {
                    JSObject o = new JSObject();
                    o.put("frac", (idx + frac) / n);
                    main.post(() -> notifyListeners("ytProgress", o, false));
                });
                JSObject o = new JSObject();
                o.put("path", r[0]);
                o.put("title", r[1]);
                o.put("dur", Long.parseLong(r[2]));
                o.put("mime", r[3]);
                call.resolve(o);
            } catch (Throwable e) {
                call.reject(String.valueOf(e.getMessage() != null ? e.getMessage() : e.toString()));
            }
        });
    }

    @PluginMethod
    public void ytCancel(PluginCall call) {
        YouTube.cancel = true;
        call.resolve();
    }
}
