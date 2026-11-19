pub mod clipboard;
pub mod file_server;
pub mod input_hook;
pub mod network;
pub mod notifications;
pub mod protocol;
pub mod tray;
pub mod udp_input;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::network::{
    detect_local_ipv4_addresses, emit_status_update, generate_hex_token,
    start_mdns_advertisement, start_websocket_server, NetworkState,
};
use crate::protocol::{
    ClipboardHistoryEntry, FileTransferRecord, InputSettings, PhoneNotificationRecord,
    ScreenMirrorCommandPayload, ServerStatus,
};
use crate::udp_input::UdpInputSender;

/// Renvoie l'état actuel du serveur et le QR Code d'appairage à l'interface React
#[tauri::command]
fn get_server_status(state: State<'_, Arc<Mutex<NetworkState>>>) -> ServerStatus {
    let mut guard = state.lock().unwrap();
    guard.local_ips = detect_local_ipv4_addresses();
    guard.to_server_status()
}

/// Régénère un nouveau jeton d'appairage et un nouveau QR Code
#[tauri::command]
fn regenerate_pairing_token(
    state: State<'_, Arc<Mutex<NetworkState>>>,
    app_handle: AppHandle,
) -> ServerStatus {
    let status = {
        let mut guard = state.lock().unwrap();
        guard.local_ips = detect_local_ipv4_addresses();
        guard.pairing_token = generate_hex_token();
        guard.to_server_status()
    };
    emit_status_update(&state, &app_handle);
    status
}

/// Déconnecte et oublie l'appareil Android actuellement associé
#[tauri::command]
fn disconnect_device(
    state: State<'_, Arc<Mutex<NetworkState>>>,
    app_handle: AppHandle,
) -> ServerStatus {
    let status = {
        let mut guard = state.lock().unwrap();
        guard.disconnect_active_device();
        guard.to_server_status()
    };
    emit_status_update(&state, &app_handle);
    status
}

/// Accepte ou refuse une demande de connexion manuelle en attente (avec code à 6 chiffres)
#[tauri::command]
fn respond_to_pairing_request(
    request_id: String,
    accepted: bool,
    state: State<'_, Arc<Mutex<NetworkState>>>,
    app_handle: AppHandle,
) -> ServerStatus {
    let sender = {
        let mut guard = state.lock().unwrap();
        if guard
            .pending_pairing
            .as_ref()
            .is_some_and(|p| p.request_id == request_id)
        {
            guard.pending_pairing = None;
        }
        guard.pending_approvals.remove(&request_id)
    };

    if let Some(tx) = sender {
        let _ = tx.send(accepted);
    }

    emit_status_update(&state, &app_handle);
    let guard = state.lock().unwrap();
    guard.to_server_status()
}

/// Déclenche ou arrête la sonnerie maximale sur le téléphone connecté
#[tauri::command]
fn trigger_find_my_phone(
    ringing: bool,
    state: State<'_, Arc<Mutex<NetworkState>>>,
) -> bool {
    let action = if ringing {
        "START_RINGING"
    } else {
        "STOP_RINGING"
    };
    let guard = state.lock().unwrap();
    guard.send_ws_message(
        "FIND_MY_PHONE_COMMAND",
        serde_json::json!({ "action": action }),
    )
}

/// Renvoie l'historique récent du presse-papiers partagé
#[tauri::command]
fn get_clipboard_history(
    state: State<'_, Arc<Mutex<NetworkState>>>,
) -> Vec<ClipboardHistoryEntry> {
    let guard = state.lock().unwrap();
    guard.clipboard_history.clone()
}

/// Envoie manuellement un texte dans le presse-papiers du téléphone connecté
#[tauri::command]
fn send_clipboard_to_phone(
    content: String,
    state: State<'_, Arc<Mutex<NetworkState>>>,
    app_handle: AppHandle,
) -> bool {
    clipboard::push_clipboard_to_phone(content, &state, &app_handle)
}

