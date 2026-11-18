package com.nexuslink.android.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.net.Uri
import android.os.Binder
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.nexuslink.android.MainActivity
import com.nexuslink.android.R
import com.nexuslink.android.data.PairingStore
import com.nexuslink.android.network.AndroidTransferRecord
import com.nexuslink.android.network.ConnectionState
import com.nexuslink.android.network.FileTransferManager
import com.nexuslink.android.network.NexusWebSocketClient
import com.nexuslink.android.network.NsdDiscoveryManager
import com.nexuslink.android.network.UdpInputReceiver
import com.nexuslink.android.protocol.DiscoveredDesktopHost
import com.nexuslink.android.protocol.NotificationPostedPayload
import com.nexuslink.android.protocol.PairingQrPayload
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

/**
 * Service persistant de premier plan maintenant la découverte mDNS, la connexion WebSocket,
 * la surveillance batterie/statut et la sonnerie à distance actives.
 */
class ConnectionForegroundService : Service() {

    inner class LocalBinder : Binder() {
        fun getService(): ConnectionForegroundService = this@ConnectionForegroundService
    }

    private val binder = LocalBinder()
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private lateinit var pairingStore: PairingStore
    private lateinit var nsdDiscoveryManager: NsdDiscoveryManager
    private lateinit var deviceStatusMonitor: DeviceStatusMonitor
    private lateinit var ringPhoneController: RingPhoneController
    private lateinit var clipboardSyncManager: ClipboardSyncManager
    private lateinit var fileTransferManager: FileTransferManager
    private lateinit var screenshotObserver: ScreenshotObserver
    private lateinit var webSocketClient: NexusWebSocketClient
    private lateinit var udpInputReceiver: UdpInputReceiver

    val connectionState: StateFlow<ConnectionState>
        get() = webSocketClient.connectionState

    val discoveredHosts: StateFlow<List<DiscoveredDesktopHost>>
        get() = nsdDiscoveryManager.discoveredHosts

    val isDiscovering: StateFlow<Boolean>
        get() = nsdDiscoveryManager.isDiscovering

    val isRinging: StateFlow<Boolean>
        get() = ringPhoneController.isRinging

    val recentTransfers: StateFlow<List<AndroidTransferRecord>>
        get() = fileTransferManager.recentTransfers

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()

        activeInstance = java.lang.ref.WeakReference(this)
        pairingStore = PairingStore(this)
        nsdDiscoveryManager = NsdDiscoveryManager(this)
        ringPhoneController = RingPhoneController(this)
        clipboardSyncManager = ClipboardSyncManager(
            context = this,
            onSendClipboardToPc = { content -> webSocketClient.sendClipboard(content) },
            onSendClipboardImageToPc = { jpegBytes ->
                fileTransferManager.uploadClipboardImage(jpegBytes)
            }
        )
        fileTransferManager = FileTransferManager(
            context = this,
            pairingStore = pairingStore,
            onClipboardImageDownloaded = { imageFile ->
                clipboardSyncManager.applyRemoteClipboardImage(imageFile)
            },
            onFileSavedNotification = { fileName ->
                showFileReceivedNotification(fileName)
            }
        )
        screenshotObserver = ScreenshotObserver(
            context = this,
            isConnected = { connectionState.value is ConnectionState.Connected },
            onScreenshotCaptured = { jpegBytes ->
                fileTransferManager.uploadClipboardImage(jpegBytes)
            }
        )
        deviceStatusMonitor = DeviceStatusMonitor(this) { status ->
            webSocketClient.sendDeviceStatus(status)
        }
        webSocketClient = NexusWebSocketClient(
            pairingStore = pairingStore,
            statusProvider = { deviceStatusMonitor.readCurrentStatus() },
            onFindMyPhoneCommand = { action ->
                when (action) {
                    "START_RINGING" -> ringPhoneController.startRinging()
                    "STOP_RINGING" -> ringPhoneController.stopRinging()
                }
            },
            onClipboardReceived = { content ->
                clipboardSyncManager.applyRemoteClipboard(content)
            },
            onFileOfferReceived = { offer ->
                fileTransferManager.handleIncomingOffer(offer)
            },
            onNotificationReplyReceived = { key, replyText ->
                NexusNotificationListenerService.replyToNotification(key, replyText)
            },
            onNotificationDismissReceived = { key ->
                NexusNotificationListenerService.dismissNotification(key)
            },
            onInputFocusStateReceived = { focusState ->
                if (focusState.activeTarget.equals("ANDROID", ignoreCase = true)) {
                    NexusAccessibilityService.showRemoteCursor(
                        focusState.entryEdge,
                        focusState.normalizedPosition
                    )
                } else {
                    NexusAccessibilityService.hideRemoteCursor()
                }
            }
        )

        udpInputReceiver = UdpInputReceiver(
            sessionSecretProvider = { webSocketClient.activeSessionSecret() },
            onEventReceived = { event ->
                NexusAccessibilityService.dispatchUdpInput(event)
            }
        )
        udpInputReceiver.start()

        startForeground(NOTIFICATION_ID, buildNotification("Initialisation du lien local…", false))

