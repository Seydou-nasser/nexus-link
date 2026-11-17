package com.nexuslink.android.service

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Déclenche ou arrête la sonnerie maximale pour la fonction « Trouver mon téléphone »,
 * même si l'appareil est en mode silencieux ou vibreur.
 */
class RingPhoneController(private val context: Context) {

    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var ringtone: Ringtone? = null
    private var previousAlarmVolume: Int? = null

    private val _isRinging = MutableStateFlow(false)
    val isRinging: StateFlow<Boolean> = _isRinging.asStateFlow()

    fun startRinging() {
        if (_isRinging.value) return

        try {
            previousAlarmVolume = audioManager.getStreamVolume(AudioManager.STREAM_ALARM)
            val maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM)
            audioManager.setStreamVolume(AudioManager.STREAM_ALARM, maxVolume, 0)

            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)

            ringtone = RingtoneManager.getRingtone(context, uri)?.apply {
                audioAttributes = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    isLooping = true
                }
                play()
            }
            _isRinging.value = true
        } catch (e: Exception) {
            Log.e(TAG, "Impossible de déclencher la sonnerie", e)
            stopRinging()
        }
    }

    fun stopRinging() {
        try {
            ringtone?.stop()
        } catch (_: Exception) {
        }
        ringtone = null

        previousAlarmVolume?.let { prev ->
            try {
                audioManager.setStreamVolume(AudioManager.STREAM_ALARM, prev, 0)
            } catch (_: Exception) {
            }
        }
        previousAlarmVolume = null
        _isRinging.value = false
    }

    companion object {
        private const val TAG = "RingPhoneController"
    }
}