/// Renvoie l'historique des transferts de fichiers
#[tauri::command]
fn get_file_transfers(
    state: State<'_, Arc<Mutex<NetworkState>>>,
) -> Vec<FileTransferRecord> {
    let guard = state.lock().unwrap();
    guard.file_transfers.clone()
}

/// Envoie une liste de chemins de fichiers locaux vers le téléphone
#[tauri::command]
fn send_files_to_phone(
    paths: Vec<String>,
    state: State<'_, Arc<Mutex<NetworkState>>>,
    app_handle: AppHandle,
) -> usize {
    let path_bufs: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    file_server::queue_files_for_phone(path_bufs, &state, &app_handle)
}

/// Ouvre le sélecteur de fichiers natif Windows et envoie les fichiers sélectionnés
#[tauri::command]
fn pick_and_send_files(
    state: State<'_, Arc<Mutex<NetworkState>>>,
    app_handle: AppHandle,
) {
    let state_arc = Arc::clone(&state);
    let app_clone = app_handle.clone();
    app_handle.dialog().file().pick_files(move |selected| {
        if let Some(files) = selected {
            let paths: Vec<PathBuf> = files
                .into_iter()
                .filter_map(|f| f.into_path().ok())
                .collect();
            file_server::queue_files_for_phone(paths, &state_arc, &app_clone);
        }
    });
}

/// Ouvre le dossier Téléchargements\NexusLink dans l'explorateur Windows
#[tauri::command]
fn open_downloads_folder(app_handle: AppHandle) {
    let dir = file_server::get_nexus_downloads_dir();
    let _ = app_handle
        .opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>);
}

/// Ouvre un fichier local avec l'application par défaut du système
#[tauri::command]
fn open_local_file(path: String, app_handle: AppHandle) {
    let _ = app_handle.opener().open_path(path, None::<&str>);
}

/// Renvoie la liste des notifications actives du téléphone
#[tauri::command]
fn get_notifications(
    state: State<'_, Arc<Mutex<NetworkState>>>,
) -> Vec<PhoneNotificationRecord> {
    let guard = state.lock().unwrap();
    guard.notifications.clone()
}

/// Envoie une réponse directe à une notification Android
#[tauri::command]
fn reply_to_notification(
    notification_key: String,
    reply_text: String,
    state: State<'_, Arc<Mutex<NetworkState>>>,
) -> bool {
    notifications::reply_to_notification(notification_key, reply_text, &state)
}

/// Supprime une notification sur le téléphone et dans le centre de notifications PC
#[tauri::command]
fn dismiss_notification(
    notification_key: String,
    state: State<'_, Arc<Mutex<NetworkState>>>,
    app_handle: AppHandle,
) -> bool {
    notifications::dismiss_notification(notification_key, &state, &app_handle)
}

/// Supprime toutes les notifications actives sur le téléphone et sur le PC
#[tauri::command]
fn dismiss_all_notifications(
    state: State<'_, Arc<Mutex<NetworkState>>>,
    app_handle: AppHandle,
) -> usize {
    notifications::dismiss_all_notifications(&state, &app_handle)
}

/// Met à jour les paramètres de basculement souris/clavier au bord de l'écran
#[tauri::command]
fn update_input_settings(
    settings: InputSettings,
    state: State<'_, Arc<Mutex<NetworkState>>>,
    app_handle: AppHandle,
) -> ServerStatus {
    let status = {
        let mut guard = state.lock().unwrap();
        guard.input_settings = settings;
        guard.to_server_status()
    };
    input_hook::sync_runtime_snapshot();
    emit_status_update(&state, &app_handle);
    status
}

