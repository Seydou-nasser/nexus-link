package com.nexuslink.android.service

import android.content.Context
import android.database.ContentObserver
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Observe universellement MediaStore.Images pour détecter toute nouvelle capture d'écran
 * (Samsung, Pixel, Xiaomi, etc.) et l'envoyer en JPEG au presse-papiers du PC.
 */
class ScreenshotObserver(
    context: Context,
    private val isConnected: () -> Boolean,
    private val onScreenshotCaptured: (ByteArray) -> Unit
) {
    private val appContext = context.applicationContext
    private val mainHandler = Handler(Looper.getMainLooper())
    private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private var isRegistered = false
    private var lastProcessedId = -1L
    private var pendingCheckRunnable: Runnable? = null

    private val observer = object : ContentObserver(mainHandler) {
        override fun onChange(selfChange: Boolean, uri: Uri?) {
            super.onChange(selfChange, uri)
            if (!isConnected()) return

            pendingCheckRunnable?.let { mainHandler.removeCallbacks(it) }
            val runnable = Runnable {
                ioScope.launch { checkLatestScreenshot() }
            }
            pendingCheckRunnable = runnable
            // Laisse 450 ms au système pour finaliser l'écriture du fichier (IS_PENDING = 0)
            mainHandler.postDelayed(runnable, 450L)
        }
    }

    fun start() {
        if (isRegistered) return
        try {
            appContext.contentResolver.registerContentObserver(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                true,
                observer
            )
            isRegistered = true
        } catch (e: Exception) {
            Log.w(TAG, "Impossible d'enregistrer ScreenshotObserver : ${e.message}")
        }
    }

    fun stop() {
        pendingCheckRunnable?.let { mainHandler.removeCallbacks(it) }
        if (!isRegistered) return
        try {
            appContext.contentResolver.unregisterContentObserver(observer)
        } catch (_: Exception) {
        }
        isRegistered = false
    }

    private fun checkLatestScreenshot() {
        val resolver = appContext.contentResolver
        val nowSeconds = System.currentTimeMillis() / 1000L
        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.RELATIVE_PATH,
            MediaStore.Images.Media.DATE_ADDED,
            MediaStore.Images.Media.IS_PENDING
        )

        val sortOrder = "${MediaStore.Images.Media.DATE_ADDED} DESC"
        try {
            resolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                projection,
                null,
                null,
                sortOrder
            )?.use { cursor ->
                if (!cursor.moveToFirst()) return

                val idCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
                val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
                val pathCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.RELATIVE_PATH)
                val dateCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED)
                val pendingCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.IS_PENDING)

                val id = cursor.getLong(idCol)
                val name = cursor.getString(nameCol).orEmpty()
                val relPath = cursor.getString(pathCol).orEmpty()
                val dateAdded = cursor.getLong(dateCol)
                val isPending = cursor.getInt(pendingCol)

                if (id == lastProcessedId || isPending == 1) return
                // Ne traite que les captures créées dans les 15 dernières secondes
                if (nowSeconds - dateAdded > 15L) return

                val isScreenshot = relPath.contains("screenshot", ignoreCase = true) ||
                    name.contains("screenshot", ignoreCase = true)
                if (!isScreenshot) return

                lastProcessedId = id
                val contentUri = Uri.withAppendedPath(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    id.toString()
                )

                val rawBytes = resolver.openInputStream(contentUri)?.use { it.readBytes() } ?: return
                val jpegBytes = ClipboardSyncManager.compressBytesToJpegUnderLimit(rawBytes) ?: return
                onScreenshotCaptured(jpegBytes)
                Log.d(TAG, "Capture d'écran envoyée au presse-papiers PC ($name)")
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "Permission d'accès aux images manquante : ${e.message}")
        } catch (e: Exception) {
            Log.w(TAG, "Erreur lecture capture d'écran : ${e.message}")
        }
    }

    companion object {
        private const val TAG = "ScreenshotObserver"
    }
}
