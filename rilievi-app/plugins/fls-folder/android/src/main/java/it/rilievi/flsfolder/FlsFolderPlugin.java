package it.rilievi.flsfolder;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

import androidx.activity.result.ActivityResult;

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
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Scelta di una cartella con il selettore di sistema (Storage Access Framework) e copia, nella cache
 * dell'app, dei soli file che servono a leggere le scansioni FARO .fls: Main, ScanDataStream*, MirrorIndex0/1.hls.
 * La cartella scelta può essere una "xxx.fls" oppure una cartella che ne contiene più d'una.
 */
@CapacitorPlugin(name = "FlsFolder")
public class FlsFolderPlugin extends Plugin {

    private static final Pattern WANTED = Pattern.compile("^(Main|ScanDataStream\\d+|MirrorIndex[01]\\.hls)$");
    private static final int MAX_DEPTH = 6;

    private static class Item {
        String docId;
        String path;
        long size;
    }

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "onPicked");
    }

    @PluginMethod
    public void clear(PluginCall call) {
        deleteRec(new File(getContext().getCacheDir(), "fls"));
        call.resolve();
    }

    @ActivityCallback
    private void onPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("Nessuna cartella scelta", "CANCELLED");
            return;
        }
        final Uri tree = result.getData().getData();
        new Thread(() -> {
            try {
                call.resolve(collect(tree));
            } catch (Exception e) {
                call.reject("Impossibile leggere la cartella: " + e.getMessage(), e);
            }
        }).start();
    }

    private JSObject collect(Uri tree) throws Exception {
        ContentResolver cr = getContext().getContentResolver();
        String rootId = DocumentsContract.getTreeDocumentId(tree);
        String rootName = displayName(cr, DocumentsContract.buildDocumentUriUsingTree(tree, rootId));
        if (rootName == null || rootName.isEmpty()) rootName = "cartella";

        List<Item> items = new ArrayList<>();
        walk(cr, tree, rootId, rootName, rootName.toLowerCase().endsWith(".fls"), 0, items);

        File base = new File(getContext().getCacheDir(), "fls");
        deleteRec(base);
        long total = 0;
        for (Item it : items) total += it.size;

        JSArray files = new JSArray();
        long done = 0, lastNotify = 0;
        byte[] buf = new byte[1 << 20];
        for (Item it : items) {
            File out = new File(base, it.path);
            File parent = out.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) throw new Exception("non posso creare " + parent);
            Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, it.docId);
            try (InputStream in = cr.openInputStream(doc); OutputStream os = new FileOutputStream(out)) {
                if (in == null) throw new Exception("non posso aprire " + it.path);
                int n;
                while ((n = in.read(buf)) > 0) {
                    os.write(buf, 0, n);
                    done += n;
                    if (done - lastNotify > (8 << 20)) {
                        lastNotify = done;
                        JSObject p = new JSObject();
                        p.put("done", done);
                        p.put("total", total);
                        notifyListeners("progress", p);
                    }
                }
            }
            JSObject f = new JSObject();
            f.put("path", it.path);
            f.put("local", out.getAbsolutePath());
            f.put("size", out.length());
            files.put(f);
        }
        JSObject ret = new JSObject();
        ret.put("root", rootName);
        ret.put("files", files);
        return ret;
    }

    // percorre l'albero: dentro una cartella .fls prende Main e i file di Scans/<n>/, salta foto e anteprime
    private void walk(ContentResolver cr, Uri tree, String docId, String path, boolean insideFls, int depth, List<Item> items) {
        if (depth > MAX_DEPTH) return;
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId);
        String[] cols = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE
        };
        try (Cursor c = cr.query(children, cols, null, null, null)) {
            if (c == null) return;
            while (c.moveToNext()) {
                String id = c.getString(0), name = c.getString(1), mime = c.getString(2);
                long size = c.isNull(3) ? 0 : c.getLong(3);
                if (name == null) continue;
                String childPath = path + "/" + name;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    if (name.equals("Previews") || name.equals("Pictures")) continue;
                    walk(cr, tree, id, childPath, insideFls || name.toLowerCase().endsWith(".fls"), depth + 1, items);
                } else if (insideFls && WANTED.matcher(name).matches()) {
                    Item it = new Item();
                    it.docId = id;
                    it.path = childPath;
                    it.size = size;
                    items.add(it);
                }
            }
        }
    }

    private static String displayName(ContentResolver cr, Uri doc) {
        try (Cursor c = cr.query(doc, new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {
        }
        return null;
    }

    private static void deleteRec(File f) {
        if (f == null || !f.exists()) return;
        File[] list = f.listFiles();
        if (list != null) for (File x : list) deleteRec(x);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
