package com.nexuslink.android.data

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import com.nexuslink.android.protocol.DiscoveredDesktopHost
import com.nexuslink.android.protocol.PairingQrPayload
import java.util.UUID

/**
 * Informations persistées sur le PC associé
 */
data class SavedDesktopPeer(
    val deviceId: String,
    val deviceName: String,
    val hostAddress: String,
    val wsPort: Int,
    val udpPort: Int,
    val httpPort: Int,
    val pairingToken: String?,
    val sessionSecret: String?
)

/**
 * Gestionnaire de persistance locale pour l'identifiant du téléphone et le PC associé
 */
class PairingStore(context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences(
        PREFS_NAME,
        Context.MODE_PRIVATE
    )

    /**
     * Renvoie l'identifiant unique persistant de ce téléphone Android
     */
    fun getOrCreateAndroidDeviceId(): String {
        val existing = prefs.getString(KEY_ANDROID_DEVICE_ID, null)
        if (!existing.isNullOrBlank()) {
            return existing
        }
        val generated = UUID.randomUUID().toString()
        prefs.edit().putString(KEY_ANDROID_DEVICE_ID, generated).apply()
        return generated
    }

    /**
     * Renvoie le nom lisible du téléphone Android (ex: "Google Pixel 8 Pro")
     */
    fun getAndroidDeviceName(): String {
        val manufacturer = Build.MANUFACTURER?.replaceFirstChar { it.uppercase() }.orEmpty()
        val model = Build.MODEL.orEmpty()
        return if (model.startsWith(manufacturer, ignoreCase = true)) {
            model
        } else {
            "$manufacturer $model".trim()
        }
    }

    /**
     * Enregistre les informations issues du QR Code d'appairage du PC
     */
    fun savePairingQrPayload(qrPayload: PairingQrPayload, selectedHost: String? = null) {
        val primaryAddress = selectedHost
            ?: qrPayload.addresses.firstOrNull()
            ?: "127.0.0.1"

        prefs.edit()
            .putString(KEY_PC_DEVICE_ID, qrPayload.deviceId)
            .putString(KEY_PC_DEVICE_NAME, qrPayload.deviceName)
            .putString(KEY_PC_HOST_ADDRESS, primaryAddress)
            .putInt(KEY_PC_WS_PORT, qrPayload.wsPort)
            .putInt(KEY_PC_UDP_PORT, qrPayload.udpPort)
            .putInt(KEY_PC_HTTP_PORT, qrPayload.httpPort)
            .putString(KEY_PAIRING_TOKEN, qrPayload.pairingToken)
            .apply()
    }

    /**
     * Enregistre un PC sélectionné dans la liste locale (appairage manuel sans QR Code)
     */
    fun saveManualPeer(host: DiscoveredDesktopHost) {
        prefs.edit()
            .putString(KEY_PC_DEVICE_ID, host.serviceName)
            .putString(KEY_PC_DEVICE_NAME, host.deviceName)
            .putString(KEY_PC_HOST_ADDRESS, host.hostAddress)
            .putInt(KEY_PC_WS_PORT, host.wsPort)
            .putInt(KEY_PC_UDP_PORT, host.udpPort)
            .putInt(KEY_PC_HTTP_PORT, host.httpPort)
            .remove(KEY_PAIRING_TOKEN)
            .remove(KEY_SESSION_SECRET)
            .apply()
    }

    /**
     * Met à jour le secret de session reçu après acceptation de l'appairage par le PC
     */
    fun updateSessionSecret(pcName: String, sessionSecret: String) {
        prefs.edit()
            .putString(KEY_PC_DEVICE_NAME, pcName)
            .putString(KEY_SESSION_SECRET, sessionSecret)
            .apply()
    }

    /**
     * Récupère la configuration du PC associé s'il existe
     */
    fun getSavedDesktopPeer(): SavedDesktopPeer? {
        val hostAddress = prefs.getString(KEY_PC_HOST_ADDRESS, null) ?: return null
        val pairingToken = prefs.getString(KEY_PAIRING_TOKEN, null)
        val sessionSecret = prefs.getString(KEY_SESSION_SECRET, null)
        if (pairingToken == null && sessionSecret == null) return null

        return SavedDesktopPeer(
            deviceId = prefs.getString(KEY_PC_DEVICE_ID, "") ?: "",
            deviceName = prefs.getString(KEY_PC_DEVICE_NAME, "PC-NexusLink") ?: "PC-NexusLink",
            hostAddress = hostAddress,
            wsPort = prefs.getInt(KEY_PC_WS_PORT, 52840),
            udpPort = prefs.getInt(KEY_PC_UDP_PORT, 52841),
            httpPort = prefs.getInt(KEY_PC_HTTP_PORT, 52842),
            pairingToken = pairingToken,
            sessionSecret = sessionSecret
        )
    }

    /**
     * Supprime l'association actuelle avec le PC
     */
    fun clearSavedPeer() {
        prefs.edit()
            .remove(KEY_PC_DEVICE_ID)
            .remove(KEY_PC_DEVICE_NAME)
            .remove(KEY_PC_HOST_ADDRESS)
            .remove(KEY_PC_WS_PORT)
            .remove(KEY_PC_UDP_PORT)
            .remove(KEY_PC_HTTP_PORT)
            .remove(KEY_PAIRING_TOKEN)
            .remove(KEY_SESSION_SECRET)
            .apply()
    }

    companion object {
        private const val PREFS_NAME = "nexuslink_pairing_prefs"
        private const val KEY_ANDROID_DEVICE_ID = "android_device_id"
        private const val KEY_PC_DEVICE_ID = "pc_device_id"
        private const val KEY_PC_DEVICE_NAME = "pc_device_name"
        private const val KEY_PC_HOST_ADDRESS = "pc_host_address"
        private const val KEY_PC_WS_PORT = "pc_ws_port"
        private const val KEY_PC_UDP_PORT = "pc_udp_port"
        private const val KEY_PC_HTTP_PORT = "pc_http_port"
        private const val KEY_PAIRING_TOKEN = "pairing_token"
        private const val KEY_SESSION_SECRET = "session_secret"
    }
}
