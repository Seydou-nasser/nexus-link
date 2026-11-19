package com.nexuslink.android

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import com.nexuslink.android.service.ConnectionForegroundService
import com.nexuslink.android.service.ScreenMirrorService

/**
 * Activité transparente dédiée à la demande d'autorisation système MediaProjection
 * lorsque l'utilisateur lance la recopie d'écran depuis son PC.
 */
class ScreenCapturePermissionActivity : ComponentActivity() {

    private val captureLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val data = result.data
        if (result.resultCode == Activity.RESULT_OK && data != null) {
            ScreenMirrorService.startWithPermission(this, result.resultCode, data)
        } else {
            ConnectionForegroundService.sendScreenMirrorState(
                state = "ERROR",
                errorMessage = "Autorisation de partage d'écran refusée sur le téléphone."
            )
        }
        finish()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        captureLauncher.launch(manager.createScreenCaptureIntent())
    }
}
