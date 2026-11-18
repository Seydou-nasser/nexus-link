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
 * Commande reçue du PC pour faire sonner ou arrêter la sonnerie du téléphone
 */
@Serializable
data class FindMyPhonePayload(
    val action: String
)

/**
 * Charge utile de synchronisation du presse-papiers texte (PC <-> Android)
 */
@Serializable
data class ClipboardSyncPayload(
    val mimeType: String = "text/plain",
    val content: String
)

/**
 * Offre de téléchargement d'un fichier ou d'une image du presse-papiers via HTTP :52842
 */
@Serializable
data class FileTransferOfferPayload(
    val fileId: String,
    val fileName: String,
    val fileSize: Long,
    val mimeType: String,
    val purpose: String = "FILE"
)

/**
 * Notification Android interceptée et envoyée vers le PC
 */
@Serializable
data class NotificationPostedPayload(
    val notificationKey: String,
    val packageName: String,
    val appName: String,
    val title: String,
    val text: String,
    val canReply: Boolean,
    val actions: List<String> = emptyList(),
    val iconBase64: String? = null
)

/**
 * Notification supprimée sur Android (à retirer du centre PC)
 */
@Serializable
data class NotificationRemovedPayload(
    val notificationKey: String
)

/**
 * Réponse directe à une notification envoyée depuis le PC
 */
@Serializable
data class NotificationReplyPayload(
    val notificationKey: String,
    val replyText: String
)

/**
 * Demande de suppression d'une notification depuis le PC
 */
@Serializable
data class NotificationDismissPayload(
    val notificationKey: String
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
