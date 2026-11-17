package com.nexuslink.android.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.os.BatteryManager
import android.os.PowerManager
import androidx.core.content.ContextCompat
import com.nexuslink.android.protocol.DeviceStatusPayload

/**
 * Surveille en temps réel la batterie, le mode sonnerie et l'état de l'écran du téléphone.
 */
class DeviceStatusMonitor(
    private val context: Context,
    private val onStatusChanged: (DeviceStatusPayload) -> Unit
) {
    private var isRegistered = false
    private var lastSentStatus: DeviceStatusPayload? = null

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) {
            val current = readCurrentStatus()
            if (current != lastSentStatus) {
                lastSentStatus = current
                onStatusChanged(current)
            }
        }
    }

    fun start() {
        if (isRegistered) return
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_BATTERY_CHANGED)
            addAction(AudioManager.RINGER_MODE_CHANGED_ACTION)
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_SCREEN_OFF)
        }
        ContextCompat.registerReceiver(
            context,
            statusReceiver,
            filter,
            ContextCompat.RECEIVER_EXPORTED
        )
        isRegistered = true
    }

    fun stop() {
        if (!isRegistered) return
        try {
            context.unregisterReceiver(statusReceiver)
        } catch (_: IllegalArgumentException) {
        }
        isRegistered = false
    }

    fun readCurrentStatus(): DeviceStatusPayload {
        val batteryIntent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val batteryPct = if (level >= 0 && scale > 0) (level * 100) / scale else 100

        val status = batteryIntent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
            status == BatteryManager.BATTERY_STATUS_FULL

        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val ringerMode = when (audioManager.ringerMode) {
            AudioManager.RINGER_MODE_SILENT -> "SILENT"
            AudioManager.RINGER_MODE_VIBRATE -> "VIBRATE"
            else -> "NORMAL"
        }

        val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val screenAwake = powerManager.isInteractive

        return DeviceStatusPayload(
            batteryLevel = batteryPct,
            isCharging = isCharging,
            ringerMode = ringerMode,
            screenAwake = screenAwake
        )
    }
}
