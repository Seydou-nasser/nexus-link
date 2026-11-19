package com.nexuslink.android.network

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.os.SystemClock
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Log
import com.nexuslink.android.data.PairingStore
import com.nexuslink.android.protocol.FileTransferOfferPayload
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.TimeUnit

data class AndroidTransferRecord(
    val id: String,
    val fileName: String,
    val direction: String,
    val completed: Boolean,
    val fileUri: Uri? = null,
    val mimeType: String = "*/*",
    val bytesTransferred: Long = 0L,
    val totalBytes: Long = 0L
)

/**
 * Gère les transferts haut débit de fichiers et d'images du presse-papiers via HTTP :52842.
 */
class FileTransferManager(
    context: Context,
    private val pairingStore: PairingStore,
    private val onClipboardImageDownloaded: (File) -> Unit,
    private val onFileSavedNotification: (String) -> Unit
) {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .writeTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private val _recentTransfers = MutableStateFlow<List<AndroidTransferRecord>>(emptyList())
    val recentTransfers: StateFlow<List<AndroidTransferRecord>> = _recentTransfers.asStateFlow()

    fun handleIncomingOffer(offer: FileTransferOfferPayload) {
        scope.launch {
            val peer = pairingStore.getSavedDesktopPeer() ?: return@launch
            val secret = peer.sessionSecret ?: return@launch

            val url = "http://${peer.hostAddress}:${peer.httpPort}/api/v1/files/download/${offer.fileId}"
            val request = Request.Builder()
                .url(url)
                .header("Authorization", "Bearer $secret")
                .get()
                .build()

            try {
                httpClient.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        Log.w(TAG, "Échec téléchargement (${response.code}) pour ${offer.fileName}")
                        return@use
                    }
                    val body = response.body ?: return@use

                    if (offer.purpose == "CLIPBOARD_IMAGE") {
                        val cacheDir = File(appContext.cacheDir, "clipboard_cache").apply { mkdirs() }
                        val targetFile = File(cacheDir, "clipboard_latest.jpg")
                        body.byteStream().use { input ->
                            FileOutputStream(targetFile).use { output ->
                                input.copyTo(output)
                            }
                        }
                        onClipboardImageDownloaded(targetFile)
                    } else {
                        val expectedTotal = offer.fileSize.coerceAtLeast(body.contentLength().coerceAtLeast(0L))
                        addTransferRecord(
                            AndroidTransferRecord(
                                id = offer.fileId,
                                fileName = offer.fileName,
                                direction = "Reçu",
                                completed = false,
                                fileUri = null,
                                mimeType = offer.mimeType,
                                bytesTransferred = 0L,
                                totalBytes = expectedTotal
                            )
                        )
                        val savedUri = saveStreamToDownloads(
                            fileName = offer.fileName,
                            mimeType = offer.mimeType,
                            inputStream = body.byteStream()
                        ) { copiedBytes ->
                            updateTransferProgress(offer.fileId, copiedBytes, expectedTotal)
                        }
                        if (savedUri != null) {
                            markTransferCompleted(offer.fileId, savedUri)
                            onFileSavedNotification(offer.fileName)
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Erreur lors du téléchargement de ${offer.fileName}", e)
            }
        }
    }

    fun uploadFiles(uris: List<Uri>) {
        scope.launch {
            val peer = pairingStore.getSavedDesktopPeer() ?: return@launch
            val secret = peer.sessionSecret ?: return@launch

            for (uri in uris) {
                val (fileName, fileSize) = queryFileMetadata(uri)
                val mimeType = appContext.contentResolver.getType(uri) ?: "application/octet-stream"
                val transferId = UUID.randomUUID().toString()

                addTransferRecord(
                    AndroidTransferRecord(
                        id = transferId,
                        fileName = fileName,
                        direction = "Envoyé",
                        completed = false,
                        fileUri = uri,
                        mimeType = mimeType,
                        bytesTransferred = 0L,
                        totalBytes = fileSize.coerceAtLeast(0L)
                    )
                )

                val body = object : RequestBody() {
                    override fun contentType() = mimeType.toMediaType()
                    override fun contentLength() = if (fileSize > 0) fileSize else -1L
                    override fun writeTo(sink: BufferedSink) {
                        appContext.contentResolver.openInputStream(uri)?.use { input ->
                            val buffer = ByteArray(IO_CHUNK_SIZE)
                            var sent = 0L
                            var lastEmit = SystemClock.elapsedRealtime()
                            while (true) {
                                val read = input.read(buffer)
                                if (read <= 0) break
                                sink.write(buffer, 0, read)
                                sent += read
                                val now = SystemClock.elapsedRealtime()
                                if (now - lastEmit >= PROGRESS_EMIT_INTERVAL_MS) {
                                    lastEmit = now
                                    updateTransferProgress(transferId, sent, fileSize.coerceAtLeast(sent))
                                }
                            }
                            updateTransferProgress(transferId, sent, fileSize.coerceAtLeast(sent))
                        }
                    }
                }

                val url = "http://${peer.hostAddress}:${peer.httpPort}/api/v1/files/upload"
                val request = Request.Builder()
                    .url(url)
                    .header("Authorization", "Bearer $secret")
                    .header("X-File-Name", fileName)
                    .header("X-File-Size", fileSize.toString())
                    .header("X-Purpose", "FILE")
                    .post(body)
                    .build()

                try {
                    httpClient.newCall(request).execute().use { response ->
                        if (response.isSuccessful) {
                            markTransferCompleted(transferId)
                        } else {
                            Log.w(TAG, "Échec envoi $fileName (${response.code})")
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Erreur lors de l'envoi de $fileName", e)
                }
            }
        }
    }

    fun uploadClipboardImage(jpegBytes: ByteArray) {
        scope.launch {
            val peer = pairingStore.getSavedDesktopPeer() ?: return@launch
            val secret = peer.sessionSecret ?: return@launch

            val body = object : RequestBody() {
                override fun contentType() = "image/jpeg".toMediaType()
                override fun contentLength() = jpegBytes.size.toLong()
                override fun writeTo(sink: BufferedSink) {
                    sink.write(jpegBytes)
                }
            }

            val url = "http://${peer.hostAddress}:${peer.httpPort}/api/v1/files/upload"
            val request = Request.Builder()
                .url(url)
                .header("Authorization", "Bearer $secret")
                .header("X-File-Name", "clipboard_image.jpg")
                .header("X-File-Size", jpegBytes.size.toString())
                .header("X-Purpose", "CLIPBOARD_IMAGE")
                .post(body)
                .build()

            try {
                httpClient.newCall(request).execute().use { resp ->
                    Log.d(TAG, "Upload image presse-papiers -> HTTP ${resp.code}")
                }
            } catch (e: Exception) {
                Log.w(TAG, "Erreur envoi image presse-papiers : ${e.message}")
            }
        }
    }

    private fun saveStreamToDownloads(
        fileName: String,
        mimeType: String,
        inputStream: java.io.InputStream,
        onProgress: (Long) -> Unit = {}
    ): Uri? {
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, fileName)
            put(MediaStore.Downloads.MIME_TYPE, mimeType)
            put(
                MediaStore.Downloads.RELATIVE_PATH,
                "${Environment.DIRECTORY_DOWNLOADS}/NexusLink"
            )
            put(MediaStore.Downloads.IS_PENDING, 1)
        }

        val resolver = appContext.contentResolver
        val itemUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return null

        return try {
            resolver.openOutputStream(itemUri)?.use { output ->
                inputStream.use { input ->
                    val buffer = ByteArray(IO_CHUNK_SIZE)
                    var copied = 0L
                    var lastEmit = SystemClock.elapsedRealtime()
                    while (true) {
                        val read = input.read(buffer)
                        if (read <= 0) break
                        output.write(buffer, 0, read)
                        copied += read
                        val now = SystemClock.elapsedRealtime()
                        if (now - lastEmit >= PROGRESS_EMIT_INTERVAL_MS) {
                            lastEmit = now
                            onProgress(copied)
                        }
                    }
                    output.flush()
                    onProgress(copied)
                }
            }
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(itemUri, values, null, null)
            itemUri
        } catch (e: Exception) {
            resolver.delete(itemUri, null, null)
            Log.e(TAG, "Erreur d'écriture dans Downloads/NexusLink", e)
            null
        }
    }

    private fun queryFileMetadata(uri: Uri): Pair<String, Long> {
        var name = "fichier"
        var size = -1L
        appContext.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (nameIdx >= 0) name = cursor.getString(nameIdx) ?: name
                if (sizeIdx >= 0) size = cursor.getLong(sizeIdx)
            }
        }
        return name to size
    }

    private fun addTransferRecord(record: AndroidTransferRecord) {
        _recentTransfers.value = (listOf(record) + _recentTransfers.value).take(20)
    }

    private fun updateTransferProgress(id: String, bytesTransferred: Long, totalBytes: Long) {
        _recentTransfers.value = _recentTransfers.value.map {
            if (it.id == id) {
                it.copy(
                    bytesTransferred = bytesTransferred,
                    totalBytes = maxOf(it.totalBytes, totalBytes, bytesTransferred)
                )
            } else {
                it
            }
        }
    }

    private fun markTransferCompleted(id: String, savedUri: Uri? = null) {
        _recentTransfers.value = _recentTransfers.value.map {
            if (it.id == id) {
                val finalTotal = maxOf(it.totalBytes, it.bytesTransferred)
                it.copy(
                    completed = true,
                    fileUri = savedUri ?: it.fileUri,
                    bytesTransferred = finalTotal,
                    totalBytes = finalTotal
                )
            } else {
                it
            }
        }
    }

    companion object {
        private const val TAG = "FileTransferManager"
        private const val IO_CHUNK_SIZE = 64 * 1024
        private const val PROGRESS_EMIT_INTERVAL_MS = 120L
    }
}
