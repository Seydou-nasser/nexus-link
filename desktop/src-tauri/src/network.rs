use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::{SinkExt, StreamExt};
use local_ip_address::list_afinet_netifas;
use mdns_sd::{ServiceDaemon, ServiceInfo};
use qrcode::render::svg;
use qrcode::QrCode;
use tauri::{AppHandle, Emitter};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

use crate::protocol::{
    ConnectedDevice, DeviceStatusPayload, PairingQrPayload, PairingRequestPayload,
    PairingResponsePayload, ServerStatus, WsEnvelope,
};

pub const DEFAULT_WS_PORT: u16 = 52840;
pub const DEFAULT_UDP_PORT: u16 = 52841;
pub const DEFAULT_HTTP_PORT: u16 = 52842;

/// État interne partagé du moteur réseau Rust
pub struct NetworkState {
    pub device_id: String,
    pub device_name: String,
    pub local_ips: Vec<String>,
    pub ws_port: u16,
    pub udp_port: u16,
    pub http_port: u16,
    pub pairing_token: String,
    pub session_secret: String,
    pub mdns_active: bool,
    pub ws_listening: bool,
    pub connected_device: Option<ConnectedDevice>,
}

impl NetworkState {
    pub fn new() -> Self {
        let device_id = Uuid::new_v4().to_string();
        let device_name = hostname::get()
            .ok()
            .and_then(|h| h.into_string().ok())
            .unwrap_or_else(|| "PC-NexusLink".to_string());
        let local_ips = detect_local_ipv4_addresses();
        let pairing_token = generate_hex_token();
        let session_secret = generate_hex_token();

        Self {
            device_id,
            device_name,
            local_ips,
            ws_port: DEFAULT_WS_PORT,
            udp_port: DEFAULT_UDP_PORT,
            http_port: DEFAULT_HTTP_PORT,
            pairing_token,
            session_secret,
            mdns_active: false,
            ws_listening: false,
            connected_device: None,
        }
    }

    /// Construit l'état complet sérialisable avec le QR Code SVG à jour
    pub fn to_server_status(&self) -> ServerStatus {
        let qr_payload = PairingQrPayload {
            version: 1,
            device_id: self.device_id.clone(),
            device_name: self.device_name.clone(),
            addresses: self.local_ips.clone(),
            ws_port: self.ws_port,
            udp_port: self.udp_port,
            http_port: self.http_port,
            pairing_token: self.pairing_token.clone(),
        };

        let qr_raw_json = serde_json::to_string(&qr_payload).unwrap_or_default();
        let qr_svg = generate_qr_svg(&qr_raw_json);

        ServerStatus {
            device_id: self.device_id.clone(),
            device_name: self.device_name.clone(),
            local_ips: self.local_ips.clone(),
            ws_port: self.ws_port,
            udp_port: self.udp_port,
            http_port: self.http_port,
            pairing_token: self.pairing_token.clone(),
            qr_svg,
            qr_raw_json,
            mdns_active: self.mdns_active,
            ws_listening: self.ws_listening,
            connected_device: self.connected_device.clone(),
        }
    }
}

/// Détecte toutes les adresses IPv4 locales non-loopback de la machine
pub fn detect_local_ipv4_addresses() -> Vec<String> {
    let mut ips = Vec::new();
    if let Ok(interfaces) = list_afinet_netifas() {
        for (_name, ip) in interfaces {
            if ip.is_ipv4() && !ip.is_loopback() {
                let ip_str = ip.to_string();
                // Ignore les adresses APIPA (169.254.x.x)
                if !ip_str.starts_with("169.254.") && !ips.contains(&ip_str) {
                    ips.push(ip_str);
                }
            }
        }
    }
    if ips.is_empty() {
        ips.push("127.0.0.1".to_string());
    }
    ips
}

/// Génère un jeton hexadécimal aléatoire de 64 caractères (256 bits)
pub fn generate_hex_token() -> String {
    format!(
        "{}{}",
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    )
}

/// Génère une image SVG à partir de la chaîne JSON d'appairage
fn generate_qr_svg(content: &str) -> String {
    match QrCode::new(content.as_bytes()) {
        Ok(code) => code
            .render()
            .min_dimensions(240, 240)
            .dark_color(svg::Color("#0f172a"))
            .light_color(svg::Color("#ffffff"))
            .build(),
        Err(_) => String::new(),
    }
}

/// Publie le service `_nexuslink._tcp.local.` via mDNS sur le réseau local
pub fn start_mdns_advertisement(state: Arc<Mutex<NetworkState>>, app_handle: AppHandle) {
    let (device_id, device_name, ws_port, udp_port, local_ips) = {
        let guard = state.lock().unwrap();
        (
            guard.device_id.clone(),
            guard.device_name.clone(),
            guard.ws_port,
            guard.udp_port,
            guard.local_ips.clone(),
        )
    };

    if let Ok(mdns) = ServiceDaemon::new() {
        let service_type = "_nexuslink._tcp.local.";
        let instance_name = format!("NexusLink-{}", device_name);
        let host_name = format!("{}.local.", device_name.to_lowercase().replace(' ', "-"));
        let ip_list = local_ips.join(",");
        let properties = [
            ("version", "1".to_string()),
            ("device_id", device_id),
            ("device_name", device_name),
            ("udp_port", udp_port.to_string()),
        ];

        if let Ok(service_info) = ServiceInfo::new(
            service_type,
            &instance_name,
            &host_name,
            &ip_list,
            ws_port,
            &properties[..],
        ) {
            if mdns.register(service_info).is_ok() {
                {
                    let mut guard = state.lock().unwrap();
                    guard.mdns_active = true;
                }
                emit_status_update(&state, &app_handle);
            }
        }
    }
}

