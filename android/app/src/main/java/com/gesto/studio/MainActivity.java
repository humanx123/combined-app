package com.gesto.studio;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Gesto Studio: a WebView around the deployed site (BuildConfig.SITIO). Android supplies what a
 * browser would: camera and microphone for our own origin, the file picker, and saving the
 * blob: downloads both apps make (WAV/MP3/MIDI exports, video recordings) into Downloads.
 */
public class MainActivity extends Activity {
    static final int PERMISOS_WEB = 1;
    static final int ELEGIR_ARCHIVOS = 2;
    static final String CARPETA = "Gesto Studio";

    /**
     * Runs on every page. blob: URLs are often revoked right after the click, so the Blob is
     * remembered when the URL is made, then streamed to Android in chunks (a long WAV would not
     * fit through the bridge in one string).
     */
    static final String PUENTE_DESCARGAS = "(function(){"
        + "if(window.__gestoGuardar)return;"
        + "var hechos={},crear=URL.createObjectURL,revocar=URL.revokeObjectURL,TROZO=393216;"
        + "URL.createObjectURL=function(o){var u=crear.call(URL,o);if(o instanceof Blob)hechos[u]=o;return u;};"
        + "URL.revokeObjectURL=function(u){setTimeout(function(){delete hechos[u];},120000);revocar.call(URL,u);};"
        + "function enviar(blob,nombre){var id=GestoApp.inicio(nombre||'',blob.type||''),pos=0;"
        + "(function siguiente(){if(pos>=blob.size){GestoApp.fin(id);return;}"
        + "var lector=new FileReader();lector.onload=function(){GestoApp.trozo(id,String(lector.result).split(',')[1]||'');siguiente();};"
        + "lector.onerror=function(){GestoApp.fallo(id);};lector.readAsDataURL(blob.slice(pos,pos+=TROZO));})();}"
        + "window.__gestoGuardar=function(href,nombre){var b=hechos[href];if(b){enviar(b,nombre);return;}"
        + "fetch(href).then(function(r){return r.blob();}).then(function(b){enviar(b,nombre);})"
        + ".catch(function(e){GestoApp.aviso('No se pudo guardar el archivo. Vuelve a exportarlo.');});};"
        + "function atrapar(a){var h=a.href||'';if(a.hasAttribute('download')&&(h.indexOf('blob:')===0||h.indexOf('data:')===0)){"
        + "window.__gestoGuardar(h,a.getAttribute('download'));return true;}return false;}"
        + "var clic=HTMLAnchorElement.prototype.click;"
        + "HTMLAnchorElement.prototype.click=function(){if(!atrapar(this))clic.call(this);};"
        + "document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a[download]'):null;"
        + "if(a&&atrapar(a)){e.preventDefault();e.stopPropagation();}},true);"
        + "})();";

    WebView web;
    String host;
    PermissionRequest permisoPendiente;
    ValueCallback<Uri[]> archivosPendientes;
    final Map<String, Descarga> descargas = new ConcurrentHashMap<>();

    static class Descarga {
        File temporal;
        OutputStream salida;
        String nombre;
        String mime;
    }