fn open_or_focus_mirror_window(app_handle: &AppHandle) {
    if let Some(existing) = app_handle.get_webview_window("mirror") {
        let _ = existing.unminimize();
        let _ = existing.show();
        let _ = existing.set_focus();
        return;
    }

    let (target_width, target_height) = {
        let monitor = app_handle
            .get_webview_window("main")
            .and_then(|w| w.current_monitor().ok().flatten())
            .or_else(|| app_handle.primary_monitor().ok().flatten());

        if let Some(m) = monitor {
            let scale = m.scale_factor().max(1.0);
            let logical_w = (m.size().width as f64) / scale;
            let logical_h = (m.size().height as f64) / scale;
            let max_h = (logical_h - 100.0).max(420.0);
            let h = (logical_h * 0.82).min(max_h).clamp(460.0, 720.0);
            let w = (h * 0.48).min((logical_w - 80.0).max(240.0)).clamp(260.0, 360.0);
            (w, h)
        } else {
            (320.0, 660.0)
        }
    };

    if let Ok(win) = WebviewWindowBuilder::new(
        app_handle,
        "mirror",
        WebviewUrl::App("index.html".into()),
    )
    .title("Écran du téléphone")
    .inner_size(target_width, target_height)
    .min_inner_size(240.0, 420.0)
    .center()
    .decorations(false)
    .transparent(true)
    .resizable(true)
    .build()
    {
        #[cfg(target_os = "windows")]
        if window_vibrancy::apply_mica(&win, Some(true)).is_err() {
            let _ = window_vibrancy::apply_acrylic(&win, Some((18, 19, 24, 240)));
        }
        let _ = win.set_focus();
    }
}

fn stop_mirror_session(state: &Arc<Mutex<NetworkState>>, app_handle: &AppHandle) -> bool {
    let sent = {
        let mut guard = state.lock().unwrap();
        guard.mirror_state = "STOPPED".to_string();
        guard.mirror_error = None;
        let _ = guard.screen_frame_tx.send(None);
        let payload = ScreenMirrorCommandPayload {
            action: "STOP".to_string(),
        };
        guard.send_ws_message(
            "SCREEN_MIRROR_COMMAND",
            serde_json::to_value(payload).unwrap_or_default(),
        )
    };
    emit_status_update(state, app_handle);
    sent
}

/// Demande au téléphone de démarrer la recopie d'écran et ouvre la fenêtre séparée
#[tauri::command]
async fn start_screen_mirror(
    state: State<'_, Arc<Mutex<NetworkState>>>,
    app_handle: AppHandle,
) -> Result<bool, String> {
    let can_start = {
        let mut guard = state.lock().unwrap();
        if guard.connected_device.is_none() {
            return Ok(false);
        }
        guard.mirror_state = "WAITING_PERMISSION".to_string();
        guard.mirror_error = None;
        let payload = ScreenMirrorCommandPayload {
            action: "START".to_string(),
        };
        guard.send_ws_message(
            "SCREEN_MIRROR_COMMAND",
            serde_json::to_value(payload).unwrap_or_default(),
        )
    };
    open_or_focus_mirror_window(&app_handle);
    emit_status_update(&state, &app_handle);
    Ok(can_start)
}

/// Ouvre ou met au premier plan la fenêtre séparée de recopie d'écran
#[tauri::command]
async fn focus_mirror_window(app_handle: AppHandle) -> Result<(), String> {
    open_or_focus_mirror_window(&app_handle);
    Ok(())
}

/// Demande au téléphone d'arrêter la recopie d'écran et ferme la fenêtre séparée
#[tauri::command]
fn stop_screen_mirror(
    state: State<'_, Arc<Mutex<NetworkState>>>,
    app_handle: AppHandle,
) -> bool {
    let sent = stop_mirror_session(&state, &app_handle);
    if let Some(win) = app_handle.get_webview_window("mirror") {
        let _ = win.close();
    }
    sent
}