/// Démarre le serveur WebSocket local pour l'appairage et les événements temps réel
pub async fn start_websocket_server(state: Arc<Mutex<NetworkState>>, app_handle: AppHandle) {
    let ws_port = {
        let guard = state.lock().unwrap();
        guard.ws_port
    };

    let bind_addr = format!("0.0.0.0:{}", ws_port);
    let listener = match TcpListener::bind(&bind_addr).await {
        Ok(l) => {
            {
                let mut guard = state.lock().unwrap();
                guard.ws_listening = true;
            }
            emit_status_update(&state, &app_handle);
            l
        }
        Err(err) => {
            eprintln!("Erreur lors de l'ouverture du port WebSocket {}: {}", bind_addr, err);
            return;
        }
    };

    while let Ok((stream, peer_addr)) = listener.accept().await {
        let peer_state = Arc::clone(&state);
        let peer_app = app_handle.clone();
        tokio::spawn(async move {
            handle_ws_connection(stream, peer_addr, peer_state, peer_app).await;
        });
    }
}

/// Gère une connexion WebSocket entrante depuis un appareil Android
async fn handle_ws_connection(
    stream: TcpStream,
    peer_addr: SocketAddr,
    state: Arc<Mutex<NetworkState>>,
    app_handle: AppHandle,
) {
    // Désactive l'algorithme de Nagle pour réduire la latence des messages
    let _ = stream.set_nodelay(true);

    let ws_stream = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(_) => return,
    };

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();
    let mut is_authenticated = false;

    while let Some(Ok(msg)) = ws_receiver.next().await {
        if let Message::Text(text) = msg {
            let envelope: WsEnvelope = match serde_json::from_str(&text) {
                Ok(env) => env,
                Err(_) => continue,
            };

            match envelope.message_type.as_str() {
                "PAIRING_REQUEST" => {
                    if let Ok(req) =
                        serde_json::from_value::<PairingRequestPayload>(envelope.payload)
                    {
                        let (accepted, pc_name, session_secret) = {
                            let mut guard = state.lock().unwrap();
                            if req.pairing_token == guard.pairing_token {
                                is_authenticated = true;
                                guard.connected_device = Some(ConnectedDevice {
                                    device_id: req.device_id,
                                    device_name: req.device_name,
                                    model: req.model,
                                    android_version: req.android_version,
                                    ip_address: peer_addr.ip().to_string(),
                                    battery_level: 100,
                                    is_charging: false,
                                    ringer_mode: "NORMAL".to_string(),
                                    screen_awake: true,
                                    connected_at: current_time_label(),
                                });
                                (true, guard.device_name.clone(), guard.session_secret.clone())
                            } else {
                                (false, guard.device_name.clone(), String::new())
                            }
                        };

                        let response_payload = PairingResponsePayload {
                            accepted,
                            session_secret,
                            pc_name,
                            error_message: if accepted {
                                None
                            } else {
                                Some("Jeton d'appairage invalide".to_string())
                            },
                        };

                        let response_envelope = WsEnvelope {
                            id: Uuid::new_v4().to_string(),
                            timestamp: current_epoch_millis(),
                            message_type: "PAIRING_RESPONSE".to_string(),
                            payload: serde_json::to_value(response_payload).unwrap_or_default(),
                        };

                        if let Ok(resp_json) = serde_json::to_string(&response_envelope) {
                            let _ = ws_sender.send(Message::Text(resp_json.into())).await;
                        }

                        if accepted {
                            emit_status_update(&state, &app_handle);
                        } else {
                            break;
                        }
                    }
                }
                "DEVICE_STATUS_UPDATE" if is_authenticated => {
                    if let Ok(status_update) =
                        serde_json::from_value::<DeviceStatusPayload>(envelope.payload)
                    {
                        {
                            let mut guard = state.lock().unwrap();
                            if let Some(ref mut device) = guard.connected_device {
                                device.battery_level = status_update.battery_level;
                                device.is_charging = status_update.is_charging;
                                device.ringer_mode = status_update.ringer_mode;
                                device.screen_awake = status_update.screen_awake;
                            }
                        }
                        emit_status_update(&state, &app_handle);
                    }
                }
                _ => {}
            }
        }
    }

    // Si la connexion d'un appareil authentifié se ferme, on met à jour le statut
    if is_authenticated {
        {
            let mut guard = state.lock().unwrap();
            guard.connected_device = None;
        }
        emit_status_update(&state, &app_handle);
    }
}

/// Émet l'état mis à jour du serveur vers l'interface React
pub fn emit_status_update(state: &Arc<Mutex<NetworkState>>, app_handle: &AppHandle) {
    let status = {
        let guard = state.lock().unwrap();
        guard.to_server_status()
    };
    let _ = app_handle.emit("nexus://state-updated", status);
}

pub fn current_epoch_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn current_time_label() -> String {
    let secs = (current_epoch_millis() / 1000) % 86400;
    let hours = (secs / 3600) % 24;
    let minutes = (secs % 3600) / 60;
    let seconds = secs % 60;
    format!("{:02}:{:02}:{:02} UTC", hours, minutes, seconds)
}