    @Override public void onCreate(Bundle estado) {
        super.onCreate(estado);
        // An instrument played with the hands should not dim mid-song.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        host = Uri.parse(BuildConfig.SITIO).getHost();

        web = new WebView(this);
        web.setBackgroundColor(0xFF0B0A14);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        // The launcher hides "Download APK" when it sees this.
        s.setUserAgentString(s.getUserAgentString() + " GestoStudioApp/" + BuildConfig.VERSION_NAME);

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return abrirFuera(request.getUrl());
            }
            @SuppressWarnings("deprecation")
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return abrirFuera(Uri.parse(url));
            }
            @Override public void onPageFinished(WebView view, String url) {
                view.evaluateJavascript(PUENTE_DESCARGAS, null);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) sinConexion();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> pedirParaLaWeb(request));
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (request == permisoPendiente) permisoPendiente = null;
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (archivosPendientes != null) archivosPendientes.onReceiveValue(null);
                archivosPendientes = callback;
                Intent elegir = params.createIntent();
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) elegir.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(Intent.createChooser(elegir, "Elegir archivo"), ELEGIR_ARCHIVOS);
                    return true;
                } catch (ActivityNotFoundException e) {
                    archivosPendientes = null;
                    Toast.makeText(MainActivity.this, "No hay una app para elegir archivos.", Toast.LENGTH_LONG).show();
                    return false;
                }
            }
        });
        web.addJavascriptInterface(new Puente(), "GestoApp");
        web.setDownloadListener((url, agente, disposicion, mime, largo) -> descargar(url, disposicion, mime));
        setContentView(web);

        if (estado == null || web.restoreState(estado) == null) web.loadUrl(BuildConfig.SITIO);
    }

    /** Our own pages stay inside; everything else (Groq, Google AI Studio, GitHub…) opens in the browser. */
    boolean abrirFuera(Uri uri) {
        String esquema = uri.getScheme();
        if (esquema == null || esquema.equals("blob") || esquema.equals("data") || esquema.equals("about")) return false;
        if (host.equalsIgnoreCase(uri.getHost())) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No hay una app para abrir ese enlace.", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    void sinConexion() {
        String pagina = "<!doctype html><html lang=es><meta name=viewport content='width=device-width,initial-scale=1'>"
            + "<body style='margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0a14;color:#f4f1ff;font:16px/1.5 system-ui,sans-serif;text-align:center'>"
            + "<div style='padding:24px'><div style='font-size:42px'>✋🎛️</div><h1 style='font-size:22px'>Sin conexión</h1>"
            + "<p style='color:#a9a3c4'>Gesto Studio necesita internet la primera vez. Después, el estudio también abre sin red.</p>"
            + "<button onclick='GestoApp.reintentar()' style='margin-top:12px;padding:12px 22px;border:0;border-radius:999px;color:#fff;font-weight:600;"
            + "background:linear-gradient(135deg,#7c3aed,#ec4899)'>Reintentar</button></div></body></html>";
        web.loadDataWithBaseURL(null, pagina, "text/html", "utf-8", null);
    }

    // ---------------------------------------------------------------- camera and microphone

    void pedirParaLaWeb(PermissionRequest request) {
        if (!host.equalsIgnoreCase(request.getOrigin().getHost())) {
            request.deny();
            return;
        }
        List<String> faltan = new ArrayList<>();
        for (String recurso : request.getResources()) {
            String permiso = permisoAndroid(recurso);
            if (permiso != null && !tiene(permiso) && !faltan.contains(permiso)) faltan.add(permiso);
        }
        if (faltan.isEmpty()) {
            conceder(request);
            return;
        }
        if (permisoPendiente != null) permisoPendiente.deny();
        permisoPendiente = request;
        requestPermissions(faltan.toArray(new String[0]), PERMISOS_WEB);
    }

    static String permisoAndroid(String recurso) {
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(recurso)) return Manifest.permission.CAMERA;
        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(recurso)) return Manifest.permission.RECORD_AUDIO;
        return null;
    }

    boolean tiene(String permiso) {
        return Build.VERSION.SDK_INT < 23 || checkSelfPermission(permiso) == PackageManager.PERMISSION_GRANTED;
    }

    /** Grants only the camera/microphone the user allowed in Android; anything else is refused. */
    void conceder(PermissionRequest request) {
        List<String> si = new ArrayList<>();
        for (String recurso : request.getResources()) {
            String permiso = permisoAndroid(recurso);
            if (permiso != null && tiene(permiso)) si.add(recurso);
        }
        if (si.isEmpty()) request.deny();
        else request.grant(si.toArray(new String[0]));
    }

    @Override public void onRequestPermissionsResult(int codigo, String[] permisos, int[] resultados) {
        if (codigo != PERMISOS_WEB || permisoPendiente == null) return;
        PermissionRequest request = permisoPendiente;
        permisoPendiente = null;
        conceder(request);
        for (int i = 0; i < permisos.length; i++) {
            if (resultados.length > i && resultados[i] != PackageManager.PERMISSION_GRANTED) {
                String que = Manifest.permission.CAMERA.equals(permisos[i]) ? "la cámara" : "el micrófono";
                Toast.makeText(this, "Sin permiso para " + que + ". Puedes darlo en Ajustes → Apps → Gesto Studio.", Toast.LENGTH_LONG).show();
            }
        }
    }

    // ---------------------------------------------------------------- file picker

    @Override protected void onActivityResult(int codigo, int resultado, Intent datos) {
        if (codigo != ELEGIR_ARCHIVOS || archivosPendientes == null) {
            super.onActivityResult(codigo, resultado, datos);
            return;
        }
        Uri[] elegidos = null;
        if (resultado == RESULT_OK && datos != null) {
            if (datos.getClipData() != null) {
                elegidos = new Uri[datos.getClipData().getItemCount()];
                for (int i = 0; i < elegidos.length; i++) elegidos[i] = datos.getClipData().getItemAt(i).getUri();
            } else if (datos.getData() != null) {
                elegidos = new Uri[] { datos.getData() };
            }
        }
        archivosPendientes.onReceiveValue(elegidos);
        archivosPendientes = null;
    }

    // ---------------------------------------------------------------- downloads

    void descargar(String url, String disposicion, String mime) {
        if (url.startsWith("blob:") || url.startsWith("data:")) {
            // The anchor slipped past the page bridge: hand it back to it.
            String nombre = URLUtil.guessFileName(url, disposicion, mime);
            web.evaluateJavascript("window.__gestoGuardar && __gestoGuardar(" + cadenaJs(url) + "," + cadenaJs(nombre) + ")", null);
            return;
        }
        try {
            String nombre = URLUtil.guessFileName(url, disposicion, mime);
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            r.setMimeType(mime);
            r.setTitle(nombre);
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, CARPETA + "/" + nombre);
            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
            Toast.makeText(this, "Descargando " + nombre, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(this, "No se pudo descargar: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    static String cadenaJs(String s) {
        return "'" + s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ") + "'";
    }

    static String nombreSeguro(String nombre, String mime) {
        String limpio = nombre == null ? "" : nombre.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (limpio.isEmpty() || limpio.startsWith(".")) {
            String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
            limpio = "gesto-" + System.currentTimeMillis() + (ext != null ? "." + ext : "");
        }
        return limpio.length() > 120 ? limpio.substring(limpio.length() - 120) : limpio;
    }

    /** Copies a finished download into Downloads/Gesto Studio and returns where it went. */
    String guardar(Descarga d) throws Exception {
        String mime = d.mime == null || d.mime.isEmpty() ? "application/octet-stream" : d.mime;
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.Downloads.DISPLAY_NAME, d.nombre);
            v.put(MediaStore.Downloads.MIME_TYPE, mime);
            v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + CARPETA);
            Uri destino = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (destino == null) throw new Exception("Android no dio un lugar para guardarlo");
            try (InputStream in = new FileInputStream(d.temporal); OutputStream out = getContentResolver().openOutputStream(destino)) {
                copiar(in, out);
            }
            return "Descargas/" + CARPETA + "/" + d.nombre;
        }
        // Android 7–9: the public folder needs the storage permission; without it, the app's own folder.
        File carpeta = tiene(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            ? new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), CARPETA)
            : new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), CARPETA);
        if (!carpeta.exists() && !carpeta.mkdirs()) throw new Exception("No se pudo crear " + carpeta);
        File destino = new File(carpeta, d.nombre);
        try (InputStream in = new FileInputStream(d.temporal); OutputStream out = new FileOutputStream(destino)) {
            copiar(in, out);
        }
        if (!tiene(Manifest.permission.WRITE_EXTERNAL_STORAGE)) {
            runOnUiThread(() -> requestPermissions(new String[] { Manifest.permission.WRITE_EXTERNAL_STORAGE }, 0));
        }
        return destino.getAbsolutePath();
    }

    static void copiar(InputStream in, OutputStream out) throws Exception {
        byte[] b = new byte[65536];
        int n;
        while ((n = in.read(b)) > 0) out.write(b, 0, n);
    }

    void aviso(String texto) {
        runOnUiThread(() -> Toast.makeText(this, texto, Toast.LENGTH_LONG).show());
    }

    /** What the page bridge (PUENTE_DESCARGAS) calls. Runs on WebView's background thread. */
    class Puente {
        @JavascriptInterface public String inicio(String nombre, String mime) {
            try {
                Descarga d = new Descarga();
                d.nombre = nombreSeguro(nombre, mime);
                d.mime = mime;
                d.temporal = File.createTempFile("descarga", ".parte", getCacheDir());
                d.salida = new FileOutputStream(d.temporal);
                String id = UUID.randomUUID().toString();
                descargas.put(id, d);
                return id;
            } catch (Exception e) {
                aviso("No se pudo empezar a guardar: " + e.getMessage());
                return "";
            }
        }
        @JavascriptInterface public void trozo(String id, String base64) {
            Descarga d = descargas.get(id);
            if (d == null) return;
            try {
                d.salida.write(Base64.decode(base64, Base64.DEFAULT));
            } catch (Exception e) {
                fallo(id);
            }
        }
        @JavascriptInterface public void fin(String id) {
            Descarga d = descargas.remove(id);
            if (d == null) return;
            try {
                d.salida.close();
                aviso("Guardado en " + guardar(d));
            } catch (Exception e) {
                aviso("No se pudo guardar: " + e.getMessage());
            } finally {
                //noinspection ResultOfMethodCallIgnored
                d.temporal.delete();
            }
        }
        @JavascriptInterface public void fallo(String id) {
            Descarga d = descargas.remove(id);
            if (d == null) return;
            try { d.salida.close(); } catch (Exception ignored) { }
            //noinspection ResultOfMethodCallIgnored
            d.temporal.delete();
            aviso("No se pudo guardar el archivo.");
        }
        @JavascriptInterface public void aviso(String texto) {
            MainActivity.this.aviso(texto);
        }
        @JavascriptInterface public void reintentar() {
            runOnUiThread(() -> web.loadUrl(BuildConfig.SITIO));
        }
    }

    // ---------------------------------------------------------------- lifecycle

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override protected void onSaveInstanceState(Bundle estado) {
        super.onSaveInstanceState(estado);
        web.saveState(estado);
    }

    @Override protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
