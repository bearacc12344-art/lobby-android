package com.lobby.chat;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * One foreground service that keeps Lobby alive: connected to the relays (keep-alive), in a voice call (microphone),
 * and sharing the screen (media projection). Each part can be switched on/off; the service stops when none is on.
 */
public class LobbyService extends Service {
    public static final String CHANNEL = "lobby_service";
    static final int NOTIF_ID = 4401;
    static boolean keepAlive = false, inCall = false, sharing = false;
    static String title = "Lobby", text = "Connected";
    private PowerManager.WakeLock wake;

    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "Lobby running", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("Keeps Lobby connected for messages and calls");
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
        }
    }

    static void refresh(Context c) {
        Intent i = new Intent(c, LobbyService.class);
        if (!keepAlive && !inCall && !sharing) {
            c.stopService(i);
            return;
        }
        ContextCompat.startForegroundService(c, i);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureChannel(this);
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String t = sharing ? "📺 Sharing your screen" : inCall ? "🔊 In a call" : title;
        String body = sharing ? "Tap to go back to the call" : inCall ? "Tap to go back to the call" : text;
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_lobby)
                .setContentTitle(t)
                .setContentText(body)
                .setContentIntent(pi)
                .setOngoing(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(inCall ? NotificationCompat.CATEGORY_CALL : NotificationCompat.CATEGORY_SERVICE)
                .build();
        int type = 0;
        if (Build.VERSION.SDK_INT >= 29) {
            if (keepAlive || (!inCall && !sharing)) type |= Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
            if (inCall) {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
                    type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
                else type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
            }
            if (sharing) type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION;
        }
        try {
            ServiceCompat.startForeground(this, NOTIF_ID, n, type);
        } catch (Exception e) {
            // e.g. a type not allowed right now: fall back to a plain keep-alive notification
            try {
                ServiceCompat.startForeground(this, NOTIF_ID, n, Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0);
            } catch (Exception ignored) {
                stopSelf();
                return START_NOT_STICKY;
            }
        }
        if (inCall && wake == null) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "lobby:call");
            wake.acquire(4 * 60 * 60 * 1000L);
        } else if (!inCall && wake != null) {
            if (wake.isHeld()) wake.release();
            wake = null;
        }
        if (sharing) ScreenCapture.onServiceReady(this);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (wake != null && wake.isHeld()) wake.release();
        wake = null;
        ScreenCapture.stop();
        super.onDestroy();
    }

    public void onTimeout(int startId) {   // Android 15 dataSync limit (no @Override: compileSdk 34)
        stopSelf();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
