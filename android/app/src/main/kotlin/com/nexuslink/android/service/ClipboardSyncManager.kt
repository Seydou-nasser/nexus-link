package com.nexuslink.android.service

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Gère la synchronisation bidirectionnelle du presse-papiers texte avec garde anti-boucle.
 */
class ClipboardSyncManager(
    context: Context,
    private val onSendClipboardToPc: (String) -> Boolean
) {
    private val appContext = context.applicationContext
    private val clipboardManager =
        appContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile
    private var lastSyncedText: String? = null

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
     * Lit le presse-papiers Android actuel depuis un contexte ayant le focus fenêtre
     * et l'envoie au PC s'il a changé.
     */
    fun syncLocalClipboardToPc(focusedContext: Context = appContext) {
        mainHandler.post {
            try {
                val manager = focusedContext.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                    ?: clipboardManager
                val clip = manager.primaryClip ?: return@post
                if (clip.itemCount == 0) return@post

                val item = clip.getItemAt(0)
                val text = item.text?.toString()
                    ?: item.coerceToText(focusedContext)?.toString()
                    ?: return@post

                if (text.isBlank() || text == lastSyncedText) return@post

                if (onSendClipboardToPc(text)) {
                    lastSyncedText = text
                    Log.d(TAG, "Presse-papiers envoyé au PC (${text.length} caractères)")
                }
            } catch (e: Exception) {
                Log.w(TAG, "Lecture du presse-papiers ignorée : ${e.message}")
            }
        }
    }

    companion object {
        private const val TAG = "ClipboardSyncManager"
    }
}
