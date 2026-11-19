package com.nexuslink.android.network

import android.content.Context
import android.util.Log
import com.nexuslink.android.media.DeleteMediaResult
import com.nexuslink.android.media.FileExplorerManager
import com.nexuslink.android.media.FsMkdirRequest
import com.nexuslink.android.media.FsOpResult
import com.nexuslink.android.media.FsRenameRequest
import com.nexuslink.android.media.FsTransferOpRequest
import com.nexuslink.android.media.MediaLibraryManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

/**
 * Serveur HTTP local léger (port 52843) exposant la galerie MediaStore (dossiers,
 * médias paginés, miniatures 256px et streaming vidéo Range 206) au PC appairé.
 *
 * Aucun scan n'est lancé en arrière-plan : tout est exécuté à la demande avec
 * authentification stricte par jeton de session (X-Nexus-Token).
 */
class MediaHttpServer(
    private val context: Context,
    private val mediaLibraryManager: MediaLibraryManager,
    private val fileExplorerManager: FileExplorerManager,
    private val sessionSecretProvider: () -> String?,
    private val port: Int = DEFAULT_MEDIA_HTTP_PORT
) {
    private val json = Json {
        encodeDefaults = true
        ignoreUnknownKeys = true
    }
    private val serverScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // Limite la concurrence de décodage des miniatures pour préserver le CPU et la batterie
    private val thumbnailSemaphore = Semaphore(permits = MAX_CONCURRENT_THUMBNAILS)

    @Volatile
    private var serverSocket: ServerSocket? = null
    private var acceptJob: Job? = null

    fun start() {
        if (acceptJob?.isActive == true) return

        acceptJob = serverScope.launch {
            try {
                val socket = ServerSocket().apply {
                    reuseAddress = true
                    bind(InetSocketAddress(port))
                }
                serverSocket = socket
                Log.i(TAG, "Serveur HTTP galerie démarré sur le port $port")

                while (isActive && !socket.isClosed) {
                    val client = try {
                        socket.accept()
                    } catch (_: Exception) {
                        break
                    }
                    serverScope.launch {
                        handleClient(client)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Impossible de démarrer le serveur HTTP galerie sur le port $port", e)
            }
        }
    }

    fun stop() {
        try {
            serverSocket?.close()
        } catch (_: Exception) {
        }
        serverSocket = null
        acceptJob?.cancel()
        acceptJob = null
        mediaLibraryManager.clearCache()
    }

    fun shutdown() {
        stop()
        serverScope.cancel()
    }

    private suspend fun handleClient(client: Socket) {
        client.use { socket ->
            try {
                socket.soTimeout = SOCKET_TIMEOUT_MS
                val input = BufferedInputStream(socket.getInputStream(), IO_BUFFER_SIZE)
                val out = BufferedOutputStream(socket.getOutputStream(), IO_BUFFER_SIZE)

                val requestLine = readAsciiLine(input) ?: return
                val parts = requestLine.split(" ")
                if (parts.size < 2) {
                    writeSimpleResponse(out, 400, "Bad Request", "Requête invalide")
                    return
                }

                val method = parts[0].uppercase()
                val rawTarget = parts[1]
                if (method != "GET" && method != "HEAD" && method != "POST" && method != "DELETE") {
                    writeSimpleResponse(out, 405, "Method Not Allowed", "Méthode non autorisée")
                    return
                }

                // Lecture des en-têtes HTTP (clés normalisées en minuscules)
                val headers = HashMap<String, String>()
                while (true) {
                    val line = readAsciiLine(input) ?: break
                    if (line.isEmpty()) break
                    val colon = line.indexOf(':')
                    if (colon > 0) {
                        val name = line.substring(0, colon).trim().lowercase()
                        val value = line.substring(colon + 1).trim()
                        headers[name] = value
                    }
                }

                val (path, queryParams) = parsePathAndQuery(rawTarget)

                // Vérification stricte du secret de session actif
                val activeSecret = sessionSecretProvider()
                val providedToken = headers["x-nexus-token"] ?: queryParams["token"]
                if (activeSecret.isNullOrBlank() || providedToken != activeSecret) {
                    writeSimpleResponse(out, 401, "Unauthorized", "Jeton de session invalide")
                    return
                }

                val contentLength = headers["content-length"]?.toLongOrNull() ?: 0L

                when {
                    method == "DELETE" && path.startsWith("/media/file/") -> handleDeleteFile(out, path)
                    method == "DELETE" && path == "/fs/delete" -> handleFsDelete(out, queryParams)
                    method == "DELETE" -> writeSimpleResponse(out, 405, "Method Not Allowed", "Suppression non supportée sur cette route")

                    method == "POST" && path == "/fs/upload" -> handleFsUpload(input, out, queryParams, contentLength)
                    method == "POST" && path == "/fs/mkdir" -> handleFsMkdir(input, out, contentLength)
                    method == "POST" && path == "/fs/rename" -> handleFsRename(input, out, contentLength)
                    method == "POST" && path == "/fs/move" -> handleFsMove(input, out, contentLength)
                    method == "POST" && path == "/fs/copy" -> handleFsCopy(input, out, contentLength)
                    method == "POST" -> writeSimpleResponse(out, 404, "Not Found", "Route POST introuvable")

                    path == "/media/folders" -> handleFolders(out, method == "HEAD")
                    path == "/media/items" -> handleItems(out, queryParams, method == "HEAD")
                    path.startsWith("/media/thumb/") -> handleThumb(out, path, method == "HEAD")
                    path.startsWith("/media/file/") -> handleFile(out, path, headers["range"], method == "HEAD")

                    path == "/fs/info" -> handleFsInfo(out, method == "HEAD")
                    path == "/fs/list" -> handleFsList(out, queryParams, method == "HEAD")
                    path == "/fs/search" -> handleFsSearch(out, queryParams, method == "HEAD")
                    path == "/fs/download" -> handleFsDownload(out, queryParams, method == "HEAD")

                    else -> writeSimpleResponse(out, 404, "Not Found", "Route introuvable")
                }
            } catch (e: Exception) {
                Log.d(TAG, "Connexion client interrompue : ${e.message}")
            }
        }
    }

    private fun handleFolders(out: OutputStream, headOnly: Boolean) {
        val folders = mediaLibraryManager.listFolders()
        val body = json.encodeToString(folders).toByteArray(StandardCharsets.UTF_8)
        writeBytesResponse(
            out = out,
            statusCode = 200,
            reason = "OK",
            contentType = "application/json; charset=utf-8",
            body = body,
            extraHeaders = mapOf("Cache-Control" to "no-store"),
            headOnly = headOnly
        )
    }

    private fun handleItems(
        out: OutputStream,
        queryParams: Map<String, String>,
        headOnly: Boolean
    ) {
        val bucketId = queryParams["bucketId"]?.takeIf { it.isNotBlank() }
        val limit = queryParams["limit"]?.toIntOrNull() ?: MediaLibraryManager.DEFAULT_PAGE_LIMIT
        val offset = queryParams["offset"]?.toIntOrNull() ?: 0

        val page = mediaLibraryManager.listMediaItems(
            bucketId = bucketId,
            limit = limit,
            offset = offset
        )
        val body = json.encodeToString(page).toByteArray(StandardCharsets.UTF_8)
        writeBytesResponse(
            out = out,
            statusCode = 200,
            reason = "OK",
            contentType = "application/json; charset=utf-8",
            body = body,
            extraHeaders = mapOf("Cache-Control" to "no-store"),
            headOnly = headOnly
        )
    }

    private suspend fun handleThumb(out: OutputStream, path: String, headOnly: Boolean) {
        val segments = path.removePrefix("/media/thumb/").split("/")
        if (segments.size != 2) {
            writeSimpleResponse(out, 400, "Bad Request", "Chemin de miniature invalide")
            return
        }
        val mediaType = segments[0]
        val mediaId = segments[1].toLongOrNull()
        if (mediaId == null) {
            writeSimpleResponse(out, 400, "Bad Request", "Identifiant média invalide")
            return
        }

        val jpegBytes = thumbnailSemaphore.withPermit {
            mediaLibraryManager.loadThumbnailJpeg(mediaId, mediaType)
        }
        if (jpegBytes == null || jpegBytes.isEmpty()) {
            writeSimpleResponse(out, 404, "Not Found", "Miniature introuvable")
            return
        }

        writeBytesResponse(
            out = out,
            statusCode = 200,
            reason = "OK",
            contentType = "image/jpeg",
            body = jpegBytes,
            extraHeaders = mapOf("Cache-Control" to "private, max-age=3600"),
            headOnly = headOnly
        )
    }

    private fun handleDeleteFile(out: OutputStream, path: String) {
        val segments = path.removePrefix("/media/file/").split("/")
        if (segments.size != 2) {
            writeSimpleResponse(out, 400, "Bad Request", "Chemin de fichier invalide")
            return
        }
        val mediaType = segments[0]
        val mediaId = segments[1].toLongOrNull()
        if (mediaId == null) {
            writeSimpleResponse(out, 400, "Bad Request", "Identifiant média invalide")
            return
        }

        when (mediaLibraryManager.deleteMedia(mediaId, mediaType)) {
            DeleteMediaResult.DELETED -> {
                writeSimpleResponse(out, 200, "OK", "Supprimé")
            }
            DeleteMediaResult.PERMISSION_REQUIRED -> {
                writeSimpleResponse(
                    out,
                    403,
                    "Forbidden",
                    "Activez « Gestion de la galerie » (Accès à tous les fichiers) dans l'application Android NexusLink."
                )
            }
            DeleteMediaResult.NOT_FOUND -> {
                writeSimpleResponse(out, 404, "Not Found", "Média introuvable")
            }
            DeleteMediaResult.ERROR -> {
                writeSimpleResponse(out, 500, "Internal Server Error", "Échec de la suppression")
            }
        }
    }

    private fun handleFile(
        out: OutputStream,
        path: String,
        rangeHeader: String?,
        headOnly: Boolean
    ) {
        val segments = path.removePrefix("/media/file/").split("/")
        if (segments.size != 2) {
            writeSimpleResponse(out, 400, "Bad Request", "Chemin de fichier invalide")
            return
        }
        val mediaType = segments[0]
        val mediaId = segments[1].toLongOrNull()
        if (mediaId == null) {
            writeSimpleResponse(out, 400, "Bad Request", "Identifiant média invalide")
            return
        }

        val fileInfo = mediaLibraryManager.getMediaFileInfo(mediaId, mediaType)
        if (fileInfo == null) {
            writeSimpleResponse(out, 404, "Not Found", "Média introuvable")
            return
        }

        val afd = try {
            context.contentResolver.openAssetFileDescriptor(fileInfo.uri, "r")
        } catch (e: Exception) {
            Log.w(TAG, "Impossible d'ouvrir ${fileInfo.uri}", e)
            null
        }
        if (afd == null) {
            writeSimpleResponse(out, 404, "Not Found", "Fichier inaccessible")
            return
        }

        afd.use { descriptor ->
            val totalLength = when {
                descriptor.length >= 0L -> descriptor.length
                fileInfo.size > 0L -> fileInfo.size
                else -> -1L
            }

            val safeFileName = fileInfo.displayName.replace("\"", "_")
            val parsedRange = if (totalLength > 0L && !rangeHeader.isNullOrBlank()) {
                parseByteRange(rangeHeader, totalLength)
            } else {
                null
            }

            if (rangeHeader != null && totalLength > 0L && parsedRange == null) {
                val headers = buildString {
                    append("HTTP/1.1 416 Range Not Satisfiable\r\n")
                    append("Content-Range: bytes */$totalLength\r\n")
                    append("Content-Length: 0\r\n")
                    append("Connection: close\r\n\r\n")
                }
                out.write(headers.toByteArray(StandardCharsets.US_ASCII))
                out.flush()
                return
            }

            val startByte = parsedRange?.first ?: 0L
            val endByte = parsedRange?.second ?: (if (totalLength > 0L) totalLength - 1L else -1L)
            val contentLength = if (totalLength > 0L) (endByte - startByte + 1L) else -1L
            val isPartial = parsedRange != null

            val headerBuilder = StringBuilder().apply {
                if (isPartial) {
                    append("HTTP/1.1 206 Partial Content\r\n")
                    append("Content-Range: bytes $startByte-$endByte/$totalLength\r\n")
                } else {
                    append("HTTP/1.1 200 OK\r\n")
                }
                append("Content-Type: ${fileInfo.mimeType}\r\n")
                append("Accept-Ranges: bytes\r\n")
                append("Content-Disposition: inline; filename=\"$safeFileName\"\r\n")
                append("Cache-Control: private, max-age=600\r\n")
                if (contentLength >= 0L) {
                    append("Content-Length: $contentLength\r\n")
                }
                append("Connection: close\r\n\r\n")
            }

            out.write(headerBuilder.toString().toByteArray(StandardCharsets.US_ASCII))
            if (headOnly) {
                out.flush()
                return
            }

            BufferedInputStream(descriptor.createInputStream(), IO_BUFFER_SIZE).use { input ->
                if (startByte > 0L) {
                    skipFully(input, startByte)
                }

                val buffer = ByteArray(IO_BUFFER_SIZE)
                var remaining = contentLength
                while (true) {
                    val toRead = if (remaining >= 0L) {
                        minOf(buffer.size.toLong(), remaining).toInt()
                    } else {
                        buffer.size
                    }
                    if (toRead == 0) break

                    val read = input.read(buffer, 0, toRead)
                    if (read <= 0) break
                    out.write(buffer, 0, read)
                    if (remaining >= 0L) {
                        remaining -= read
                    }
                }
                out.flush()
            }
        }
    }

    private fun skipFully(input: BufferedInputStream, bytesToSkip: Long) {
        var remaining = bytesToSkip
        while (remaining > 0L) {
            val skipped = input.skip(remaining)
            if (skipped <= 0L) {
                if (input.read() < 0) break
                remaining -= 1L
            } else {
                remaining -= skipped
            }
        }
    }

    private fun parseByteRange(header: String, totalLength: Long): Pair<Long, Long>? {
        val trimmed = header.trim()
        if (!trimmed.startsWith("bytes=", ignoreCase = true)) return null
        val spec = trimmed.substring(6).substringBefore(',').trim()
        val dash = spec.indexOf('-')
        if (dash < 0) return null

        val startStr = spec.substring(0, dash).trim()
        val endStr = spec.substring(dash + 1).trim()

        return if (startStr.isEmpty()) {
            // Suffixe : bytes=-500 (les 500 derniers octets)
            val suffix = endStr.toLongOrNull() ?: return null
            if (suffix <= 0L) return null
            val start = (totalLength - suffix).coerceAtLeast(0L)
            start to (totalLength - 1L)
        } else {
            val start = startStr.toLongOrNull() ?: return null
            if (start < 0L || start >= totalLength) return null
            val end = if (endStr.isEmpty()) {
                totalLength - 1L
            } else {
                (endStr.toLongOrNull() ?: return null).coerceAtMost(totalLength - 1L)
            }
            if (end < start) return null
            start to end
        }
    }

    private fun handleFsInfo(out: OutputStream, headOnly: Boolean) {
        val info = fileExplorerManager.getStorageInfo()
        val body = json.encodeToString(info).toByteArray(StandardCharsets.UTF_8)
        writeBytesResponse(
            out = out,
            statusCode = 200,
            reason = "OK",
            contentType = "application/json; charset=utf-8",
            body = body,
            extraHeaders = mapOf("Cache-Control" to "no-store"),
            headOnly = headOnly
        )
    }

    private fun handleFsList(
        out: OutputStream,
        queryParams: Map<String, String>,
        headOnly: Boolean
    ) {
        when (val result = fileExplorerManager.listDirectory(queryParams["path"])) {
            is FsOpResult.Success -> {
                val body = json.encodeToString(result.value).toByteArray(StandardCharsets.UTF_8)
                writeBytesResponse(
                    out = out,
                    statusCode = 200,
                    reason = "OK",
                    contentType = "application/json; charset=utf-8",
                    body = body,
                    extraHeaders = mapOf("Cache-Control" to "no-store"),
                    headOnly = headOnly
                )
            }
            is FsOpResult.Error -> {
                writeSimpleResponse(out, result.httpStatus, httpReason(result.httpStatus), result.message)
            }
        }
    }

    private fun handleFsSearch(
        out: OutputStream,
        queryParams: Map<String, String>,
        headOnly: Boolean
    ) {
        val query = queryParams["q"] ?: ""
        when (val result = fileExplorerManager.searchEntries(queryParams["path"], query)) {
            is FsOpResult.Success -> {
                val body = json.encodeToString(result.value).toByteArray(StandardCharsets.UTF_8)
                writeBytesResponse(
                    out = out,
                    statusCode = 200,
                    reason = "OK",
                    contentType = "application/json; charset=utf-8",
                    body = body,
                    extraHeaders = mapOf("Cache-Control" to "no-store"),
                    headOnly = headOnly
                )
            }
            is FsOpResult.Error -> {
                writeSimpleResponse(out, result.httpStatus, httpReason(result.httpStatus), result.message)
            }
        }
    }

    private fun handleFsDownload(
        out: OutputStream,
        queryParams: Map<String, String>,
        headOnly: Boolean
    ) {
        val path = queryParams["path"]
        if (path.isNullOrBlank()) {
            writeSimpleResponse(out, 400, "Bad Request", "Paramètre path manquant")
            return
        }
        when (val result = fileExplorerManager.resolveFileForDownload(path)) {
            is FsOpResult.Error -> {
                writeSimpleResponse(out, result.httpStatus, httpReason(result.httpStatus), result.message)
            }
            is FsOpResult.Success -> {
                val file = result.value
                val safeName = file.name.replace("\"", "_")
                val headerBuilder = StringBuilder().apply {
                    append("HTTP/1.1 200 OK\r\n")
                    append("Content-Type: application/octet-stream\r\n")
                    append("Content-Disposition: attachment; filename=\"$safeName\"\r\n")
                    append("Content-Length: ${file.length()}\r\n")
                    append("Connection: close\r\n\r\n")
                }
                out.write(headerBuilder.toString().toByteArray(StandardCharsets.US_ASCII))
                if (headOnly) {
                    out.flush()
                    return
                }
                BufferedInputStream(FileInputStream(file), IO_BUFFER_SIZE).use { fileIn ->
                    val buffer = ByteArray(IO_BUFFER_SIZE)
                    while (true) {
                        val read = fileIn.read(buffer)
                        if (read <= 0) break
                        out.write(buffer, 0, read)
                    }
                    out.flush()
                }
            }
        }
    }

    private fun handleFsUpload(
        input: BufferedInputStream,
        out: OutputStream,
        queryParams: Map<String, String>,
        contentLength: Long
    ) {
        val dir = queryParams["dir"] ?: ""
        val name = queryParams["name"]
        if (name.isNullOrBlank()) {
            writeSimpleResponse(out, 400, "Bad Request", "Nom de fichier manquant")
            return
        }
        when (val result = fileExplorerManager.createUploadTargetFile(dir, name)) {
            is FsOpResult.Error -> {
                writeSimpleResponse(out, result.httpStatus, httpReason(result.httpStatus), result.message)
            }
            is FsOpResult.Success -> {
                val destFile = result.value
                try {
                    FileOutputStream(destFile).use { fileOut ->
                        val buffer = ByteArray(IO_BUFFER_SIZE)
                        var remaining = contentLength
                        while (remaining > 0L) {
                            val toRead = minOf(buffer.size.toLong(), remaining).toInt()
                            val read = input.read(buffer, 0, toRead)
                            if (read <= 0) break
                            fileOut.write(buffer, 0, read)
                            remaining -= read
                        }
                        fileOut.flush()
                    }
                    fileExplorerManager.notifyFileAdded(destFile)
                    writeSimpleResponse(out, 200, "OK", destFile.name)
                } catch (e: Exception) {
                    destFile.delete()
                    Log.e(TAG, "Erreur réception upload ${destFile.path}", e)
                    writeSimpleResponse(out, 500, "Internal Server Error", "Erreur lors de l'enregistrement")
                }
            }
        }
    }

    private fun handleFsMkdir(
        input: BufferedInputStream,
        out: OutputStream,
        contentLength: Long
    ) {
        val bodyStr = readUtf8Body(input, contentLength)
        val req = try {
            json.decodeFromString<FsMkdirRequest>(bodyStr)
        } catch (_: Exception) {
            writeSimpleResponse(out, 400, "Bad Request", "Corps JSON invalide")
            return
        }
        when (val result = fileExplorerManager.createDirectory(req.parentPath, req.name)) {
            is FsOpResult.Success -> {
                val body = json.encodeToString(result.value).toByteArray(StandardCharsets.UTF_8)
                writeBytesResponse(out, 200, "OK", "application/json; charset=utf-8", body, emptyMap(), false)
            }
            is FsOpResult.Error -> {
                writeSimpleResponse(out, result.httpStatus, httpReason(result.httpStatus), result.message)
            }
        }
    }

    private fun handleFsRename(
        input: BufferedInputStream,
        out: OutputStream,
        contentLength: Long
    ) {
        val bodyStr = readUtf8Body(input, contentLength)
        val req = try {
            json.decodeFromString<FsRenameRequest>(bodyStr)
        } catch (_: Exception) {
            writeSimpleResponse(out, 400, "Bad Request", "Corps JSON invalide")
            return
        }
        when (val result = fileExplorerManager.renameEntry(req.path, req.newName)) {
            is FsOpResult.Success -> {
                val body = json.encodeToString(result.value).toByteArray(StandardCharsets.UTF_8)
                writeBytesResponse(out, 200, "OK", "application/json; charset=utf-8", body, emptyMap(), false)
            }
            is FsOpResult.Error -> {
                writeSimpleResponse(out, result.httpStatus, httpReason(result.httpStatus), result.message)
            }
        }
    }

    private fun handleFsMove(
        input: BufferedInputStream,
        out: OutputStream,
        contentLength: Long
    ) {
        val bodyStr = readUtf8Body(input, contentLength)
        val req = try {
            json.decodeFromString<FsTransferOpRequest>(bodyStr)
        } catch (_: Exception) {
            writeSimpleResponse(out, 400, "Bad Request", "Corps JSON invalide")
            return
        }
        when (val result = fileExplorerManager.moveEntry(req.sourcePath, req.targetDir)) {
            is FsOpResult.Success -> {
                val body = json.encodeToString(result.value).toByteArray(StandardCharsets.UTF_8)
                writeBytesResponse(out, 200, "OK", "application/json; charset=utf-8", body, emptyMap(), false)
            }
            is FsOpResult.Error -> {
                writeSimpleResponse(out, result.httpStatus, httpReason(result.httpStatus), result.message)
            }
        }
    }

    private fun handleFsCopy(
        input: BufferedInputStream,
        out: OutputStream,
        contentLength: Long
    ) {
        val bodyStr = readUtf8Body(input, contentLength)
        val req = try {
            json.decodeFromString<FsTransferOpRequest>(bodyStr)
        } catch (_: Exception) {
            writeSimpleResponse(out, 400, "Bad Request", "Corps JSON invalide")
            return
        }
        when (val result = fileExplorerManager.copyEntry(req.sourcePath, req.targetDir)) {
            is FsOpResult.Success -> {
                val body = json.encodeToString(result.value).toByteArray(StandardCharsets.UTF_8)
                writeBytesResponse(out, 200, "OK", "application/json; charset=utf-8", body, emptyMap(), false)
            }
            is FsOpResult.Error -> {
                writeSimpleResponse(out, result.httpStatus, httpReason(result.httpStatus), result.message)
            }
        }
    }

    private fun handleFsDelete(out: OutputStream, queryParams: Map<String, String>) {
        val path = queryParams["path"]
        if (path.isNullOrBlank()) {
            writeSimpleResponse(out, 400, "Bad Request", "Paramètre path manquant")
            return
        }
        when (val result = fileExplorerManager.deleteEntry(path)) {
            is FsOpResult.Success -> writeSimpleResponse(out, 200, "OK", "Supprimé")
            is FsOpResult.Error -> {
                writeSimpleResponse(out, result.httpStatus, httpReason(result.httpStatus), result.message)
            }
        }
    }

    private fun readAsciiLine(input: BufferedInputStream): String? {
        val out = ByteArrayOutputStream(128)
        var gotAny = false
        while (true) {
            val b = input.read()
            if (b < 0) {
                return if (gotAny) out.toString(StandardCharsets.US_ASCII.name()) else null
            }
            gotAny = true
            if (b == '\n'.code) break
            if (b != '\r'.code) {
                out.write(b)
            }
        }
        return out.toString(StandardCharsets.US_ASCII.name())
    }

    private fun readUtf8Body(input: BufferedInputStream, contentLength: Long): String {
        val maxJsonBytes = minOf(contentLength.coerceAtLeast(0L), 256L * 1024L).toInt()
        if (maxJsonBytes == 0) return ""
        val bytes = ByteArray(maxJsonBytes)
        var offset = 0
        while (offset < maxJsonBytes) {
            val read = input.read(bytes, offset, maxJsonBytes - offset)
            if (read <= 0) break
            offset += read
        }
        return String(bytes, 0, offset, StandardCharsets.UTF_8)
    }

    private fun httpReason(code: Int): String = when (code) {
        400 -> "Bad Request"
        401 -> "Unauthorized"
        403 -> "Forbidden"
        404 -> "Not Found"
        409 -> "Conflict"
        else -> "Internal Server Error"
    }

    private fun parsePathAndQuery(rawTarget: String): Pair<String, Map<String, String>> {
        val questionIdx = rawTarget.indexOf('?')
        val path = if (questionIdx >= 0) rawTarget.substring(0, questionIdx) else rawTarget
        val queryMap = LinkedHashMap<String, String>()
        if (questionIdx >= 0 && questionIdx + 1 < rawTarget.length) {
            val queryStr = rawTarget.substring(questionIdx + 1)
            for (pair in queryStr.split('&')) {
                if (pair.isEmpty()) continue
                val eq = pair.indexOf('=')
                val key = if (eq >= 0) decodeUrl(pair.substring(0, eq)) else decodeUrl(pair)
                val value = if (eq >= 0) decodeUrl(pair.substring(eq + 1)) else ""
                queryMap[key] = value
            }
        }
        return path to queryMap
    }

    private fun decodeUrl(value: String): String = try {
        URLDecoder.decode(value, "UTF-8")
    } catch (_: Exception) {
        value
    }

    private fun writeSimpleResponse(
        out: OutputStream,
        statusCode: Int,
        reason: String,
        message: String
    ) {
        val body = message.toByteArray(StandardCharsets.UTF_8)
        writeBytesResponse(
            out = out,
            statusCode = statusCode,
            reason = reason,
            contentType = "text/plain; charset=utf-8",
            body = body,
            extraHeaders = emptyMap(),
            headOnly = false
        )
    }

    private fun writeBytesResponse(
        out: OutputStream,
        statusCode: Int,
        reason: String,
        contentType: String,
        body: ByteArray,
        extraHeaders: Map<String, String>,
        headOnly: Boolean
    ) {
        val headerBuilder = StringBuilder().apply {
            append("HTTP/1.1 $statusCode $reason\r\n")
            append("Content-Type: $contentType\r\n")
            append("Content-Length: ${body.size}\r\n")
            for ((k, v) in extraHeaders) {
                append("$k: $v\r\n")
            }
            append("Connection: close\r\n\r\n")
        }
        out.write(headerBuilder.toString().toByteArray(StandardCharsets.US_ASCII))
        if (!headOnly && body.isNotEmpty()) {
            out.write(body)
        }
        out.flush()
    }

    companion object {
        private const val TAG = "MediaHttpServer"
        const val DEFAULT_MEDIA_HTTP_PORT = 52843
        private const val MAX_CONCURRENT_THUMBNAILS = 4
        private const val SOCKET_TIMEOUT_MS = 15_000
        private const val IO_BUFFER_SIZE = 64 * 1024
    }
}
