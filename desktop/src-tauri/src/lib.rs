pub mod network;
pub mod protocol;
pub mod tray;

use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State, WindowEvent};

use crate::network::{
    current_time_label, detect_local_ipv4_addresses, emit_status_update, generate_hex_token,
    start_mdns_advertisement, start_websocket_server, NetworkState,
};
use crate::protocol::{ConnectedDevice, ServerStatus};

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

/// Déconnecte l'appareil Android actuellement associé
#[tauri::command]
fn disconnect_device(
    state: State<'_, Arc<Mutex<NetworkState>>>,
    app_handle: AppHandle,
) -> ServerStatus {
    let status = {
        let mut guard = state.lock().unwrap();
        guard.connected_device = None;
        guard.to_server_status()
    };
    emit_status_update(&state, &app_handle);
    status
}

/// Permet de simuler la connexion d'un téléphone Android pour tester l'interface PC
#[tauri::command]
fn simulate_device_connection(
    state: State<'_, Arc<Mutex<NetworkState>>>,
    app_handle: AppHandle,
) -> ServerStatus {
    let status = {
        let mut guard = state.lock().unwrap();
        guard.connected_device = Some(ConnectedDevice {
            device_id: "sim-android-pixel-8".to_string(),
            device_name: "Pixel 8 Pro".to_string(),
            model: "Google Pixel 8 Pro".to_string(),
            android_version: "15".to_string(),
            ip_address: guard
                .local_ips
                .first()
                .cloned()
                .unwrap_or_else(|| "192.168.1.50".to_string()),
            battery_level: 86,
            is_charging: true,
            ringer_mode: "NORMAL".to_string(),
            screen_awake: true,
            connected_at: current_time_label(),
        });
        guard.to_server_status()
    };
    emit_status_update(&state, &app_handle);
    status
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shared_state = Arc::new(Mutex::new(NetworkState::new()));

    tauri::Builder::default()
        .manage(Arc::clone(&shared_state))
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let app_handle = app.handle().clone();

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

            // Démarre le serveur WebSocket local dans le runtime asynchrone de Tauri
            let ws_state = Arc::clone(&shared_state);
            let ws_app = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                start_websocket_server(ws_state, ws_app).await;
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
            simulate_device_connection
        ])
        .run(tauri::generate_context!())
        .expect("Erreur lors de l'exécution de l'application Tauri NexusLink");
}