/// Envoie directement une action souris/clavier en UDP depuis la fenêtre de recopie d'écran
#[tauri::command]
fn send_mirror_input(
    event_type: u8,
    dx_or_code: i16,
    dy_or_mods: i16,
    button_state: u8,
    flags: u8,
    state: State<'_, Arc<Mutex<NetworkState>>>,
    udp_sender: State<'_, Arc<UdpInputSender>>,
) -> bool {
    let target = {
        let guard = state.lock().unwrap();
        guard.get_active_udp_target()
    };
    let Some((ip, port, secret)) = target else {
        return false;
    };
    udp_sender.send_event(
        &ip,
        port,
        &secret,
        event_type,
        dx_or_code,
        dy_or_mods,
        button_state,
        flags,
    );
    true
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shared_state = Arc::new(Mutex::new(NetworkState::new()));
    let mirror_udp_sender = Arc::new(
        UdpInputSender::new().expect("Impossible d'ouvrir le socket UDP pour la recopie"),
    );

    tauri::Builder::default()
        .manage(Arc::clone(&shared_state))
        .manage(mirror_udp_sender)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(move |app| {
            let app_handle = app.handle().clone();

            // Charge les appareils mémorisés dans %APPDATA%/com.nexuslink.desktop/paired_devices.json
            if let Ok(app_data_dir) = app.path().app_data_dir() {
                let storage_path = app_data_dir.join("paired_devices.json");
                let mut guard = shared_state.lock().unwrap();
                guard.load_paired_devices(storage_path);
            }

            // Active l'effet natif Mica sombre sous Windows 11 (avec repli Acrylic)
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                if window_vibrancy::apply_mica(&window, Some(true)).is_err() {
                    let _ = window_vibrancy::apply_acrylic(&window, Some((12, 13, 16, 235)));
                }
            }

            // Initialise l'icône dans la barre système Windows (System Tray)
            tray::setup_system_tray(&app_handle)?;

            // Démarre l'annonce mDNS sur un fil d'exécution dédié
            let mdns_state = Arc::clone(&shared_state);
            let mdns_app = app_handle.clone();
            std::thread::spawn(move || {
                start_mdns_advertisement(mdns_state, mdns_app);
            });

            // Démarre la surveillance du presse-papiers sur un fil d'exécution dédié
            let clip_state = Arc::clone(&shared_state);
            let clip_app = app_handle.clone();
            std::thread::spawn(move || {
                clipboard::start_clipboard_monitor(clip_state, clip_app);
            });

            // Démarre le serveur WebSocket local dans le runtime asynchrone de Tauri
            let ws_state = Arc::clone(&shared_state);
            let ws_app = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                start_websocket_server(ws_state, ws_app).await;
            });

            // Démarre le serveur HTTP haut débit pour les fichiers et images du presse-papiers
            let http_state = Arc::clone(&shared_state);
            let http_app = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                file_server::start_http_file_server(http_state, http_app).await;
            });

            // Démarre les hooks souris/clavier Windows pour le basculement au bord d'écran
            input_hook::start_input_hook_monitor(Arc::clone(&shared_state), app_handle.clone());

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    // Réduit la fenêtre principale dans la barre système au lieu de quitter
                    let _ = window.hide();
                    api.prevent_close();
                } else if window.label() == "mirror" {
                    // Ferme la fenêtre de recopie et arrête la diffusion côté téléphone
                    let state = window.app_handle().state::<Arc<Mutex<NetworkState>>>();
                    stop_mirror_session(&state, window.app_handle());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_server_status,
            regenerate_pairing_token,
            disconnect_device,
            respond_to_pairing_request,
            trigger_find_my_phone,
            get_clipboard_history,
            send_clipboard_to_phone,
            get_file_transfers,
            send_files_to_phone,
            pick_and_send_files,
            open_downloads_folder,
            open_local_file,
            get_notifications,
            reply_to_notification,
            dismiss_notification,
            dismiss_all_notifications,
            update_input_settings,
            start_screen_mirror,
            stop_screen_mirror,
            focus_mirror_window,
            send_mirror_input
        ])
        .run(tauri::generate_context!())
        .expect("Erreur lors de l'exécution de l'application Tauri NexusLink");
}
