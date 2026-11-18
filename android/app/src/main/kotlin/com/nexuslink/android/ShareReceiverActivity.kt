package com.nexuslink.android

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import com.nexuslink.android.service.ConnectionForegroundService

/**
 * Reçoit les fichiers et photos partagés depuis d'autres applications Android
 * via le menu « Partager vers NexusLink » et les transmet au PC en arrière-plan.
 */
class ShareReceiverActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val uris = extractSharedUris(intent)
        if (uris.isEmpty()) {
            Toast.makeText(this, "Aucun fichier à envoyer", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        if (!ConnectionForegroundService.isConnected()) {
            Toast.makeText(
                this,
                "Connectez d'abord votre téléphone à votre PC dans NexusLink",
                Toast.LENGTH_LONG
            ).show()
            finish()
            return
        }

        ConnectionForegroundService.sendFilesFromShare(uris)
        val countLabel = if (uris.size == 1) "1 fichier envoyé" else "${uris.size} fichiers envoyés"
        Toast.makeText(this, "$countLabel vers votre PC", Toast.LENGTH_SHORT).show()
        finish()
    }

    @Suppress("DEPRECATION")
    private fun extractSharedUris(intent: Intent?): List<Uri> {
        if (intent == null) return emptyList()
        return when (intent.action) {
            Intent.ACTION_SEND -> {
                val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    intent.getParcelableExtra(Intent.EXTRA_STREAM)
                }
                listOfNotNull(uri)
            }
            Intent.ACTION_SEND_MULTIPLE -> {
                val list = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
                }
                list.orEmpty()
            }
            else -> emptyList()
        }
    }
}
