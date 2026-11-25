package com.tdk.may

import android.app.Activity
import android.app.ActivityManager
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import com.google.mediapipe.tasks.genai.llminference.LlmInferenceSession
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Mây AI — app Android lai:
 *  - Chat chạy NGAY TRÊN MÁY bằng MediaPipe LLM Inference (mô hình .task, GPU/CPU), không cần mạng.
 *  - Tạo ảnh / dựng video / chat mạnh: gọi AI Studio (Gradio) đang chạy trên Colab hoặc PC qua HTTP.
 * Giao diện là trang HTML trong assets/, nói chuyện với Kotlin qua đối tượng JS "Native".
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private val llmThread = Executors.newSingleThreadExecutor()
    private val netPool = Executors.newFixedThreadPool(3)
    @Volatile private var llm: LlmInference? = null
    @Volatile private var session: LlmInferenceSession? = null
    @Volatile private var loaded: String? = null
    @Volatile private var backend: String = ""
    @Volatile private var cancelDl = false
    private var fileCb: ValueCallback<Array<Uri>>? = null
    private val modelsDir by lazy { File(getExternalFilesDir(null) ?: filesDir, "models").apply { mkdirs() } }
    private val miniDir by lazy { File(getExternalFilesDir(null) ?: filesDir, "minigpt").apply { mkdirs() } }   // MiniGPT (.mgpt)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(true)
        web = WebView(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = true
        }
        web.addJavascriptInterface(Bridge(), "Native")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val s = req.url.scheme ?: return false
                if (req.isForMainFrame && (s == "http" || s == "https")) {   // link ngoài → mở trình duyệt
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, req.url)) }
                    return true
                }
                return false
            }

            // Trang (file://) không được tự đọc file trên máy: phục vụ mô hình MiniGPT qua https://minigpt.local/…
            override fun shouldInterceptRequest(view: WebView, req: WebResourceRequest): WebResourceResponse? {
                if (req.url.host != "minigpt.local") return null
                val headers = mapOf("Access-Control-Allow-Origin" to "*", "Cache-Control" to "no-store")
                val seg = req.url.pathSegments
                return try {
                    val stream = when {
                        seg.size == 1 && seg[0] == "demo.mgpt" -> assets.open("minigpt-demo.mgpt")
                        seg.size == 2 && seg[0] == "files" -> {
                            val f = File(miniDir, seg[1])
                            if (f.canonicalFile.parentFile != miniDir.canonicalFile) throw SecurityException("đường dẫn không hợp lệ")
                            FileInputStream(f)
                        }
                        else -> throw java.io.FileNotFoundException(req.url.path)
                    }
                    WebResourceResponse("application/octet-stream", null, 200, "OK", headers, stream)
                } catch (e: Exception) {
                    WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, ByteArrayInputStream((e.message ?: "").toByteArray()))
                }
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(v: WebView, cb: ValueCallback<Array<Uri>>, p: FileChooserParams): Boolean {
                fileCb?.onReceiveValue(null); fileCb = cb
                return try { startActivityForResult(p.createIntent(), REQ_FILE); true } catch (e: Exception) { fileCb = null; false }
            }
        }
        web.loadUrl("file:///android_asset/index.html")
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        web.evaluateJavascript("window.onBack ? window.onBack() : false") { r ->
            if (r != "true") { @Suppress("DEPRECATION") super.onBackPressed() }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQ_FILE -> { fileCb?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data)); fileCb = null }
            REQ_IMPORT, REQ_IMPORT_MINI -> {
                val uri = data?.data
                val mini = requestCode == REQ_IMPORT_MINI
                if (resultCode == RESULT_OK && uri != null) netPool.execute { importModel(uri, mini) }
                else js("onDl", JSONObject().put("error", "Đã hủy chọn file").put("kind", if (mini) "mgpt" else "task"))
            }
        }
    }

    override fun onDestroy() {
        runCatching { session?.close() }; runCatching { llm?.close() }
        super.onDestroy()
    }

    // ---------- gọi JS ----------
    private fun js(fn: String, vararg args: Any?) {
        val a = args.joinToString(",") { v ->
            when (v) {
                null -> "null"
                is JSONObject, is JSONArray, is Boolean, is Number -> v.toString()
                else -> JSONObject.quote(v.toString())
            }
        }
        web.post { web.evaluateJavascript("window.$fn && window.$fn($a)", null) }
    }

    private fun toast(msg: String): Unit = runOnUiThread { Toast.makeText(this, msg, Toast.LENGTH_SHORT).show() }

    private fun keepScreen(on: Boolean) = runOnUiThread {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    private fun open(url: String, token: String = ""): HttpURLConnection {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 20000; c.readTimeout = 0; c.instanceFollowRedirects = true
        c.setRequestProperty("User-Agent", "MayAI-Android/1.0")
        if (token.isNotBlank()) c.setRequestProperty("Authorization", "Bearer $token")
        return c
    }

    // ---------- mô hình trên máy ----------
    private fun modelList(mini: Boolean = false): JSONArray {
        val arr = JSONArray()
        val (dir, ext) = if (mini) miniDir to ".mgpt" else modelsDir to ".task"
        dir.listFiles()?.filter { it.name.endsWith(ext) }?.sortedBy { it.name }?.forEach {
            arr.put(JSONObject().put("name", it.name).put("size", it.length()))
        }
        return arr
    }

    private fun downloadModel(repo: String, file: String, token: String) =
        downloadTo("https://huggingface.co/$repo/resolve/main/$file?download=true", File(modelsDir, file.substringAfterLast('/')), token, false)

    /** Tải một file về (tải tiếp được khi bị ngắt), báo tiến độ qua window.onDl({kind, pct…}). */
    private fun downloadTo(url: String, out: File, token: String, mini: Boolean) {
        cancelDl = false
        keepScreen(true)
        val kind = if (mini) "mgpt" else "task"
        val part = File(out.path + ".part")
        try {
            val c = open(url, token)
            if (part.exists()) c.setRequestProperty("Range", "bytes=${part.length()}-")   // tải tiếp khi bị ngắt
            val code = c.responseCode
            if (code == 401 || code == 403) throw Exception("Máy chủ từ chối (HTTP $code). Mô hình Hugging Face có thể cần token trong Cài đặt.")
            if (code >= 400) throw Exception("HTTP $code")
            val append = code == 206
            val start = if (append) part.length() else 0L
            val total = start + c.contentLengthLong.coerceAtLeast(0)
            var done = start; var lastPct = -1
            c.inputStream.use { inp ->
                FileOutputStream(part, append).use { o ->
                    val buf = ByteArray(1 shl 16)
                    while (true) {
                        if (cancelDl) throw Exception("Đã dừng tải (lần sau sẽ tải tiếp)")
                        val n = inp.read(buf); if (n < 0) break
                        o.write(buf, 0, n); done += n
                        val pct = if (total > 0) (done * 100 / total).toInt() else -1
                        if (pct != lastPct) { lastPct = pct; js("onDl", JSONObject().put("kind", kind).put("pct", pct).put("done", done).put("total", total).put("name", out.name)) }
                    }
                }
            }
            if (mini) checkMgpt(part)
            out.delete(); part.renameTo(out)
            js("onDl", JSONObject().put("kind", kind).put("finished", true).put("name", out.name).put("models", modelList(mini)))
        } catch (e: Exception) {
            if (mini && e.message?.startsWith("File tải về") == true) part.delete()
            js("onDl", JSONObject().put("kind", kind).put("error", e.message ?: e.toString()))
        } finally { keepScreen(false) }
    }

    private fun checkMgpt(f: File) {
        val magic = ByteArray(4)
        FileInputStream(f).use { it.read(magic) }
        if (String(magic) != "MGPT") throw Exception("File tải về không phải mô hình MiniGPT (.mgpt). Kiểm tra lại link (cần link tải trực tiếp).")
    }

    private fun importModel(uri: Uri, mini: Boolean) {
        val kind = if (mini) "mgpt" else "task"
        try {
            var name = if (mini) "model.mgpt" else "model.task"; var size = -1L
            contentResolver.query(uri, null, null, null, null)?.use { cur ->
                if (cur.moveToFirst()) {
                    cur.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { name = cur.getString(it) }
                    cur.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 }?.let { size = cur.getLong(it) }
                }
            }
            if (mini && !name.endsWith(".mgpt")) throw Exception("Cần file MiniGPT đuôi .mgpt (tạo bằng export_mobile.py)")
            if (!mini && !name.endsWith(".task")) throw Exception("Cần file mô hình đuôi .task (MediaPipe)")
            name = name.replace(Regex("[^\\p{L}\\p{N}._ -]"), "_")
            val out = File(if (mini) miniDir else modelsDir, name)
            var done = 0L; var lastPct = -1
            contentResolver.openInputStream(uri)!!.use { inp ->
                FileOutputStream(out).use { o ->
                    val buf = ByteArray(1 shl 16)
                    while (true) {
                        val n = inp.read(buf); if (n < 0) break
                        o.write(buf, 0, n); done += n
                        val pct = if (size > 0) (done * 100 / size).toInt() else -1
                        if (pct != lastPct) { lastPct = pct; js("onDl", JSONObject().put("kind", kind).put("pct", pct).put("done", done).put("total", size).put("name", name)) }
                    }
                }
            }
            if (mini) try { checkMgpt(out) } catch (e: Exception) { out.delete(); throw Exception("File này không phải mô hình MiniGPT (.mgpt).") }
            js("onDl", JSONObject().put("kind", kind).put("finished", true).put("name", name).put("models", modelList(mini)))
        } catch (e: Exception) {
            js("onDl", JSONObject().put("kind", kind).put("error", e.message ?: e.toString()))
        }
    }

    private fun loadModel(name: String, maxTokens: Int) {
        try {
            runCatching { session?.close() }; session = null
            runCatching { llm?.close() }; llm = null; loaded = null
            val path = File(modelsDir, name).absolutePath
            fun opts(b: LlmInference.Backend) = LlmInference.LlmInferenceOptions.builder()
                .setModelPath(path).setMaxTokens(maxTokens).setPreferredBackend(b).build()
            llm = try {
                backend = "GPU"; LlmInference.createFromOptions(this, opts(LlmInference.Backend.GPU))
            } catch (e: Throwable) {
                backend = "CPU"; LlmInference.createFromOptions(this, opts(LlmInference.Backend.CPU))
            }
            loaded = name
            js("onModel", JSONObject().put("ok", true).put("name", name).put("backend", backend))
        } catch (e: Throwable) {
            js("onModel", JSONObject().put("ok", false).put("error", e.message ?: e.toString()))
        }
    }

    private fun generate(prompt: String, temperature: Float, topK: Int) {
        val engine = llm ?: return js("onTok", "", true, "Chưa nạp mô hình")
        try {
            runCatching { session?.close() }
            val s = LlmInferenceSession.createFromOptions(engine,
                LlmInferenceSession.LlmInferenceSessionOptions.builder()
                    .setTemperature(temperature).setTopK(topK).setTopP(0.95f).build())
            session = s
            s.addQueryChunk(prompt)
            val sb = StringBuilder()
            keepScreen(true)
            s.generateResponseAsync { partial, done ->
                if (partial != null) sb.append(partial)
                js("onTok", sb.toString(), done, null)
                if (done) keepScreen(false)
            }
        } catch (e: Throwable) {
            keepScreen(false)
            js("onTok", "", true, e.message ?: e.toString())
        }
    }

    // ---------- AI Studio (Gradio) ----------
    private fun studioCall(id: String, base: String, api: String, data: String) {
        try {
            val root = base.trimEnd('/')
            val c = open("$root/gradio_api/call/$api")
            c.requestMethod = "POST"; c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(JSONObject().put("data", JSONArray(data)).toString().toByteArray()) }
            if (c.responseCode >= 400) throw Exception("Máy chủ trả lỗi HTTP ${c.responseCode}. Kiểm tra địa chỉ Studio.")
            val eid = JSONObject(c.inputStream.bufferedReader().readText()).getString("event_id")
            val g = open("$root/gradio_api/call/$api/$eid")
            var event = ""
            g.inputStream.bufferedReader().useLines { lines ->
                for (line in lines) {
                    if (line.startsWith("event:")) event = line.substring(6).trim()
                    else if (line.startsWith("data:")) {
                        val payload = line.substring(5).trim()
                        when (event) {
                            "complete" -> { js("onStudio", id, "ok", payload); return }
                            "error" -> { js("onStudio", id, "error", if (payload == "null") "Máy chủ báo lỗi (xem cửa sổ Colab)." else payload); return }
                        }
                    }
                }
            }
            js("onStudio", id, "error", "Mất kết nối với máy chủ.")
        } catch (e: Exception) {
            js("onStudio", id, "error", "Không kết nối được Studio: ${e.message}")
        }
    }

    private fun saveMedia(url: String, video: Boolean) {
        try {
            val name = "May-${System.currentTimeMillis()}.${if (video) "mp4" else "png"}"
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.MIME_TYPE, if (video) "video/mp4" else "image/png")
                put(MediaStore.MediaColumns.RELATIVE_PATH, (if (video) Environment.DIRECTORY_MOVIES else Environment.DIRECTORY_PICTURES) + "/MayAI")
            }
            val coll = if (video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
            val uri = contentResolver.insert(coll, values) ?: throw Exception("Không tạo được file")
            contentResolver.openOutputStream(uri)!!.use { o -> open(url).inputStream.use { it.copyTo(o) } }
            toast("Đã lưu vào ${if (video) "Movies" else "Pictures"}/MayAI")
        } catch (e: Exception) { toast("Lưu lỗi: ${e.message}") }
    }

    // ---------- cầu nối JS ↔ Kotlin ----------
    inner class Bridge {
        @JavascriptInterface fun info(): String {
            val mi = ActivityManager.MemoryInfo().also { (getSystemService(ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(it) }
            return JSONObject().put("models", modelList()).put("loaded", loaded).put("backend", backend)
                .put("ramGB", mi.totalMem / 1e9).put("freeBytes", modelsDir.usableSpace).toString()
        }

        @JavascriptInterface fun hfList(id: String, repo: String, token: String) = netPool.execute {
            try {
                val c = open("https://huggingface.co/api/models/$repo?blobs=true", token)
                if (c.responseCode >= 400) throw Exception("Không tìm thấy kho mô hình \"$repo\" (HTTP ${c.responseCode})")
                val sib = JSONObject(c.inputStream.bufferedReader().readText()).optJSONArray("siblings") ?: JSONArray()
                val files = JSONArray()
                for (i in 0 until sib.length()) {
                    val f = sib.getJSONObject(i)
                    if (f.optString("rfilename").endsWith(".task")) files.put(JSONObject().put("file", f.optString("rfilename")).put("size", f.optLong("size", 0)))
                }
                js("onHfList", id, files, null)
            } catch (e: Exception) { js("onHfList", id, JSONArray(), e.message) }
        }

        @JavascriptInterface fun download(repo: String, file: String, token: String) = netPool.execute { downloadModel(repo, file, token) }
        @JavascriptInterface fun cancelDownload() { cancelDl = true }
        @JavascriptInterface fun importModel() = runOnUiThread {
            val i = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
            @Suppress("DEPRECATION") startActivityForResult(i, REQ_IMPORT)
        }
        // ---- MiniGPT (.mgpt): file nằm trong miniDir, trang đọc qua https://minigpt.local/files/<tên> ----
        @JavascriptInterface fun miniList(): String = modelList(true).toString()
        @JavascriptInterface fun importMini() = runOnUiThread {
            val i = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
            @Suppress("DEPRECATION") startActivityForResult(i, REQ_IMPORT_MINI)
        }
        @JavascriptInterface fun downloadMini(url: String) = netPool.execute {
            var name = Uri.parse(url).lastPathSegment?.substringAfterLast('/')?.replace(Regex("[^\\p{L}\\p{N}._ -]"), "_") ?: "minigpt.mgpt"
            if (!name.endsWith(".mgpt")) name = name.substringBeforeLast('.').ifBlank { "minigpt" } + ".mgpt"
            downloadTo(url, File(miniDir, name), "", true)
        }
        @JavascriptInterface fun deleteMini(name: String): Boolean {
            val f = File(miniDir, name)
            return f.canonicalFile.parentFile == miniDir.canonicalFile && f.delete()
        }
        @JavascriptInterface fun deleteModel(name: String): Boolean {
            if (name == loaded) llmThread.execute { runCatching { session?.close(); llm?.close() }; llm = null; session = null; loaded = null }
            return File(modelsDir, name).delete()
        }
        @JavascriptInterface fun load(name: String, maxTokens: Int) = llmThread.execute { loadModel(name, maxTokens) }
        @JavascriptInterface fun generate(prompt: String, temperature: Float, topK: Int): Unit = llmThread.execute { this@MainActivity.generate(prompt, temperature, topK) }
        @JavascriptInterface fun stop() { runCatching { session?.cancelGenerateResponseAsync() }; keepScreen(false) }
        @JavascriptInterface fun studio(id: String, base: String, api: String, data: String) = netPool.execute {
            keepScreen(true); try { studioCall(id, base, api, data) } finally { keepScreen(false) }
        }
        @JavascriptInterface fun ping(id: String, base: String) = netPool.execute {
            try {
                val c = open(base.trimEnd('/') + "/gradio_api/info"); c.readTimeout = 20000
                if (c.responseCode >= 400) throw Exception("HTTP ${c.responseCode}")
                val ok = JSONObject(c.inputStream.bufferedReader().readText()).optJSONObject("named_endpoints")?.has("/tao_anh") == true
                js("onStudio", id, if (ok) "ok" else "error", if (ok) "[]" else "Đây không phải Mây AI Studio (thiếu API /tao_anh).")
            } catch (e: Exception) { js("onStudio", id, "error", "Không kết nối được: ${e.message}") }
        }
        @JavascriptInterface fun save(url: String, video: Boolean) = netPool.execute { saveMedia(url, video) }
        @JavascriptInterface fun toast(msg: String) { this@MainActivity.toast(msg) }
    }

    companion object { const val REQ_FILE = 1; const val REQ_IMPORT = 2; const val REQ_IMPORT_MINI = 3 }
}
