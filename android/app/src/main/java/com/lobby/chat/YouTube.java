package com.lobby.chat;

import android.content.Context;

import org.schabi.newpipe.extractor.InfoItem;
import org.schabi.newpipe.extractor.MediaFormat;
import org.schabi.newpipe.extractor.NewPipe;
import org.schabi.newpipe.extractor.ServiceList;
import org.schabi.newpipe.extractor.StreamingService;
import org.schabi.newpipe.extractor.downloader.Downloader;
import org.schabi.newpipe.extractor.downloader.Request;
import org.schabi.newpipe.extractor.downloader.Response;
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException;
import org.schabi.newpipe.extractor.playlist.PlaylistInfo;
import org.schabi.newpipe.extractor.search.SearchInfo;
import org.schabi.newpipe.extractor.stream.AudioStream;
import org.schabi.newpipe.extractor.stream.DeliveryMethod;
import org.schabi.newpipe.extractor.stream.StreamInfo;
import org.schabi.newpipe.extractor.stream.StreamInfoItem;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** YouTube music on the phone (like yt-dlp on PC): search / link / playlist -> download the audio so it plays offline. */
public class YouTube {
    static final String UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0";
    static final int MAX_SONGS = 50;
    static final long MAX_BYTES = 60L * 1024 * 1024;
    static volatile boolean cancel = false;
    private static boolean inited = false;

    public interface Progress { void on(double frac, String text); }

    static class Item {
        String id, title, url;
        long dur;
        Item(String id, String title, String url, long dur) { this.id = id; this.title = title; this.url = url; this.dur = dur; }
    }

