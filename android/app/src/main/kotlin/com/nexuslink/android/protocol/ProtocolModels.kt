package com.nexuslink.android.protocol

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * Données encodées dans le QR Code d'appairage affiché par l'application PC
 */
@Serializable
data class PairingQrPayload(
    val version: Int = 1,
    val deviceId: String,
    val deviceName: String,
    val addresses: List<String>,
    val wsPort: Int = 52840,
    val udpPort: Int = 52841,
    val httpPort: Int = 52842,
    val pairingToken: String
)

/**
 * Enveloppe standard de tous les messages JSON échangés sur le canal WebSocket
 */
@Serializable
data class WsEnvelope(
    val id: String,
    val timestamp: Long,
    @SerialName("type")
    val messageType: String,
    val payload: JsonElement
)

/**
 * Charge utile envoyée par Android au PC lors de la demande d'appairage (QR, MANUEL ou RECONNECT)
 */
@Serializable
data class PairingRequestPayload(
    val mode: String = "QR",
    val pairingToken: String? = null,
    val sessionSecret: String? = null,
    val verificationCode: String? = null,
    val deviceId: String,
    val deviceName: String,
    val model: String,
    val androidVersion: String
)

/**
 * Réponse envoyée par le PC après vérification du jeton d'appairage
 */
@Serializable
data class PairingResponsePayload(
    val accepted: Boolean,
    val sessionSecret: String,
    val pcName: String,
    val errorMessage: String? = null
)

/**
 * Mise à jour de l'état de la batterie et du téléphone envoyée par Android au PC
 */
@Serializable
data class DeviceStatusPayload(
    val batteryLevel: Int,
    val isCharging: Boolean,
    val ringerMode: String,
    val screenAwake: Boolean
)

/**
 * Représente un PC découvert sur le réseau local via mDNS (_nexuslink._tcp.)
 */
data class DiscoveredDesktopHost(
    val serviceName: String,
    val deviceName: String,
    val hostAddress: String,
    val wsPort: Int,
    val udpPort: Int = 52841
)
