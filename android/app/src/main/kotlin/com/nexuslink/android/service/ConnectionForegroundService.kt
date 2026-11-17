package com.nexuslink.android.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.os.BatteryManager
import android.os.Binder
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import com.nexuslink.android.MainActivity
import com.nexuslink.android.R
import com.nexuslink.android.data.PairingStore
import com.nexuslink.android.network.ConnectionState
import com.nexuslink.android.network.NexusWebSocketClient
import com.nexuslink.android.network.NsdDiscoveryManager
import com.nexuslink.android.protocol.DeviceStatusPayload
import com.nexuslink.android.protocol.DiscoveredDesktopHost
import com.nexuslink.android.protocol.PairingQrPayload
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * Service persistant de premier plan maintenant la découverte mDNS et la connexion WebSocket actives.
 */
class ConnectionForegroundService : Service() {

    inner class LocalBinder : Binder() {
        fun getService(): ConnectionForegroundService = this@ConnectionForegroundService
    }

    private val binder = LocalBinder()
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private lateinit var pairingStore: PairingStore
    private lateinit var nsdDiscoveryManager: NsdDiscoveryManager
    private lateinit var webSocketClient: NexusWebSocketClient

    val connectionState: StateFlow<ConnectionState>
        get() = webSocketClient.connectionState

    val discoveredHosts: StateFlow<List<DiscoveredDesktopHost>>
        get() = nsdDiscoveryManager.discoveredHosts

    val isDiscovering: StateFlow<Boolean>
        get() = nsdDiscoveryManager.isDiscovering

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()

        pairingStore = PairingStore(this)
        nsdDiscoveryManager = NsdDiscoveryManager(this)
        webSocketClient = NexusWebSocketClient(
            pairingStore = pairingStore,
            statusProvider = { readCurrentDeviceStatus() }
        )

        startForeground(NOTIFICATION_ID, buildNotification("Initialisation du lien local…"))

        serviceScope.launch {
            webSocketClient.connectionState.collect { state ->
                val statusText = when (state) {
                    is ConnectionState.Connected -> "Connecté à ${state.pcName}"
                    is ConnectionState.WaitingApproval -> "Confirmation requise sur ${state.pcName}…"
                    is ConnectionState.Connecting -> "Connexion à ${state.targetHost}…"
                    is ConnectionState.Error -> "Connexion interrompue"
                    ConnectionState.Disconnected -> "En attente de liaison locale"
                }
                updateNotification(statusText)
            }
        }

        nsdDiscoveryManager.startDiscovery()
        webSocketClient.connectToSavedPeer()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP_SERVICE) {
            webSocketClient.disconnect(disableReconnect = true)
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onDestroy() {
        nsdDiscoveryManager.stopDiscovery()
        webSocketClient.disconnect(disableReconnect = true)
        serviceScope.cancel()
        super.onDestroy()
    }

    fun pairWithQrPayload(qrPayload: PairingQrPayload, preferredAddress: String? = null) {
        pairingStore.savePairingQrPayload(qrPayload, preferredAddress)
        val savedPeer = pairingStore.getSavedDesktopPeer() ?: return
        webSocketClient.connect(savedPeer)
    }

    fun pairWithDiscoveredHost(host: DiscoveredDesktopHost) {
        webSocketClient.connectManual(host)
    }

    fun disconnectAndForgetPeer() {
        webSocketClient.disconnect(disableReconnect = true)
        pairingStore.clearSavedPeer()
    }

    fun restartDiscovery() {
        nsdDiscoveryManager.stopDiscovery()
        nsdDiscoveryManager.startDiscovery()
    }

    private fun readCurrentDeviceStatus(): DeviceStatusPayload {
        val batteryIntent = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val batteryPct = if (level >= 0 && scale > 0) (level * 100) / scale else 100

        val status = batteryIntent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
            status == BatteryManager.BATTERY_STATUS_FULL

        val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val ringerMode = when (audioManager.ringerMode) {
            AudioManager.RINGER_MODE_SILENT -> "SILENT"
            AudioManager.RINGER_MODE_VIBRATE -> "VIBRATE"
            else -> "NORMAL"
        }

        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        val screenAwake = powerManager.isInteractive

        return DeviceStatusPayload(
            batteryLevel = batteryPct,
            isCharging = isCharging,
            ringerMode = ringerMode,
            screenAwake = screenAwake
        )
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "NexusLink — Liaison locale",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Maintient la connexion locale avec votre PC"
            setShowBadge(false)
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(contentText: String): Notification {
        val openAppIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, ConnectionForegroundService::class.java).apply {
                action = ACTION_STOP_SERVICE
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("NexusLink")
            .setContentText(contentText)
            .setOngoing(true)
            .setContentIntent(openAppIntent)
            .addAction(0, "Arrêter", stopIntent)
            .build()
    }

    private fun updateNotification(contentText: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, buildNotification(contentText))
    }

    companion object {
        private const val CHANNEL_ID = "nexuslink_connection_channel"
        private const val NOTIFICATION_ID = 1001
        const val ACTION_STOP_SERVICE = "com.nexuslink.android.ACTION_STOP_SERVICE"
    }
}
