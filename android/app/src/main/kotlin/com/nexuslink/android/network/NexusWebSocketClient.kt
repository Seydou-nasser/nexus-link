package com.nexuslink.android.network

import android.os.Build
import android.util.Log
import com.nexuslink.android.data.PairingStore
import com.nexuslink.android.data.SavedDesktopPeer
import com.nexuslink.android.protocol.ClipboardSyncPayload
import com.nexuslink.android.protocol.DeviceStatusPayload
import com.nexuslink.android.protocol.DiscoveredDesktopHost
import com.nexuslink.android.protocol.FileTransferOfferPayload
import com.nexuslink.android.protocol.FindMyPhonePayload
import com.nexuslink.android.protocol.InputFocusStatePayload
import com.nexuslink.android.protocol.NotificationDismissPayload
import com.nexuslink.android.protocol.NotificationPostedPayload
import com.nexuslink.android.protocol.NotificationRemovedPayload
import com.nexuslink.android.protocol.NotificationReplyPayload
import com.nexuslink.android.protocol.PairingRequestPayload
import com.nexuslink.android.protocol.PairingResponsePayload
import com.nexuslink.android.protocol.ScreenMirrorCommandPayload
import com.nexuslink.android.protocol.ScreenMirrorStatePayload
import com.nexuslink.android.protocol.WsEnvelope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.random.Random

sealed class ConnectionState {
    data object Disconnected : ConnectionState()
    data class Connecting(val targetHost: String) : ConnectionState()
    data class WaitingApproval(val pcName: String, val verificationCode: String) : ConnectionState()
    data class Connected(val pcName: String, val hostAddress: String) : ConnectionState()
    data class Error(val message: String) : ConnectionState()
}

/**
 * Client WebSocket OkHttp gérant l'appairage (QR, Manuel avec code 6 chiffres, Reconnexion) et la reconnexion automatique.
 */
