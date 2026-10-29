package com.lobby.chat;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/** Screen sharing: MediaProjection -> ImageReader -> scaled JPEG/WebP frames -> the web app (which sends them in the call). */
public class ScreenCapture {
    static int resultCode = Activity.RESULT_CANCELED;
    static Intent resultData;
    static int fps = 8, maxHeight = 720, quality = 70;
    static boolean webp = false;
    static boolean audio = true;               // also send the phone's sound (games, videos...) - Android 10+
    private static AudioRecord rec;
    private static Thread audioThread;
    private static volatile boolean audioOn = false;
    private static MediaProjection projection;
    private static VirtualDisplay display;
    private static ImageReader reader;
    private static HandlerThread thread;
    private static long lastFrame = 0;
    private static int lastSig = 0;
    private static int width, height;

    static synchronized void onServiceReady(Context c) {
        if (projection != null || resultData == null) return;
        try {
            MediaProjectionManager mpm = (MediaProjectionManager) c.getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            projection = mpm.getMediaProjection(resultCode, resultData);
            resultData = null;   // a consent token can only be used once
            if (projection == null) { fail("couldn't start screen capture"); return; }
            thread = new HandlerThread("lobby-screen");
            thread.start();
            Handler h = new Handler(thread.getLooper());
            projection.registerCallback(new MediaProjection.Callback() {
                @Override
                public void onStop() { stopped(); }
            }, h);
            WindowManager wm = (WindowManager) c.getSystemService(Context.WINDOW_SERVICE);
            DisplayMetrics dm = new DisplayMetrics();
            wm.getDefaultDisplay().getRealMetrics(dm);
            int sw = dm.widthPixels, sh = dm.heightPixels;
            // fit the longer side to maxHeight-ish (portrait phones: limit height), keep even sizes for the encoder
            float sc = Math.min(1f, (float) maxHeight / Math.max(1, Math.min(sw, sh)));
            if (Math.max(sw, sh) * sc > 1600) sc = 1600f / Math.max(sw, sh);
            width = Math.max(2, Math.round(sw * sc) & ~1);
            height = Math.max(2, Math.round(sh * sc) & ~1);
            reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
            reader.setOnImageAvailableListener(ScreenCapture::onImage, h);
            display = projection.createVirtualDisplay("lobby-screen", width, height, dm.densityDpi,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.getSurface(), null, h);
            if (audio && Build.VERSION.SDK_INT >= 29) startAudio();
        } catch (Exception e) {
            fail(String.valueOf(e.getMessage()));
        }
    }

    private static void onImage(ImageReader r) {
        Image img = null;
        try {
            img = r.acquireLatestImage();
            if (img == null) return;
            long now = System.currentTimeMillis();
            if (now - lastFrame < 1000 / Math.max(1, fps)) return;
            Image.Plane p = img.getPlanes()[0];
            ByteBuffer buf = p.getBuffer();
            int pixelStride = p.getPixelStride(), rowStride = p.getRowStride();
            int w = img.getWidth(), h = img.getHeight();
            // skip unchanged frames (saves a lot of data), like the PC app
            int sig = 0;
            int lim = buf.limit();
            for (int i = 0; i < lim; i += 4093) sig = sig * 31 + buf.get(i);
            if (sig == lastSig && now - lastFrame < 3000) return;
            lastSig = sig;
            lastFrame = now;
            Bitmap bmp = Bitmap.createBitmap(rowStride / pixelStride, h, Bitmap.Config.ARGB_8888);
            buf.rewind();
            bmp.copyPixelsFromBuffer(buf);
            Bitmap crop = bmp.getWidth() == w ? bmp : Bitmap.createBitmap(bmp, 0, 0, w, h);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            Bitmap.CompressFormat fmt = webp ? (Build.VERSION.SDK_INT >= 30 ? Bitmap.CompressFormat.WEBP_LOSSY : Bitmap.CompressFormat.WEBP)
                    : Bitmap.CompressFormat.JPEG;
            crop.compress(fmt, quality, out);
            if (crop != bmp) crop.recycle();
            bmp.recycle();
            LobbyNativePlugin.emit("screenFrame", "data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
        } catch (Exception ignored) {
        } finally {
            if (img != null) img.close();
        }
    }

    /** The phone's own sound while sharing (AudioPlaybackCapture). Our call audio is "voice communication", which is
     *  never captured, so friends don't hear themselves. Sent as 20 ms mu-law packets at 24 kHz, same as PC Smult. */
    private static void startAudio() {
        try {
            AudioPlaybackCaptureConfiguration cfg = new AudioPlaybackCaptureConfiguration.Builder(projection)
                    .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                    .addMatchingUsage(AudioAttributes.USAGE_GAME)
                    .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN).build();
            AudioFormat fmt = new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(48000)
                    .setChannelMask(AudioFormat.CHANNEL_IN_MONO).build();
            int min = AudioRecord.getMinBufferSize(48000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            rec = new AudioRecord.Builder().setAudioFormat(fmt).setBufferSizeInBytes(Math.max(min, 960 * 2 * 8))
                    .setAudioPlaybackCaptureConfig(cfg).build();
            rec.startRecording();
            audioOn = true;
            audioThread = new Thread(() -> {
                short[] buf = new short[960];
                double logMu = Math.log1p(255.0);
                while (audioOn) {
                    int got = 0;
                    while (got < 960 && audioOn) {
                        int n = rec.read(buf, got, 960 - got);
                        if (n <= 0) break;
                        got += n;
                    }
                    if (got < 960) continue;
                    int peak = 0;
                    for (short v : buf) peak = Math.max(peak, Math.abs(v));
                    if (peak < 64) continue;                    // silence: send nothing
                    byte[] pkt = new byte[481];
                    pkt[0] = 1;                                 // 24 kHz
                    for (int i = 0; i < 480; i++) {
                        double x = (buf[2 * i] + buf[2 * i + 1]) / 65536.0;
                        double y = Math.signum(x) * Math.log1p(255.0 * Math.abs(x)) / logMu;
                        pkt[i + 1] = (byte) (int) Math.max(0, Math.min(255, (y + 1) * 127.5));
                    }
                    LobbyNativePlugin.emit("screenAudio", "data", Base64.encodeToString(pkt, Base64.NO_WRAP));
                }
            }, "lobby-screen-audio");
            audioThread.start();
        } catch (Exception e) {
            LobbyNativePlugin.emit("screenAudioError", "error", String.valueOf(e.getMessage()));
        }
    }

    private static void stopAudio() {
        audioOn = false;
        try { if (rec != null) { rec.stop(); rec.release(); } } catch (Exception ignored) { }
        rec = null;
        audioThread = null;
    }

    private static void fail(String msg) {
        LobbyNativePlugin.emit("screenStopped", "error", msg);
        stop();
        LobbyService.sharing = false;
    }

    private static void stopped() {
        boolean was = projection != null;
        stop();
        LobbyService.sharing = false;
        if (was) LobbyNativePlugin.emit("screenStopped", "error", "");
        Context c = LobbyNativePlugin.appContext;
        if (c != null) LobbyService.refresh(c);
    }

    static synchronized void stop() {
        stopAudio();
        try { if (display != null) display.release(); } catch (Exception ignored) { }
        try { if (reader != null) reader.close(); } catch (Exception ignored) { }
        MediaProjection p = projection;
        projection = null;
        display = null;
        reader = null;
        try { if (p != null) p.stop(); } catch (Exception ignored) { }
        if (thread != null) { thread.quitSafely(); thread = null; }
    }
}
