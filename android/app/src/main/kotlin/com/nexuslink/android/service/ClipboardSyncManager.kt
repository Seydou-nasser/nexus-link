package com.nexuslink.android.service

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.FileProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * Gère la synchronisation bidirectionnelle du presse-papiers (texte et images JPEG <= 5 Mo)
 * avec garde anti-boucle.
 */
class ClipboardSyncManager(
    context: Context,
    private val onSendClipboardToPc: (String) -> Boolean,
    private val onSendClipboardImageToPc: (ByteArray) -> Unit
) {
    private val appContext = context.applicationContext
    private val clipboardManager =
        appContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    private val mainHandler = Handler(Looper.getMainLooper())
    private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile
    private var lastSyncedText: String? = null

    @Volatile
    private var lastImageUri: String? = null

    /**
     * Applique un texte reçu du PC dans le presse-papiers Android.
     */
    fun applyRemoteClipboard(content: String) {
        if (content.isBlank()) return
        if (content == lastSyncedText) return

        lastSyncedText = content
        mainHandler.post {
            try {
                val clip = ClipData.newPlainText("NexusLink", content)
                clipboardManager.setPrimaryClip(clip)
            } catch (e: Exception) {
                Log.e(TAG, "Impossible d'écrire dans le presse-papiers Android", e)
            }
        }
    }

    /**
     * Place une image téléchargée dans le cache privé dans le presse-papiers Android (via FileProvider).
     */
    fun applyRemoteClipboardImage(imageFile: File) {
        mainHandler.post {
            try {
                val uri = FileProvider.getUriForFile(
                    appContext,
                    "${appContext.packageName}.fileprovider",
                    imageFile
                )
                lastImageUri = uri.toString()
                val clip = ClipData.newUri(appContext.contentResolver, "NexusLink", uri)
                clipboardManager.setPrimaryClip(clip)
                Log.d(TAG, "Image du presse-papiers appliquée depuis le PC")
            } catch (e: Exception) {
                Log.e(TAG, "Impossible d'appliquer l'image au presse-papiers", e)
            }
        }
    }

    /**
     * Lit le presse-papiers Android actuel (texte ou image) de façon synchrone si déjà sur le thread principal
     * afin de conserver la permission temporaire d'accès aux URI tant que le focus fenêtre est actif.
     */
    fun syncLocalClipboardToPc(focusedContext: Context = appContext) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            readAndSyncClipboard(focusedContext)
        } else {
            mainHandler.post { readAndSyncClipboard(focusedContext) }
        }
    }

    private fun readAndSyncClipboard(focusedContext: Context) {
        try {
            val manager = focusedContext.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                ?: clipboardManager
            val clip = manager.primaryClip ?: return
            if (clip.itemCount == 0) return

            val item = clip.getItemAt(0)

            // 1. Cas d'une image dans le presse-papiers (URI image/* ou MIME inconnu décodable)
            val itemUri = item.uri
            if (itemUri != null) {
                val uriStr = itemUri.toString()
                if (uriStr == lastImageUri) return

                val mimeType = focusedContext.contentResolver.getType(itemUri).orEmpty()
                if (mimeType.startsWith("image/") || mimeType.isBlank()) {
                    val rawBytes = focusedContext.contentResolver.openInputStream(itemUri)?.use {
                        it.readBytes()
                    }
                    if (rawBytes != null && rawBytes.isNotEmpty()) {
                        lastImageUri = uriStr
                        ioScope.launch {
                            val jpegBytes = compressBytesToJpegUnderLimit(rawBytes)
                            if (jpegBytes != null) {
                                onSendClipboardImageToPc(jpegBytes)
                            }
                        }
                        return
                    }
                }
            }

            // 2. Cas d'un texte dans le presse-papiers
            val text = item.text?.toString()
                ?: item.coerceToText(focusedContext)?.toString()
                ?: return

            if (text.isBlank() || text == lastSyncedText) return

            if (onSendClipboardToPc(text)) {
                lastSyncedText = text
                Log.d(TAG, "Presse-papiers envoyé au PC (${text.length} caractères)")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Lecture du presse-papiers ignorée : ${e.message}")
        }
    }

    companion object {
        private const val TAG = "ClipboardSyncManager"
        private const val MAX_CLIPBOARD_IMAGE_BYTES = 5 * 1024 * 1024

        fun compressBytesToJpegUnderLimit(rawBytes: ByteArray): ByteArray? {
            var bitmap = BitmapFactory.decodeByteArray(rawBytes, 0, rawBytes.size) ?: return null
            return try {
                for (quality in intArrayOf(85, 65, 45)) {
                    val out = ByteArrayOutputStream()
                    bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
                    val bytes = out.toByteArray()
                    if (bytes.size <= MAX_CLIPBOARD_IMAGE_BYTES) {
                        return bytes
                    }
                }
                val maxDim = maxOf(bitmap.width, bitmap.height)
                if (maxDim > 1920) {
                    val scale = 1920f / maxDim.toFloat()
                    val scaled = Bitmap.createScaledBitmap(
                        bitmap,
                        (bitmap.width * scale).toInt().coerceAtLeast(1),
                        (bitmap.height * scale).toInt().coerceAtLeast(1),
                        true
                    )
                    if (scaled !== bitmap) {
                        bitmap.recycle()
                        bitmap = scaled
                    }
                    val out = ByteArrayOutputStream()
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 75, out)
                    val bytes = out.toByteArray()
                    if (bytes.size <= MAX_CLIPBOARD_IMAGE_BYTES) {
                        return bytes
                    }
                }
                null
            } finally {
                bitmap.recycle()
            }
        }
    }
}
