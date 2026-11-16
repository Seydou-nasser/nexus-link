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

/// Charge utile envoyée par Android lors de la demande d'appairage initial
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingRequestPayload {
    pub pairing_token: String,
    pub device_id: String,
    pub device_name: String,
    pub model: String,
    pub android_version: String,
}

/// Réponse envoyée par le PC après vérification du jeton d'appairage
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