class NexusWebSocketClient(
    private val pairingStore: PairingStore,
    private val statusProvider: () -> DeviceStatusPayload,
    private val onFindMyPhoneCommand: (String) -> Unit = {},
    private val onClipboardReceived: (String) -> Unit = {},
    private val onFileOfferReceived: (FileTransferOfferPayload) -> Unit = {},
    private val onNotificationReplyReceived: (String, String) -> Unit = { _, _ -> },
    private val onNotificationDismissReceived: (String) -> Unit = {},
    private val onInputFocusStateReceived: (InputFocusStatePayload) -> Unit = {},
    private val onScreenMirrorCommandReceived: (String) -> Unit = {}
) {
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    private val okHttpClient = OkHttpClient.Builder()
        .pingInterval(15, TimeUnit.SECONDS)
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private var webSocket: WebSocket? = null
    private var reconnectJob: Job? = null
    private var shouldAutoReconnect = false
    private var currentPeer: SavedDesktopPeer? = null

    private val _connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    fun connectToSavedPeer() {
        val peer = pairingStore.getSavedDesktopPeer() ?: return
        connect(peer)
    }

    fun connect(peer: SavedDesktopPeer) {
        shouldAutoReconnect = true
        currentPeer = peer
        reconnectJob?.cancel()
        openSocket(peer, manualVerificationCode = null)
    }

    fun connectManual(host: DiscoveredDesktopHost) {
        pairingStore.saveManualPeer(host)
        val peer = SavedDesktopPeer(
            deviceId = host.serviceName,
            deviceName = host.deviceName,
            hostAddress = host.hostAddress,
            wsPort = host.wsPort,
            udpPort = host.udpPort,
            httpPort = 52842,
            pairingToken = null,
            sessionSecret = null
        )
        shouldAutoReconnect = false
        currentPeer = peer
        reconnectJob?.cancel()
        val code = Random.nextInt(100_000, 1_000_000).toString()
        openSocket(peer, manualVerificationCode = code)
    }

    fun disconnect(disableReconnect: Boolean = true) {
        if (disableReconnect) {
            shouldAutoReconnect = false
            reconnectJob?.cancel()
        }
        webSocket?.close(1000, "Déconnexion demandée")
        webSocket = null
        _connectionState.value = ConnectionState.Disconnected
    }

    fun sendDeviceStatus(status: DeviceStatusPayload): Boolean {
        return sendEnvelope("DEVICE_STATUS_UPDATE", json.encodeToJsonElement(status))
    }

    fun sendClipboard(content: String): Boolean {
        val payload = ClipboardSyncPayload(mimeType = "text/plain", content = content)
        return sendEnvelope("CLIPBOARD_SYNC", json.encodeToJsonElement(payload))
    }

    fun sendNotificationPosted(notification: NotificationPostedPayload): Boolean {
        return sendEnvelope("NOTIFICATION_POSTED", json.encodeToJsonElement(notification))
    }

    fun sendNotificationRemoved(notificationKey: String): Boolean {
        val payload = NotificationRemovedPayload(notificationKey = notificationKey)
        return sendEnvelope("NOTIFICATION_REMOVED", json.encodeToJsonElement(payload))
    }

    fun sendInputFocusState(activeTarget: String): Boolean {
        val payload = InputFocusStatePayload(activeTarget = activeTarget)
        return sendEnvelope("INPUT_FOCUS_STATE", json.encodeToJsonElement(payload))
    }

    fun sendScreenMirrorState(
        state: String,
        width: Int = 0,
        height: Int = 0,
        errorMessage: String? = null
    ): Boolean {
        val payload = ScreenMirrorStatePayload(
            state = state,
            width = width,
            height = height,
            errorMessage = errorMessage
        )
        return sendEnvelope("SCREEN_MIRROR_STATE", json.encodeToJsonElement(payload))
    }

    fun activeSessionSecret(): String? {
        return currentPeer?.sessionSecret ?: pairingStore.getSavedDesktopPeer()?.sessionSecret
    }

    fun activeHttpPeerInfo(): Triple<String, Int, String>? {
        val peer = currentPeer ?: pairingStore.getSavedDesktopPeer() ?: return null
        val secret = peer.sessionSecret ?: return null
        return Triple(peer.hostAddress, peer.httpPort, secret)
    }

    private fun openSocket(peer: SavedDesktopPeer, manualVerificationCode: String?) {
        webSocket?.cancel()
        _connectionState.value = ConnectionState.Connecting(peer.deviceName)

        val url = "ws://${peer.hostAddress}:${peer.wsPort}/ws"
        val request = Request.Builder().url(url).build()

        webSocket = okHttpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                Log.d(TAG, "WebSocket ouvert vers $url, envoi de PAIRING_REQUEST")

                val mode = when {
                    !peer.sessionSecret.isNullOrBlank() -> "RECONNECT"
                    !peer.pairingToken.isNullOrBlank() -> "QR"
                    else -> "MANUAL"
                }

                if (mode == "MANUAL" && manualVerificationCode != null) {
                    _connectionState.value = ConnectionState.WaitingApproval(
                        pcName = peer.deviceName,
                        verificationCode = manualVerificationCode
                    )
                }

                val pairingReq = PairingRequestPayload(
                    mode = mode,
                    pairingToken = peer.pairingToken,
                    sessionSecret = peer.sessionSecret,
                    verificationCode = manualVerificationCode,
                    deviceId = pairingStore.getOrCreateAndroidDeviceId(),
                    deviceName = pairingStore.getAndroidDeviceName(),
                    model = Build.MODEL ?: "Android",
                    androidVersion = Build.VERSION.RELEASE ?: "10+"
                )
                val envelope = WsEnvelope(
                    id = UUID.randomUUID().toString(),
                    timestamp = System.currentTimeMillis(),
                    messageType = "PAIRING_REQUEST",
                    payload = json.encodeToJsonElement(pairingReq)
                )
                ws.send(json.encodeToString(envelope))
            }

            override fun onMessage(ws: WebSocket, text: String) {
                handleIncomingMessage(text, peer)
            }

            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                ws.close(1000, null)
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket fermé ($code : $reason)")
                handleDisconnect(peer)
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "Erreur WebSocket : ${t.message}", t)
                _connectionState.value = ConnectionState.Error(
                    t.localizedMessage ?: "Connexion impossible vers ${peer.deviceName}"
                )
                scheduleReconnect(peer)
            }
        })
    }

    private fun handleIncomingMessage(rawJson: String, peer: SavedDesktopPeer) {
        val envelope = try {
            json.decodeFromString<WsEnvelope>(rawJson)
        } catch (e: Exception) {
            Log.w(TAG, "Message WebSocket ignoré (JSON invalide)", e)
            return
        }

        when (envelope.messageType) {
            "PAIRING_RESPONSE" -> {
                val resp = try {
                    json.decodeFromJsonElement<PairingResponsePayload>(envelope.payload)
                } catch (e: Exception) {
                    Log.e(TAG, "Impossible de décoder PAIRING_RESPONSE", e)
                    return
                }

                if (resp.accepted) {
                    pairingStore.updateSessionSecret(resp.pcName, resp.sessionSecret)
                    currentPeer = peer.copy(
                        deviceName = resp.pcName,
                        sessionSecret = resp.sessionSecret
                    )
                    shouldAutoReconnect = true
                    _connectionState.value = ConnectionState.Connected(
                        pcName = resp.pcName,
                        hostAddress = peer.hostAddress
                    )
                    sendDeviceStatus(statusProvider())
                } else {
                    shouldAutoReconnect = false
                    pairingStore.clearSavedPeer()
                    _connectionState.value = ConnectionState.Error(
                        resp.errorMessage ?: "Demande refusée par l'ordinateur"
                    )
                    webSocket?.close(1000, "Refusé")
                    webSocket = null
                }
            }
            "PEER_UNPAIRED" -> {
                Log.d(TAG, "Déconnexion demandée par le PC (PEER_UNPAIRED)")
                shouldAutoReconnect = false
                reconnectJob?.cancel()
                pairingStore.clearSavedPeer()
                currentPeer = null
                _connectionState.value = ConnectionState.Disconnected
                webSocket?.close(1000, "Déconnecté depuis l'ordinateur")
                webSocket = null
            }
            "FIND_MY_PHONE_COMMAND" -> {
                val cmd = try {
                    json.decodeFromJsonElement<FindMyPhonePayload>(envelope.payload)
                } catch (e: Exception) {
                    Log.w(TAG, "Impossible de décoder FIND_MY_PHONE_COMMAND", e)
                    return
                }
                onFindMyPhoneCommand(cmd.action)
            }
            "CLIPBOARD_SYNC" -> {
                val clip = try {
                    json.decodeFromJsonElement<ClipboardSyncPayload>(envelope.payload)
                } catch (e: Exception) {
                    Log.w(TAG, "Impossible de décoder CLIPBOARD_SYNC", e)
                    return
                }
                onClipboardReceived(clip.content)
            }
            "FILE_TRANSFER_OFFER" -> {
                val offer = try {
                    json.decodeFromJsonElement<FileTransferOfferPayload>(envelope.payload)
                } catch (e: Exception) {
                    Log.w(TAG, "Impossible de décoder FILE_TRANSFER_OFFER", e)
                    return
                }
                onFileOfferReceived(offer)
            }
            "NOTIFICATION_REPLY" -> {
                val reply = try {
                    json.decodeFromJsonElement<NotificationReplyPayload>(envelope.payload)
                } catch (e: Exception) {
                    Log.w(TAG, "Impossible de décoder NOTIFICATION_REPLY", e)
                    return
                }
                onNotificationReplyReceived(reply.notificationKey, reply.replyText)
            }
            "NOTIFICATION_DISMISS" -> {
                val dismiss = try {
                    json.decodeFromJsonElement<NotificationDismissPayload>(envelope.payload)
                } catch (e: Exception) {
                    Log.w(TAG, "Impossible de décoder NOTIFICATION_DISMISS", e)
                    return
                }
                onNotificationDismissReceived(dismiss.notificationKey)
            }
            "INPUT_FOCUS_STATE" -> {
                val focusState = try {
                    json.decodeFromJsonElement<InputFocusStatePayload>(envelope.payload)
                } catch (e: Exception) {
                    Log.w(TAG, "Impossible de décoder INPUT_FOCUS_STATE", e)
                    return
                }
                onInputFocusStateReceived(focusState)
            }
            "SCREEN_MIRROR_COMMAND" -> {
                val cmd = try {
                    json.decodeFromJsonElement<ScreenMirrorCommandPayload>(envelope.payload)
                } catch (e: Exception) {
                    Log.w(TAG, "Impossible de décoder SCREEN_MIRROR_COMMAND", e)
                    return
                }
                onScreenMirrorCommandReceived(cmd.action)
            }
            else -> {
                Log.d(TAG, "Message reçu : ${envelope.messageType}")
            }
        }
    }

    private fun handleDisconnect(peer: SavedDesktopPeer) {
        if (_connectionState.value !is ConnectionState.Error) {
            _connectionState.value = ConnectionState.Disconnected
        }
        scheduleReconnect(peer)
    }

    private fun scheduleReconnect(peer: SavedDesktopPeer) {
        if (!shouldAutoReconnect) return
        val latestPeer = pairingStore.getSavedDesktopPeer() ?: peer
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(RECONNECT_DELAY_MS)
            if (shouldAutoReconnect && currentPeer?.hostAddress == latestPeer.hostAddress) {
                Log.d(TAG, "Tentative de reconnexion automatique vers ${latestPeer.deviceName}...")
                openSocket(latestPeer, manualVerificationCode = null)
            }
        }
    }

    private fun sendEnvelope(type: String, payload: kotlinx.serialization.json.JsonElement): Boolean {
        val ws = webSocket ?: return false
        val envelope = WsEnvelope(
            id = UUID.randomUUID().toString(),
            timestamp = System.currentTimeMillis(),
            messageType = type,
            payload = payload
        )
        return ws.send(json.encodeToString(envelope))
    }

    companion object {
        private const val TAG = "NexusWebSocketClient"
        private const val RECONNECT_DELAY_MS = 4000L
    }
}
