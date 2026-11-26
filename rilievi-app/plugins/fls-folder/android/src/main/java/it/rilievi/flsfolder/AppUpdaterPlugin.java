package it.rilievi.flsfolder;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Aggiornamento dell'app: scarica l'APK pubblicato (release GitHub) nella cache e apre l'installazione di Android.
 * L'APK nuovo si installa sopra il vecchio (dati conservati) se è firmato con la stessa chiave.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    @PluginMethod
    public void info(PluginCall call) {
        JSObject r = new JSObject();
        try {
            PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
            r.put("versionCode", code);
            r.put("versionName", pi.versionName);
        } catch (Exception e) {
            r.put("versionCode", 0);
        }
        r.put("canInstall", canInstall());
        call.resolve(r);
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        if (url == null) { call.reject("url mancante"); return; }
        new Thread(() -> {
            HttpURLConnection con = null;
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("cache non scrivibile");
                File out = new File(dir, "Rilievi.apk");
                // segue i redirect (github.com -> objects.githubusercontent.com)
                URL u = new URL(url);
                for (int hop = 0; hop < 6; hop++) {
                    con = (HttpURLConnection) u.openConnection();
                    con.setInstanceFollowRedirects(false);
                    con.setConnectTimeout(20000);
                    con.setReadTimeout(60000);
                    int code = con.getResponseCode();
                    if (code >= 300 && code < 400) {
                        String loc = con.getHeaderField("Location");
                        con.disconnect();
                        u = new URL(u, loc);
                        continue;
                    }
                    if (code != 200) throw new Exception("HTTP " + code);
                    break;
                }
                long total = con.getContentLengthLong(), done = 0, last = 0;
                byte[] buf = new byte[1 << 16];
                try (InputStream in = con.getInputStream(); OutputStream os = new FileOutputStream(out)) {
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        os.write(buf, 0, n);
                        done += n;
                        if (done - last > (512 << 10)) {
                            last = done;
                            JSObject p = new JSObject();
                            p.put("done", done);
                            p.put("total", total);
                            notifyListeners("progress", p);
                        }
                    }
                }
                JSObject r = new JSObject();
                r.put("size", out.length());
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Download non riuscito: " + e.getMessage(), e);
            } finally {
                if (con != null) con.disconnect();
            }
        }).start();
    }

    @PluginMethod
    public void install(PluginCall call) {
        if (!canInstall()) {
            // Android chiede una volta il permesso "installa app sconosciute" per questa app
            Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(s);
            call.reject("Consenti l'installazione di app da questa sorgente, poi torna qui e premi di nuovo Aggiorna", "PERMISSION");
            return;
        }
        File apk = new File(new File(getContext().getCacheDir(), "updates"), "Rilievi.apk");
        if (!apk.exists()) { call.reject("APK non scaricato"); return; }
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".rilievi.update", apk);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    private boolean canInstall() {
        return Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls();
    }
}
