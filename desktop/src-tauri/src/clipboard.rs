use std::io::Cursor;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use arboard::Clipboard;
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, RgbaImage};
use tauri::{AppHandle, Emitter};
#[cfg(not(target_os = "windows"))]
use tauri_plugin_clipboard_manager::ClipboardExt;
use uuid::Uuid;

use crate::network::{NetworkState, OutgoingPayload, current_time_label};
use crate::protocol::{ClipboardHistoryEntry, ClipboardSyncPayload, FileTransferOfferPayload};

const MAX_HISTORY_ITEMS: usize = 15;
const MAX_CLIPBOARD_IMAGE_BYTES: usize = 5 * 1024 * 1024; // 5 Mo max

/// Surveille périodiquement le presse-papiers (texte et images) du PC et le transmet à Android.
pub fn start_clipboard_monitor(state: Arc<Mutex<NetworkState>>, app_handle: AppHandle) {
    let mut clipboard = match Clipboard::new() {
        Ok(cb) => cb,
        Err(err) => {
            eprintln!(
                "Impossible d'initialiser le presse-papiers système : {}",
                err
            );
            return;
        }
    };

    if let Ok(initial_text) = clipboard.get_text() {
        let mut guard = state.lock().unwrap();
        guard.last_clipboard_text = Some(initial_text);
    }
    if let Ok(initial_img) = clipboard.get_image() {
        let mut guard = state.lock().unwrap();
        guard.last_clipboard_image_hash = Some(hash_rgba(
            initial_img.width,
            initial_img.height,
            &initial_img.bytes,
        ));
    }

    loop {
        thread::sleep(Duration::from_millis(500));

        // 1. Surveillance du texte
        if let Ok(current_text) = clipboard.get_text() {
            if !current_text.trim().is_empty() {
                let should_emit = {
                    let mut guard = state.lock().unwrap();
                    let changed =
                        guard.last_clipboard_text.as_deref() != Some(current_text.as_str());
                    if changed {
                        guard.last_clipboard_text = Some(current_text.clone());
                        if guard.connected_device.is_some() {
                            push_history_entry(&mut guard, current_text.clone(), "PC");
                            let payload = ClipboardSyncPayload {
                                mime_type: "text/plain".to_string(),
                                content: current_text,
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
                if should_emit {
                    emit_clipboard_history(&state, &app_handle);
                }
            }
        }

        // 2. Surveillance des images / captures d'écran (compressées en JPEG <= 5 Mo)
        if let Ok(img) = clipboard.get_image() {
            let img_hash = hash_rgba(img.width, img.height, &img.bytes);
            let is_new_image = {
                let mut guard = state.lock().unwrap();
                let suppressed = guard
                    .clipboard_image_suppress_until
                    .is_some_and(|until| Instant::now() < until);
                if suppressed {
                    // Mémorise le hash réel produit par Windows/GDI+ sans renvoyer d'écho vers Android
                    guard.last_clipboard_image_hash = Some(img_hash);
                    false
                } else if guard.last_clipboard_image_hash != Some(img_hash) {
                    guard.last_clipboard_image_hash = Some(img_hash);
                    guard.connected_device.is_some()
                } else {
                    false
                }
            };

            if is_new_image {
                if let Some(jpeg_bytes) =
                    encode_rgba_to_jpeg_under_limit(img.width, img.height, &img.bytes)
                {
                    let file_id = Uuid::new_v4().to_string();
                    let file_size = jpeg_bytes.len() as u64;
                    {
                        let mut guard = state.lock().unwrap();
                        guard.outgoing_files.insert(
                            file_id.clone(),
                            OutgoingPayload::MemoryBytes {
                                bytes: jpeg_bytes,
                                mime_type: "image/jpeg".to_string(),
                            },
                        );
                        push_history_entry(
                            &mut guard,
                            format!("[Image {}×{}]", img.width, img.height),
                            "PC",
                        );
                        let offer = FileTransferOfferPayload {
                            file_id,
                            file_name: "clipboard_image.jpg".to_string(),
                            file_size,
                            mime_type: "image/jpeg".to_string(),
                            purpose: "CLIPBOARD_IMAGE".to_string(),
                        };
                        guard.send_ws_message(
                            "FILE_TRANSFER_OFFER",
                            serde_json::to_value(offer).unwrap_or_default(),
                        );
                    }
                    emit_clipboard_history(&state, &app_handle);
                }
            }
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
        guard.last_clipboard_text = Some(content.clone());
        push_history_entry(&mut guard, content.clone(), "Android");
    }

    let _ = app_handle.run_on_main_thread(move || {
        if let Ok(mut clipboard) = Clipboard::new() {
            if let Err(err) = clipboard.set_text(content) {
                eprintln!("Erreur set_text presse-papiers Windows : {}", err);
            }
        }
    });

    emit_clipboard_history(state, app_handle);
}

/// Applique une image reçue depuis Android dans le presse-papiers Windows (sans boucle infinie).
pub fn apply_remote_clipboard_image(
    bytes: &[u8],
    state: &Arc<Mutex<NetworkState>>,
    app_handle: &AppHandle,
) {
    let dyn_img = match image::load_from_memory(bytes) {
        Ok(img) => img,
        Err(err) => {
            eprintln!(
                "Impossible de décoder l'image reçue ({} octets) : {}",
                bytes.len(),
                err
            );
            return;
        }
    };
    let rgba = dyn_img.to_rgba8();
    let width = rgba.width() as usize;
    let height = rgba.height() as usize;
    let raw_bytes = rgba.into_raw();
    let img_hash = hash_rgba(width, height, &raw_bytes);

    {
        let mut guard = state.lock().unwrap();
        guard.last_clipboard_image_hash = Some(img_hash);
        guard.clipboard_image_suppress_until = Some(Instant::now() + Duration::from_secs(5));
        push_history_entry(
            &mut guard,
            format!("[Image {}×{}]", width, height),
            "Android",
        );
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let temp_path = std::env::temp_dir().join(format!("nexus_clip_{}.jpg", Uuid::new_v4()));
        if std::fs::write(&temp_path, bytes).is_ok() {
            let escaped_path = temp_path.to_string_lossy().replace('\'', "''");
            let ps_script = format!(
                "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; \
                 $img = [System.Drawing.Image]::FromFile('{}'); \
                 [System.Windows.Forms.Clipboard]::SetImage($img); \
                 $img.Dispose()",
                escaped_path
            );
            let output = std::process::Command::new("powershell.exe")
                .args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-WindowStyle",
                    "Hidden",
                    "-Sta",
                    "-Command",
                    &ps_script,
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            let _ = std::fs::remove_file(&temp_path);

            match output {
                Ok(res) if res.status.success() => {
                    eprintln!(
                        "Image presse-papiers appliquée sous Windows ({}x{})",
                        width, height
                    );
                    // Relit immédiatement le hash RGBA réel écrit par GDI+ pour empêcher tout écho
                    if let Ok(mut cb) = Clipboard::new() {
                        if let Ok(written_img) = cb.get_image() {
                            let actual_hash = hash_rgba(
                                written_img.width,
                                written_img.height,
                                &written_img.bytes,
                            );
                            let mut guard = state.lock().unwrap();
                            guard.last_clipboard_image_hash = Some(actual_hash);
                        }
                    }
                }
                Ok(res) => {
                    eprintln!(
                        "Erreur PowerShell SetImage : {}",
                        String::from_utf8_lossy(&res.stderr)
                    );
                }
                Err(err) => {
                    eprintln!("Impossible de lancer PowerShell pour SetImage : {}", err);
                }
            }
        }
        let mut guard = state.lock().unwrap();
        guard.clipboard_image_suppress_until = Some(Instant::now() + Duration::from_secs(1));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let tauri_img = tauri::image::Image::new_owned(raw_bytes, width as u32, height as u32);
        if let Err(err) = app_handle.clipboard().write_image(&tauri_img) {
            eprintln!("Erreur write_image presse-papiers Tauri : {}", err);
        }
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

fn encode_rgba_to_jpeg_under_limit(width: usize, height: usize, bytes: &[u8]) -> Option<Vec<u8>> {
    let rgba = RgbaImage::from_raw(width as u32, height as u32, bytes.to_vec())?;
    let rgb = DynamicImage::ImageRgba8(rgba).to_rgb8();

    for quality in [85u8, 65u8, 45u8] {
        let mut out = Cursor::new(Vec::new());
        let mut encoder = JpegEncoder::new_with_quality(&mut out, quality);
        if encoder.encode_image(&rgb).is_ok() {
            let encoded = out.into_inner();
            if encoded.len() <= MAX_CLIPBOARD_IMAGE_BYTES {
                return Some(encoded);
            }
        }
    }
    None
}

fn hash_rgba(width: usize, height: usize, bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in width.to_le_bytes().into_iter().chain(height.to_le_bytes()) {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    // Échantillonnage rapide pour rester instantané même sur de grandes captures 4K
    let step = (bytes.len() / 4096).max(1);
    for &b in bytes.iter().step_by(step) {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
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
