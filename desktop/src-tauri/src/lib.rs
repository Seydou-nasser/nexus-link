pub mod clipboard;
pub mod file_server;
pub mod network;
pub mod protocol;
pub mod tray;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::network::{
    detect_local_ipv4_addresses, emit_status_update, generate_hex_token,
    start_mdns_advertisement, start_websocket_server, NetworkState,
};
use crate::protocol::{ClipboardHistoryEntry, FileTransferRecord, ServerStatus};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shared_state = Arc::new(Mutex::new(NetworkState::new()));

    tauri::Builder::default()
        .manage(Arc::clone(&shared_state))
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

            Ok(())
        })
        .on_window_event(|window, event| {
            // Réduit la fenêtre dans la barre système au lieu de quitter le processus
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
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
            open_local_file
        ])
        .run(tauri::generate_context!())
        .expect("Erreur lors de l'exécution de l'application Tauri NexusLink");
}
