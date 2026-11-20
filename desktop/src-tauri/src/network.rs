use std::collections::HashMap;
use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::{SinkExt, StreamExt};
use local_ip_address::list_afinet_netifas;
use mdns_sd::{ServiceDaemon, ServiceInfo};
use qrcode::render::svg;
use qrcode::QrCode;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot, watch};
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

use crate::protocol::{
    ClipboardHistoryEntry, ClipboardSyncPayload, ConnectedDevice, DeviceStatusPayload,
    FileTransferRecord, InputFocusStatePayload, InputSettings, NotificationPostedPayload,
    NotificationRemovedPayload, PairedDeviceRecord, PairingQrPayload, PairingRequestPayload,
    PairingResponsePayload, PendingPairingRequest, PhoneNotificationRecord,
    ScreenMirrorStatePayload, ServerStatus, WsEnvelope,
};

pub const DEFAULT_WS_PORT: u16 = 52840;
pub const DEFAULT_UDP_PORT: u16 = 52841;
pub const DEFAULT_HTTP_PORT: u16 = 52842;

/// Donnée sortante en attente de téléchargement par Android via HTTP :52842
#[derive(Debug, Clone)]
pub enum OutgoingPayload {
    File(PathBuf),
    MemoryBytes { bytes: Vec<u8>, mime_type: String },
}

/// État interne partagé du moteur réseau Rust
pub struct NetworkState {
    pub device_id: String,
    pub device_name: String,
    pub local_ips: Vec<String>,
    pub ws_port: u16,
    pub udp_port: u16,
    pub http_port: u16,
    pub pairing_token: String,
    pub mdns_active: bool,
    pub ws_listening: bool,
    pub connected_device: Option<ConnectedDevice>,
    pub active_ws_tx: Option<mpsc::UnboundedSender<String>>,
    pub pending_pairing: Option<PendingPairingRequest>,
    pub pending_approvals: HashMap<String, oneshot::Sender<bool>>,
    pub paired_devices: HashMap<String, PairedDeviceRecord>,
    pub storage_path: Option<PathBuf>,
    pub last_clipboard_text: Option<String>,
    pub last_clipboard_image_hash: Option<u64>,
    pub clipboard_image_suppress_until: Option<std::time::Instant>,
    pub clipboard_history: Vec<ClipboardHistoryEntry>,
    pub outgoing_files: HashMap<String, OutgoingPayload>,
    pub file_transfers: Vec<FileTransferRecord>,
    pub notifications: Vec<PhoneNotificationRecord>,
    pub input_active_target: String,
    pub input_settings: InputSettings,
    pub mirror_state: String,
    pub mirror_width: u32,
    pub mirror_height: u32,
    pub mirror_error: Option<String>,
    pub screen_frame_tx: watch::Sender<Option<Arc<Vec<u8>>>>,
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

        let (screen_frame_tx, _) = watch::channel(None);