        serviceScope.launch {
            var wasConnected = false
            webSocketClient.connectionState.collect { state ->
                val isNowConnected = state is ConnectionState.Connected
                if (isNowConnected && !wasConnected) {
                    NexusNotificationListenerService.syncActiveNotifications()
                } else if (!isNowConnected && wasConnected) {
                    NexusAccessibilityService.hideRemoteCursor()
                }
                wasConnected = isNowConnected
            }
        }

        serviceScope.launch {
            combine(
                webSocketClient.connectionState,
                ringPhoneController.isRinging
            ) { state, ringing ->
                val statusText = when {
                    ringing -> "Sonnerie en cours (« Trouver mon téléphone »)"
                    state is ConnectionState.Connected -> "Connecté à ${state.pcName}"
                    state is ConnectionState.WaitingApproval -> "Confirmation requise sur ${state.pcName}…"
                    state is ConnectionState.Connecting -> "Connexion à ${state.targetHost}…"
                    state is ConnectionState.Error -> "Connexion interrompue"
                    else -> "En attente de liaison locale"
                }
                statusText to ringing
            }.collect { (text, ringing) ->
                updateNotification(text, ringing)
            }
        }

        deviceStatusMonitor.start()
        screenshotObserver.start()
        nsdDiscoveryManager.startDiscovery()
        webSocketClient.connectToSavedPeer()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP_SERVICE -> {
                ringPhoneController.stopRinging()
                webSocketClient.disconnect(disableReconnect = true)
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_STOP_RINGING -> {
                ringPhoneController.stopRinging()
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onDestroy() {
        activeInstance = null
        ringPhoneController.stopRinging()
        NexusAccessibilityService.hideRemoteCursor()
        udpInputReceiver.stop()
        screenshotObserver.stop()
        deviceStatusMonitor.stop()
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
        ringPhoneController.stopRinging()
        webSocketClient.disconnect(disableReconnect = true)
        pairingStore.clearSavedPeer()
    }

    fun restartDiscovery() {
        nsdDiscoveryManager.stopDiscovery()
        nsdDiscoveryManager.startDiscovery()
    }

    fun stopRinging() {
        ringPhoneController.stopRinging()
    }

    fun syncLocalClipboardToPc(focusedContext: android.content.Context = this) {
        if (connectionState.value is ConnectionState.Connected) {
            clipboardSyncManager.syncLocalClipboardToPc(focusedContext)
        }
    }

    fun sendFiles(uris: List<Uri>) {
        if (connectionState.value is ConnectionState.Connected) {
            fileTransferManager.uploadFiles(uris)
        }
    }

    private fun showFileReceivedNotification(fileName: String) {
        val manager = getSystemService(NotificationManager::class.java)
        val notif = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Fichier reçu via NexusLink")
            .setContentText("$fileName enregistré dans Téléchargements/NexusLink")
            .setAutoCancel(true)
            .build()
        manager.notify(FILE_NOTIFICATION_ID, notif)
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

    private fun buildNotification(contentText: String, isRinging: Boolean): Notification {
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

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("NexusLink")
            .setContentText(contentText)
            .setOngoing(true)
            .setContentIntent(openAppIntent)

        if (isRinging) {
            val stopRingIntent = PendingIntent.getService(
                this,
                2,
                Intent(this, ConnectionForegroundService::class.java).apply {
                    action = ACTION_STOP_RINGING
                },
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            builder.addAction(0, "Couper la sonnerie", stopRingIntent)
        }

        return builder
            .addAction(0, "Arrêter", stopIntent)
            .build()
    }

    private fun updateNotification(contentText: String, isRinging: Boolean) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, buildNotification(contentText, isRinging))
    }

    companion object {
        private const val CHANNEL_ID = "nexuslink_connection_channel"
        private const val NOTIFICATION_ID = 1001
        private const val FILE_NOTIFICATION_ID = 1002
        const val ACTION_STOP_SERVICE = "com.nexuslink.android.ACTION_STOP_SERVICE"
        const val ACTION_STOP_RINGING = "com.nexuslink.android.ACTION_STOP_RINGING"

        @Volatile
        private var activeInstance: java.lang.ref.WeakReference<ConnectionForegroundService>? = null

        fun isConnected(): Boolean {
            return activeInstance?.get()?.connectionState?.value is ConnectionState.Connected
        }

        fun syncClipboardFromAccessibility(focusedContext: android.content.Context) {
            activeInstance?.get()?.syncLocalClipboardToPc(focusedContext)
        }

        fun sendFilesFromShare(uris: List<Uri>) {
            activeInstance?.get()?.sendFiles(uris)
        }

        fun sendNotificationPosted(notification: NotificationPostedPayload) {
            activeInstance?.get()?.webSocketClient?.sendNotificationPosted(notification)
        }

        fun sendNotificationRemoved(notificationKey: String) {
            activeInstance?.get()?.webSocketClient?.sendNotificationRemoved(notificationKey)
        }

        fun notifyReturnFocusToPc() {
            activeInstance?.get()?.webSocketClient?.sendInputFocusState("PC")
        }
    }
}
