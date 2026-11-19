use serde::{Deserialize, Serialize};

/// Données encodées dans le QR Code d'appairage affiché sur le PC
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingQrPayload {
    pub version: u8,
    pub device_id: String,
    pub device_name: String,
    pub addresses: Vec<String>,
    pub ws_port: u16,
    pub udp_port: u16,
    pub http_port: u16,
    pub pairing_token: String,
}

/// Informations sur un smartphone Android connecté et appairé
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedDevice {
    pub device_id: String,
    pub device_name: String,
    pub model: String,
    pub android_version: String,
    pub ip_address: String,
    pub battery_level: u8,
    pub is_charging: bool,
    pub ringer_mode: String,
    pub screen_awake: bool,
    pub connected_at: String,
}

/// Demande d'association manuelle en attente de confirmation sur le PC
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPairingRequest {
    pub request_id: String,
    pub device_id: String,
    pub device_name: String,
    pub model: String,
    pub android_version: String,
    pub verification_code: String,
}

/// Enregistrement persisté d'un téléphone déjà appairé sur ce PC
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedDeviceRecord {
    pub device_id: String,
    pub device_name: String,
    pub model: String,
    pub session_secret: String,
}

/// État global du serveur PC renvoyé à l'interface React
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub device_id: String,
    pub device_name: String,
    pub local_ips: Vec<String>,
    pub ws_port: u16,
    pub udp_port: u16,
    pub http_port: u16,
    pub pairing_token: String,
    pub qr_svg: String,
    pub qr_raw_json: String,
    pub mdns_active: bool,
    pub ws_listening: bool,
    pub connected_device: Option<ConnectedDevice>,
    pub pending_pairing: Option<PendingPairingRequest>,
    pub input_active_target: String,
    pub input_settings: InputSettings,
    pub mirror_state: String,
    pub mirror_width: u32,
    pub mirror_height: u32,
    pub mirror_error: Option<String>,
}

/// Enveloppe générique des messages JSON échangés sur le WebSocket
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsEnvelope {
    pub id: String,
    pub timestamp: u64,
    #[serde(rename = "type")]
    pub message_type: String,
    pub payload: serde_json::Value,
}

/// Charge utile envoyée par Android lors de la demande d'appairage (QR, MANUEL ou RECONNECT)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingRequestPayload {
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub pairing_token: Option<String>,
    #[serde(default)]
    pub session_secret: Option<String>,
    #[serde(default)]
    pub verification_code: Option<String>,
    pub device_id: String,
    pub device_name: String,
    pub model: String,
    pub android_version: String,
}

/// Réponse envoyée par le PC après vérification ou confirmation utilisateur
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingResponsePayload {
    pub accepted: bool,
    pub session_secret: String,
    pub pc_name: String,
    pub error_message: Option<String>,
}

/// Mise à jour de l'état de la batterie et du téléphone envoyée par Android
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStatusPayload {
    pub battery_level: u8,
    pub is_charging: bool,
    pub ringer_mode: String,
    pub screen_awake: bool,
}

/// Charge utile de synchronisation du presse-papiers texte (PC <-> Android)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardSyncPayload {
    pub mime_type: String,
    pub content: String,
}

/// Entrée de l'historique du presse-papiers partagé affiché dans l'interface PC
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardHistoryEntry {
    pub content: String,
    pub source: String,
    pub timestamp: String,
}

/// Offre de téléchargement d'un fichier ou d'une image du presse-papiers via HTTP :52842
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTransferOfferPayload {
    pub file_id: String,
    pub file_name: String,
    pub file_size: u64,
    pub mime_type: String,
    pub purpose: String,
}

/// Enregistrement d'un transfert de fichier affiché dans l'interface PC
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTransferRecord {
    pub file_id: String,
    pub file_name: String,
    pub file_size: u64,
    pub bytes_transferred: u64,
    pub direction: String,
    pub status: String,
    pub saved_path: Option<String>,
    pub thumbnail_base64: Option<String>,
    pub timestamp: String,
}

/// Notification Android interceptée et reçue via WebSocket
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPostedPayload {
    pub notification_key: String,
    pub package_name: String,
    pub app_name: String,
    pub title: String,
    pub text: String,
    pub can_reply: bool,
    #[serde(default)]
    pub actions: Vec<String>,
    #[serde(default)]
    pub icon_base64: Option<String>,
}

/// Notification supprimée sur Android
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRemovedPayload {
    pub notification_key: String,
}

/// Réponse directe envoyée depuis le PC vers Android
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationReplyPayload {
    pub notification_key: String,
    pub reply_text: String,
}

/// Demande de suppression d'une notification envoyée depuis le PC vers Android
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationDismissPayload {
    pub notification_key: String,
}

/// Notification active stockée et affichée dans le centre de notifications PC
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneNotificationRecord {
    pub notification_key: String,
    pub package_name: String,
    pub app_name: String,
    pub title: String,
    pub text: String,
    pub can_reply: bool,
    pub actions: Vec<String>,
    pub icon_base64: Option<String>,
    pub timestamp: String,
}

/// État du focus souris/clavier échangé sur le WebSocket (PC <-> Android)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputFocusStatePayload {
    pub active_target: String,
    #[serde(default)]
    pub entry_edge: Option<String>,
    #[serde(default)]
    pub normalized_position: Option<f64>,
}

/// Configuration du basculement souris/clavier au bord de l'écran
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputSettings {
    pub enabled: bool,
    pub edge: String,
    pub edge_resistance_ms: u64,
    pub require_ctrl: bool,
}

impl Default for InputSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            edge: "RIGHT".to_string(),
            edge_resistance_ms: 120,
            require_ctrl: false,
        }
    }
}

/// Ordre de démarrage / arrêt de la recopie d'écran (PC -> Android)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenMirrorCommandPayload {
    pub action: String,
}

/// État de la recopie d'écran renvoyé par Android (Android -> PC)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenMirrorStatePayload {
    pub state: String,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    #[serde(default)]
    pub error_message: Option<String>,
}