    static class Dl extends Downloader {
        @Override
        public Response execute(Request request) throws IOException, ReCaptchaException {
            HttpURLConnection c = (HttpURLConnection) new URL(request.url()).openConnection();
            c.setConnectTimeout(20000);
            c.setReadTimeout(30000);
            c.setRequestMethod(request.httpMethod());
            c.setRequestProperty("User-Agent", UA);
            for (Map.Entry<String, List<String>> h : request.headers().entrySet())
                for (String v : h.getValue()) c.addRequestProperty(h.getKey(), v);
            byte[] data = request.dataToSend();
            if (data != null) {
                c.setDoOutput(true);
                try (OutputStream o = c.getOutputStream()) { o.write(data); }
            }
            int code = c.getResponseCode();
            if (code == 429) throw new ReCaptchaException("reCaptcha Challenge requested", request.url());
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String body = in == null ? "" : new String(readAll(in), "UTF-8");
            return new Response(code, c.getResponseMessage(), c.getHeaderFields(), body, c.getURL().toString());
        }
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] b = new byte[16384];
        int n;
        while ((n = in.read(b)) > 0) out.write(b, 0, n);
        in.close();
        return out.toByteArray();
    }

    static synchronized void init() {
        if (!inited) { NewPipe.init(new Dl()); inited = true; }
    }

    static boolean looksLikeLink(String t) {
        return t.matches("(?i)^\\s*(https?://)?([\\w-]+\\.)*(youtube\\.com|youtu\\.be|music\\.youtube\\.com)/.*");
    }

    static String idOf(String url) {
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("(?:v=|youtu\\.be/|shorts/|embed/)([\\w-]{11})").matcher(url);
        return m.find() ? m.group(1) : Integer.toHexString(url.hashCode());
    }

    static List<Item> resolve(String q) throws Exception {
        init();
        StreamingService yt = ServiceList.YouTube;
        List<Item> out = new ArrayList<>();
        String text = q.trim();
        if (looksLikeLink(text)) {
            if (!text.startsWith("http")) text = "https://" + text;
            StreamingService.LinkType t = yt.getLinkTypeByUrl(text);
            if (t == StreamingService.LinkType.PLAYLIST) {
                PlaylistInfo p = PlaylistInfo.getInfo(yt, text);
                for (StreamInfoItem it : p.getRelatedItems()) {
                    if (out.size() >= MAX_SONGS) break;
                    out.add(new Item(idOf(it.getUrl()), it.getName(), it.getUrl(), it.getDuration()));
                }
                return out;
            }
            if (t == StreamingService.LinkType.STREAM) {
                StreamInfo s = StreamInfo.getInfo(yt, text);
                out.add(new Item(idOf(s.getUrl()), s.getName(), s.getUrl(), s.getDuration()));
                return out;
            }
            throw new Exception("unsupported url: that doesn't look like a YouTube video or playlist");
        }
        SearchInfo si = SearchInfo.getInfo(yt, yt.getSearchQHFactory().fromQuery(text));
        for (InfoItem it : si.getRelatedItems()) {
            if (it instanceof StreamInfoItem) {
                StreamInfoItem s = (StreamInfoItem) it;
                out.add(new Item(idOf(s.getUrl()), s.getName(), s.getUrl(), s.getDuration()));
                break;   // like yt-dlp's ytsearch1
            }
        }
        return out;
    }

    /** -> {path, title, dur, mime} ; files go to <app files>/music/<id>.<ext> */
    static String[] download(Context c, String url, String id, Progress prog) throws Exception {
        init();
        cancel = false;
        File dir = new File(c.getFilesDir(), "music");
        if (!dir.exists()) dir.mkdirs();
        for (String ext : new String[]{"m4a", "webm", "mp3", "opus"}) {
            File f = new File(dir, id + "." + ext);
            if (f.exists() && f.length() > 0) return new String[]{f.getAbsolutePath(), "", "0", ext.equals("m4a") ? "audio/mp4" : "audio/" + ext};
        }
        StreamInfo s = StreamInfo.getInfo(ServiceList.YouTube, url);
        AudioStream best = null;
        int bestScore = -1;
        for (AudioStream a : s.getAudioStreams()) {
            if (!a.isUrl() || a.getDeliveryMethod() != DeliveryMethod.PROGRESSIVE_HTTP) continue;
            MediaFormat f = a.getFormat();
            int score = a.getAverageBitrate() + (f == MediaFormat.M4A ? 100000 : 0);   // m4a plays everywhere
            if (score > bestScore) { bestScore = score; best = a; }
        }
        if (best == null) throw new Exception("no downloadable audio for that video");
        MediaFormat fmt = best.getFormat();
        String ext = fmt == null ? "m4a" : fmt.getSuffix();
        String mime = fmt == null ? "audio/mp4" : fmt.getMimeType();
        File tmp = new File(dir, id + ".part");
        File dst = new File(dir, id + "." + ext);
        long total = -1, got = 0;
        final int CH = 1 << 20;   // ranged requests: YouTube throttles big single downloads
        try (OutputStream o = new FileOutputStream(tmp)) {
            while (total < 0 || got < total) {
                if (cancel) throw new Exception("cancelled");
                HttpURLConnection h = (HttpURLConnection) new URL(best.getContent()).openConnection();
                h.setConnectTimeout(20000);
                h.setReadTimeout(30000);
                h.setRequestProperty("User-Agent", UA);
                h.setRequestProperty("Range", "bytes=" + got + "-" + (got + CH - 1));
                int code = h.getResponseCode();
                if (code == 416) break;
                if (code >= 400) throw new Exception("download failed (HTTP " + code + ")");
                String cr = h.getHeaderField("Content-Range");
                if (cr != null && cr.contains("/")) {
                    try { total = Long.parseLong(cr.substring(cr.lastIndexOf('/') + 1).trim()); } catch (NumberFormatException ignored) { }
                } else if (code == 200) {
                    total = h.getContentLengthLong();
                }
                if (total > MAX_BYTES) throw new Exception("too long (over 60 MB of audio)");
                InputStream in = h.getInputStream();
                byte[] b = new byte[32768];
                int n, before = (int) got;
                while ((n = in.read(b)) > 0) {
                    o.write(b, 0, n);
                    got += n;
                    if (cancel) break;
                }
                in.close();
                if (got == before) break;
                if (code == 200) break;   // server ignored Range and sent everything
                if (prog != null && total > 0) prog.on((double) got / total, (int) (100.0 * got / total) + "%");
            }
        } catch (Exception e) {
            tmp.delete();
            throw e;
        }
        if (got == 0) { tmp.delete(); throw new Exception("empty download"); }
        if (!tmp.renameTo(dst)) throw new IOException("couldn't save the song");
        return new String[]{dst.getAbsolutePath(), s.getName(), String.valueOf(s.getDuration()), mime};
    }
}
