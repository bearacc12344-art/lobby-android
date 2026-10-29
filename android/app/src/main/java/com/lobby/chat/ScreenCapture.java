package com.lobby.chat;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
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