        Self {
            device_id,
            device_name,
            local_ips,
            ws_port: DEFAULT_WS_PORT,
            udp_port: DEFAULT_UDP_PORT,
            http_port: DEFAULT_HTTP_PORT,
            pairing_token,
            mdns_active: false,
            ws_listening: false,
            connected_device: None,
            active_ws_tx: None,
            pending_pairing: None,
            pending_approvals: HashMap::new(),
            paired_devices: HashMap::new(),
            storage_path: None,
            last_clipboard_text: None,
            last_clipboard_image_hash: None,
            clipboard_image_suppress_until: None,
            clipboard_history: Vec::new(),
            outgoing_files: HashMap::new(),
            file_transfers: Vec::new(),
            notifications: Vec::new(),
            input_active_target: "PC".to_string(),
            input_settings: InputSettings::default(),
            mirror_state: "STOPPED".to_string(),
            mirror_width: 0,
            mirror_height: 0,
            mirror_error: None,
            screen_frame_tx,
        }
    }

    /// Charge la liste des téléphones déjà appairés depuis `paired_devices.json`
    pub fn load_paired_devices(&mut self, storage_path: PathBuf) {
        self.storage_path = Some(storage_path.clone());
        if let Ok(content) = fs::read_to_string(&storage_path) {
            if let Ok(records) = serde_json::from_str::<Vec<PairedDeviceRecord>>(&content) {
                self.paired_devices.clear();
                for record in records {
                    self.paired_devices.insert(record.device_id.clone(), record);
                }
            }
        }
    }

    /// Enregistre la liste des téléphones appairés sur disque
    pub fn save_paired_devices(&self) {
        let Some(ref path) = self.storage_path else {
            return;
        };
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let records: Vec<&PairedDeviceRecord> = self.paired_devices.values().collect();
        if let Ok(json_str) = serde_json::to_string_pretty(&records) {
            let _ = fs::write(path, json_str);
        }
    }

    /// Envoie un message JSON enveloppé sur la connexion WebSocket active
    pub fn send_ws_message(&self, message_type: &str, payload: serde_json::Value) -> bool {
        let Some(ref tx) = self.active_ws_tx else {
            return false;
        };
        let envelope = WsEnvelope {
            id: Uuid::new_v4().to_string(),
            timestamp: current_epoch_millis(),
            message_type: message_type.to_string(),
            payload,
        };
        if let Ok(json_msg) = serde_json::to_string(&envelope) {
            tx.send(json_msg).is_ok()
        } else {
            false
        }
    }

    /// Déconnecte l'appareil actif, le retire des appareils mémorisés et notifie Android
    pub fn disconnect_active_device(&mut self) {
        if let Some(ref device) = self.connected_device {
            let device_id = device.device_id.clone();
            self.paired_devices.remove(&device_id);
            self.save_paired_devices();
        }
        if let Some(tx) = self.active_ws_tx.take() {
            let unpair_envelope = WsEnvelope {
                id: Uuid::new_v4().to_string(),
                timestamp: current_epoch_millis(),
                message_type: "PEER_UNPAIRED".to_string(),
                payload: serde_json::json!({}),
            };
            if let Ok(json_msg) = serde_json::to_string(&unpair_envelope) {
                let _ = tx.send(json_msg);
            }
            drop(tx);
        }
        self.connected_device = None;
        self.input_active_target = "PC".to_string();
        self.mirror_state = "STOPPED".to_string();
        self.mirror_width = 0;
        self.mirror_height = 0;
        self.mirror_error = None;
        let _ = self.screen_frame_tx.send(None);
    }

    /// Renvoie l'adresse IP, le port UDP et le secret de session du téléphone connecté
    pub fn get_active_udp_target(&self) -> Option<(String, u16, String)> {
        let device = self.connected_device.as_ref()?;
        let secret = self
            .paired_devices
            .get(&device.device_id)
            .map(|r| r.session_secret.clone())?;
        Some((device.ip_address.clone(), self.udp_port, secret))
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
            pending_pairing: self.pending_pairing.clone(),
            input_active_target: self.input_active_target.clone(),
            input_settings: self.input_settings.clone(),
            mirror_state: self.mirror_state.clone(),
            mirror_width: self.mirror_width,
            mirror_height: self.mirror_height,
            mirror_error: self.mirror_error.clone(),
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
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
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
    let _ = stream.set_nodelay(true);

    let ws_stream = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(_) => return,
    };

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
    let mut is_authenticated = false;

    loop {
        tokio::select! {
            outgoing = out_rx.recv() => {
                match outgoing {
                    Some(text) => {
                        if ws_sender.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    None => {
                        let _ = ws_sender.close().await;
                        break;
                    }
                }
            }
            incoming = ws_receiver.next() => {
                let Some(Ok(msg)) = incoming else {
                    break;
                };
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
                                let (accepted, pc_name, session_secret, error_message) =
                                    process_pairing_request(&req, peer_addr, &state, &app_handle).await;

                                is_authenticated = accepted;

                                let response_payload = PairingResponsePayload {
                                    accepted,
                                    session_secret,
                                    pc_name,
                                    error_message,
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
                                    {
                                        let mut guard = state.lock().unwrap();
                                        guard.active_ws_tx = Some(out_tx.clone());
                                    }
                                    crate::input_hook::sync_runtime_snapshot();
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
                        "CLIPBOARD_SYNC" if is_authenticated => {
                            if let Ok(clip) =
                                serde_json::from_value::<ClipboardSyncPayload>(envelope.payload)
                            {
                                crate::clipboard::apply_remote_clipboard(
                                    clip.content,
                                    &state,
                                    &app_handle,
                                );
                            }
                        }
                        "NOTIFICATION_POSTED" if is_authenticated => {
                            if let Ok(notif) =
                                serde_json::from_value::<NotificationPostedPayload>(envelope.payload)
                            {
                                crate::notifications::handle_notification_posted(
                                    notif,
                                    &state,
                                    &app_handle,
                                );
                            }
                        }
                        "NOTIFICATION_REMOVED" if is_authenticated => {
                            if let Ok(removed) =
                                serde_json::from_value::<NotificationRemovedPayload>(envelope.payload)
                            {
                                crate::notifications::handle_notification_removed(
                                    removed,
                                    &state,
                                    &app_handle,
                                );
                            }
                        }
                        "SMS_UPDATED" if is_authenticated => {
                            let _ = app_handle.emit("nexus://sms-updated", ());
                        }
                        "CALLS_UPDATED" if is_authenticated => {
                            let _ = app_handle.emit("nexus://calls-updated", ());
                        }
                        "INPUT_FOCUS_STATE" if is_authenticated => {
                            if let Ok(focus) =
                                serde_json::from_value::<InputFocusStatePayload>(envelope.payload)
                            {
                                crate::input_hook::handle_remote_focus_state(&focus.active_target);
                            }
                        }
                        "SCREEN_MIRROR_STATE" if is_authenticated => {
                            if let Ok(mirror) =
                                serde_json::from_value::<ScreenMirrorStatePayload>(envelope.payload)
                            {
                                {
                                    let mut guard = state.lock().unwrap();
                                    guard.mirror_state = mirror.state.clone();
                                    guard.mirror_width = mirror.width;
                                    guard.mirror_height = mirror.height;
                                    guard.mirror_error = mirror.error_message;
                                    if mirror.state == "STOPPED" || mirror.state == "ERROR" {
                                        let _ = guard.screen_frame_tx.send(None);
                                    }
                                }
                                emit_status_update(&state, &app_handle);
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    if is_authenticated {
        crate::input_hook::handle_remote_focus_state("PC");
        {
            let mut guard = state.lock().unwrap();
            guard.active_ws_tx = None;
            guard.connected_device = None;
            guard.input_active_target = "PC".to_string();
            guard.mirror_state = "STOPPED".to_string();
            guard.mirror_width = 0;
            guard.mirror_height = 0;
            guard.mirror_error = None;
            let _ = guard.screen_frame_tx.send(None);
        }
        crate::notifications::clear_notifications(&state, &app_handle);
        if let Some(win) = app_handle.get_webview_window("mirror") {
            let _ = win.close();
        }
        emit_status_update(&state, &app_handle);
    }
}

/// Traite une demande d'appairage (reconnexion par secret, QR Code ou demande manuelle avec code 6 chiffres)
async fn process_pairing_request(
    req: &PairingRequestPayload,
    peer_addr: SocketAddr,
    state: &Arc<Mutex<NetworkState>>,
    app_handle: &AppHandle,
) -> (bool, String, String, Option<String>) {
    let mode = req.mode.as_deref().unwrap_or("QR");

    // 1. Vérification automatique : appareil déjà mémorisé ou jeton QR valide
    let immediate_result = {
        let mut guard = state.lock().unwrap();
        let pc_name = guard.device_name.clone();

        let matched_known_device = req.session_secret.as_ref().and_then(|secret| {
            guard
                .paired_devices
                .get(&req.device_id)
                .filter(|record| &record.session_secret == secret)
                .map(|record| record.session_secret.clone())
        });

        if let Some(existing_secret) = matched_known_device {
            register_connected_device(&mut guard, req, peer_addr, &existing_secret);
            Some((true, pc_name, existing_secret, None))
        } else if req.pairing_token.as_deref() == Some(guard.pairing_token.as_str()) {
            let new_secret = generate_hex_token();
            register_connected_device(&mut guard, req, peer_addr, &new_secret);
            Some((true, pc_name, new_secret, None))
        } else if mode != "MANUAL" {
            Some((
                false,
                pc_name,
                String::new(),
                Some("Jeton d'appairage ou session invalide".to_string()),
            ))
        } else {
            None
        }
    };

    if let Some(res) = immediate_result {
        return res;
    }

    // 2. Mode MANUEL : demande de confirmation à l'utilisateur sur le PC avec code à 6 chiffres
    let request_id = Uuid::new_v4().to_string();
    let verification_code = req
        .verification_code
        .clone()
        .filter(|c| !c.trim().is_empty())
        .unwrap_or_else(|| format!("{:06}", (current_epoch_millis() % 900_000) + 100_000));

    let (tx, rx) = oneshot::channel::<bool>();

    {
        let mut guard = state.lock().unwrap();
        guard.pending_pairing = Some(PendingPairingRequest {
            request_id: request_id.clone(),
            device_id: req.device_id.clone(),
            device_name: req.device_name.clone(),
            model: req.model.clone(),
            android_version: req.android_version.clone(),
            verification_code: verification_code.clone(),
        });
        guard.pending_approvals.insert(request_id.clone(), tx);
    }

    emit_status_update(state, app_handle);
    notify_and_focus_window(app_handle, &req.device_name);

    // Attend la validation utilisateur (60 secondes max)
    let user_accepted = matches!(tokio::time::timeout(Duration::from_secs(60), rx).await, Ok(Ok(true)));

    let mut guard = state.lock().unwrap();
    guard.pending_approvals.remove(&request_id);
    if guard
        .pending_pairing
        .as_ref()
        .is_some_and(|p| p.request_id == request_id)
    {
        guard.pending_pairing = None;
    }
    let pc_name = guard.device_name.clone();

    if user_accepted {
        let new_secret = generate_hex_token();
        register_connected_device(&mut guard, req, peer_addr, &new_secret);
        drop(guard);
        emit_status_update(state, app_handle);
        (true, pc_name, new_secret, None)
    } else {
        drop(guard);
        emit_status_update(state, app_handle);
        (
            false,
            pc_name,
            String::new(),
            Some("Demande refusée ou expirée sur l'ordinateur".to_string()),
        )
    }
}

fn register_connected_device(
    guard: &mut NetworkState,
    req: &PairingRequestPayload,
    peer_addr: SocketAddr,
    session_secret: &str,
) {
    guard.connected_device = Some(ConnectedDevice {
        device_id: req.device_id.clone(),
        device_name: req.device_name.clone(),
        model: req.model.clone(),
        android_version: req.android_version.clone(),
        ip_address: peer_addr.ip().to_string(),
        battery_level: 100,
        is_charging: false,
        ringer_mode: "NORMAL".to_string(),
        screen_awake: true,
        connected_at: current_time_label(),
    });

    guard.paired_devices.insert(
        req.device_id.clone(),
        PairedDeviceRecord {
            device_id: req.device_id.clone(),
            device_name: req.device_name.clone(),
            model: req.model.clone(),
            session_secret: session_secret.to_string(),
        },
    );
    guard.save_paired_devices();
}

/// Affiche une notification Windows native et place la fenêtre NexusLink au premier plan
fn notify_and_focus_window(app_handle: &AppHandle, device_name: &str) {
    let _ = app_handle
        .notification()
        .builder()
        .title("Demande de connexion NexusLink")
        .body(format!("{} souhaite se connecter à cet ordinateur.", device_name))
        .show();

    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
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
    current_epoch_millis().to_string()
}
