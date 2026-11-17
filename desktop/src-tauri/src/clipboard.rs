use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use arboard::Clipboard;
use tauri::{AppHandle, Emitter};

use crate::network::{current_time_label, NetworkState};
use crate::protocol::{ClipboardHistoryEntry, ClipboardSyncPayload};

const MAX_HISTORY_ITEMS: usize = 15;

/// Surveille périodiquement le presse-papiers texte du PC et le transmet à Android.
pub fn start_clipboard_monitor(state: Arc<Mutex<NetworkState>>, app_handle: AppHandle) {
    let mut clipboard = match Clipboard::new() {
        Ok(cb) => cb,
        Err(err) => {
            eprintln!("Impossible d'initialiser le presse-papiers système : {}", err);
            return;
        }
    };

    // Initialise la valeur de référence pour ne pas envoyer ce qui était déjà copié avant le démarrage
    if let Ok(initial_text) = clipboard.get_text() {
        let mut guard = state.lock().unwrap();
        guard.last_clipboard_text = Some(initial_text);
    }

    loop {
        thread::sleep(Duration::from_millis(500));

        let Ok(current_text) = clipboard.get_text() else {
            continue;
        };

        if current_text.trim().is_empty() {
            continue;
        }

        let should_send = {
            let mut guard = state.lock().unwrap();
            let changed = guard.last_clipboard_text.as_deref() != Some(current_text.as_str());
            if changed {
                guard.last_clipboard_text = Some(current_text.clone());
                if guard.connected_device.is_some() {
                    push_history_entry(&mut guard, current_text.clone(), "PC");
                    let payload = ClipboardSyncPayload {
                        mime_type: "text/plain".to_string(),
                        content: current_text.clone(),
                    };
                    guard.send_ws_message(
                        "CLIPBOARD_SYNC",
                        serde_json::to_value(payload).unwrap_or_default(),
                    );
                    true
                } else {
                    false
                }
            } else {
                false
            }
        };

        if should_send {
            emit_clipboard_history(&state, &app_handle);
        }
    }
}

/// Applique un texte reçu depuis Android dans le presse-papiers Windows (sans boucle infinie).
pub fn apply_remote_clipboard(
    content: String,
    state: &Arc<Mutex<NetworkState>>,
    app_handle: &AppHandle,
) {
    if content.trim().is_empty() {
        return;
    }

    {
        let mut guard = state.lock().unwrap();
        // Met à jour la garde anti-boucle AVANT d'écrire dans le presse-papiers Windows
        guard.last_clipboard_text = Some(content.clone());
        push_history_entry(&mut guard, content.clone(), "Android");
    }

    if let Ok(mut clipboard) = Clipboard::new() {
        let _ = clipboard.set_text(content);
    }

    emit_clipboard_history(state, app_handle);
}

/// Envoie manuellement un texte depuis l'interface PC vers le téléphone et le copie localement.
pub fn push_clipboard_to_phone(
    content: String,
    state: &Arc<Mutex<NetworkState>>,
    app_handle: &AppHandle,
) -> bool {
    if content.trim().is_empty() {
        return false;
    }

    if let Ok(mut clipboard) = Clipboard::new() {
        let _ = clipboard.set_text(content.clone());
    }

    let sent = {
        let mut guard = state.lock().unwrap();
        guard.last_clipboard_text = Some(content.clone());
        push_history_entry(&mut guard, content.clone(), "PC");
        let payload = ClipboardSyncPayload {
            mime_type: "text/plain".to_string(),
            content,
        };
        guard.send_ws_message(
            "CLIPBOARD_SYNC",
            serde_json::to_value(payload).unwrap_or_default(),
        )
    };

    emit_clipboard_history(state, app_handle);
    sent
}

fn push_history_entry(guard: &mut NetworkState, content: String, source: &str) {
    guard.clipboard_history.insert(
        0,
        ClipboardHistoryEntry {
            content,
            source: source.to_string(),
            timestamp: current_time_label(),
        },
    );
    if guard.clipboard_history.len() > MAX_HISTORY_ITEMS {
        guard.clipboard_history.truncate(MAX_HISTORY_ITEMS);
    }
}

fn emit_clipboard_history(state: &Arc<Mutex<NetworkState>>, app_handle: &AppHandle) {
    let history = {
        let guard = state.lock().unwrap();
        guard.clipboard_history.clone()
    };
    let _ = app_handle.emit("nexus://clipboard-updated", history);
}
