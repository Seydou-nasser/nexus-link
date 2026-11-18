use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Path as AxumPath, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use base64::Engine as _;
use futures_util::StreamExt;
use image::codecs::jpeg::JpegEncoder;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use crate::clipboard::apply_remote_clipboard_image;
use crate::network::{current_time_label, NetworkState, OutgoingPayload};
use crate::protocol::{FileTransferOfferPayload, FileTransferRecord};

const MAX_TRANSFERS_HISTORY: usize = 30;
const MAX_CLIPBOARD_IMAGE_BYTES: usize = 5 * 1024 * 1024; // 5 Mo max

#[derive(Clone)]
struct HttpServerState {
    network: Arc<Mutex<NetworkState>>,
    app_handle: AppHandle,
}

/// Renvoie le dossier Téléchargements/NexusLink et le crée s'il n'existe pas encore
pub fn get_nexus_downloads_dir() -> PathBuf {
    let base = dirs::download_dir().unwrap_or_else(|| PathBuf::from("."));
    let target = base.join("NexusLink");
    let _ = std::fs::create_dir_all(&target);
    target
}

/// Démarre le serveur HTTP haut débit sur le port 52842
pub async fn start_http_file_server(state: Arc<Mutex<NetworkState>>, app_handle: AppHandle) {
    let http_port = {
        let guard = state.lock().unwrap();
        guard.http_port
    };

    let shared = HttpServerState {
        network: state,
        app_handle,
    };

    let app = Router::new()
        .route("/api/v1/files/upload", post(handle_upload))
        .route("/api/v1/files/download/{file_id}", get(handle_download))
        // Autorise le streaming de gros fichiers sans limite par défaut d'Axum (2 Mo)
        .layer(DefaultBodyLimit::disable())
        .with_state(shared);

    let bind_addr = format!("0.0.0.0:{}", http_port);
    let listener = match tokio::net::TcpListener::bind(&bind_addr).await {
        Ok(l) => l,
        Err(err) => {
            eprintln!("Erreur d'ouverture du serveur HTTP {}: {}", bind_addr, err);
            return;
        }
    };

    if let Err(err) = axum::serve(listener, app).await {
        eprintln!("Arrêt du serveur HTTP fichiers : {}", err);
    }
}

/// Prépare et propose un lot de fichiers locaux au téléphone connecté
pub fn queue_files_for_phone(
    paths: Vec<PathBuf>,
    state: &Arc<Mutex<NetworkState>>,
    app_handle: &AppHandle,
) -> usize {
    let mut queued_count = 0usize;

    {
        let mut guard = state.lock().unwrap();
        if guard.connected_device.is_none() {
            return 0;
        }

        for path in paths {
            let Ok(meta) = std::fs::metadata(&path) else {
                continue;
            };
            if !meta.is_file() {
                continue;
            }

            let file_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("fichier")
                .to_string();
            let file_size = meta.len();
            let file_id = Uuid::new_v4().to_string();
            let mime_type = guess_mime_type(&file_name);

            guard
                .outgoing_files
                .insert(file_id.clone(), OutgoingPayload::File(path.clone()));

            let thumbnail_base64 = if mime_type.starts_with("image/") {
                generate_image_thumbnail_base64(&path)
            } else {
                None
            };

            push_transfer_record(
                &mut guard,
                FileTransferRecord {
                    file_id: file_id.clone(),
                    file_name: file_name.clone(),
                    file_size,
                    direction: "SENT".to_string(),
                    status: "PENDING".to_string(),
                    saved_path: Some(path.to_string_lossy().to_string()),
                    thumbnail_base64,
                    timestamp: current_time_label(),
                },
            );

            let offer = FileTransferOfferPayload {
                file_id,
                file_name,
                file_size,
                mime_type,
                purpose: "FILE".to_string(),
            };

            guard.send_ws_message(
                "FILE_TRANSFER_OFFER",
                serde_json::to_value(offer).unwrap_or_default(),
            );
            queued_count += 1;
        }
    }

    if queued_count > 0 {
        emit_file_transfers(state, app_handle);
    }
    queued_count
}

async fn handle_upload(
    State(state): State<HttpServerState>,
    headers: HeaderMap,
    body: Body,
) -> impl IntoResponse {
    if !is_authorized(&headers, &state.network) {
        return (StatusCode::UNAUTHORIZED, "Non autorisé").into_response();
    }

    let purpose = headers
        .get("x-purpose")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("FILE");

    let raw_name = headers
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("fichier_recu");
    let safe_name = sanitize_filename(raw_name);

    // Cas 1 : Image JPEG du presse-papiers Android (<= 5 Mo)
    if purpose == "CLIPBOARD_IMAGE" {
        let mut bytes_buf = Vec::new();
        let mut stream = body.into_data_stream();
        while let Some(chunk_res) = stream.next().await {
            let Ok(chunk) = chunk_res else {
                return (StatusCode::BAD_REQUEST, "Flux interrompu").into_response();
            };
            if bytes_buf.len() + chunk.len() > MAX_CLIPBOARD_IMAGE_BYTES {
                return (StatusCode::PAYLOAD_TOO_LARGE, "Image supérieure à 5 Mo").into_response();
            }
            bytes_buf.extend_from_slice(&chunk);
        }

        eprintln!("Image presse-papiers reçue d'Android ({} octets)", bytes_buf.len());
        apply_remote_clipboard_image(&bytes_buf, &state.network, &state.app_handle);
        return (StatusCode::OK, "Image appliquée au presse-papiers").into_response();
    }

    // Cas 2 : Fichier ou photo envoyé vers Téléchargements/NexusLink
    let dest_dir = get_nexus_downloads_dir();
    let dest_path = unique_destination_path(&dest_dir, &safe_name);

    let mut file = match tokio::fs::File::create(&dest_path).await {
        Ok(f) => f,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Création impossible").into_response(),
    };

    let mut total_bytes = 0u64;
    let mut stream = body.into_data_stream();
    while let Some(chunk_res) = stream.next().await {
        let Ok(chunk) = chunk_res else {
            let _ = tokio::fs::remove_file(&dest_path).await;
            return (StatusCode::BAD_REQUEST, "Flux interrompu").into_response();
        };
        if file.write_all(&chunk).await.is_err() {
            let _ = tokio::fs::remove_file(&dest_path).await;
            return (StatusCode::INTERNAL_SERVER_ERROR, "Erreur d'écriture").into_response();
        }
        total_bytes += chunk.len() as u64;
    }

    let _ = file.flush().await;

    let file_id = Uuid::new_v4().to_string();
    let thumbnail_base64 = if guess_mime_type(&safe_name).starts_with("image/") {
        generate_image_thumbnail_base64(&dest_path)
    } else {
        None
    };

    {
        let mut guard = state.network.lock().unwrap();
        push_transfer_record(
            &mut guard,
            FileTransferRecord {
                file_id,
                file_name: safe_name.clone(),
                file_size: total_bytes,
                direction: "RECEIVED".to_string(),
                status: "COMPLETED".to_string(),
                saved_path: Some(dest_path.to_string_lossy().to_string()),
                thumbnail_base64,
                timestamp: current_time_label(),
            },
        );
    }

    emit_file_transfers(&state.network, &state.app_handle);

    let _ = state
        .app_handle
        .notification()
        .builder()
        .title("Fichier reçu via NexusLink")
        .body(format!("{} enregistré dans Téléchargements\\NexusLink", safe_name))
        .show();

    (StatusCode::OK, "Fichier reçu").into_response()
}

async fn handle_download(
    State(state): State<HttpServerState>,
    AxumPath(file_id): AxumPath<String>,
    headers: HeaderMap,
) -> Response {
    if !is_authorized(&headers, &state.network) {
        return (StatusCode::UNAUTHORIZED, "Non autorisé").into_response();
    }

    let payload = {
        let guard = state.network.lock().unwrap();
        guard.outgoing_files.get(&file_id).cloned()
    };

    let Some(payload) = payload else {
        return (StatusCode::NOT_FOUND, "Fichier introuvable").into_response();
    };

    match payload {
        OutgoingPayload::MemoryBytes { bytes, mime_type } => {
            // Libère la mémoire dès que l'image du presse-papiers a été téléchargée
            {
                let mut guard = state.network.lock().unwrap();
                guard.outgoing_files.remove(&file_id);
            }
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime_type)
                .header(header::CONTENT_LENGTH, bytes.len())
                .body(Body::from(bytes))
                .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Erreur").into_response())
        }
        OutgoingPayload::File(path) => {
            let Ok(file) = tokio::fs::File::open(&path).await else {
                return (StatusCode::NOT_FOUND, "Fichier introuvable sur disque").into_response();
            };
            let file_len = file.metadata().await.map(|m| m.len()).unwrap_or(0);
            let file_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("fichier");

            let stream = ReaderStream::new(file);
            let body = Body::from_stream(stream);

            {
                let mut guard = state.network.lock().unwrap();
                if let Some(rec) = guard
                    .file_transfers
                    .iter_mut()
                    .find(|r| r.file_id == file_id)
                {
                    rec.status = "COMPLETED".to_string();
                }
            }
            emit_file_transfers(&state.network, &state.app_handle);

            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, guess_mime_type(file_name))
                .header(header::CONTENT_LENGTH, file_len)
                .body(body)
                .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Erreur").into_response())
        }
    }
}

fn is_authorized(headers: &HeaderMap, state: &Arc<Mutex<NetworkState>>) -> bool {
    let Some(auth_val) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let Some(token) = auth_val.strip_prefix("Bearer ") else {
        return false;
    };

    let guard = state.lock().unwrap();
    guard
        .paired_devices
        .values()
        .any(|record| record.session_secret == token)
}

fn sanitize_filename(raw: &str) -> String {
    let base = Path::new(raw)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("fichier");
    let cleaned: String = base
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => c,
        })
        .collect();
    if cleaned.trim().is_empty() {
        "fichier".to_string()
    } else {
        cleaned
    }
}

fn unique_destination_path(dir: &Path, filename: &str) -> PathBuf {
    let initial = dir.join(filename);
    if !initial.exists() {
        return initial;
    }

    let stem = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("fichier");
    let ext = Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e))
        .unwrap_or_default();

    for idx in 1..1000 {
        let candidate = dir.join(format!("{} ({}){}", stem, idx, ext));
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{}_{}{}", stem, Uuid::new_v4().simple(), ext))
}

fn guess_mime_type(file_name: &str) -> String {
    let lower = file_name.to_lowercase();
    if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg".to_string()
    } else if lower.ends_with(".png") {
        "image/png".to_string()
    } else if lower.ends_with(".webp") {
        "image/webp".to_string()
    } else if lower.ends_with(".pdf") {
        "application/pdf".to_string()
    } else if lower.ends_with(".mp4") {
        "video/mp4".to_string()
    } else {
        "application/octet-stream".to_string()
    }
}

fn push_transfer_record(guard: &mut NetworkState, record: FileTransferRecord) {
    guard.file_transfers.insert(0, record);
    if guard.file_transfers.len() > MAX_TRANSFERS_HISTORY {
        guard.file_transfers.truncate(MAX_TRANSFERS_HISTORY);
    }
}

pub fn emit_file_transfers(state: &Arc<Mutex<NetworkState>>, app_handle: &AppHandle) {
    let list = {
        let guard = state.lock().unwrap();
        guard.file_transfers.clone()
    };
    let _ = app_handle.emit("nexus://files-updated", list);
}

fn generate_image_thumbnail_base64(path: &Path) -> Option<String> {
    let img = image::open(path).ok()?;
    let thumb = img.thumbnail(96, 96).to_rgb8();
    let mut out = std::io::Cursor::new(Vec::new());
    let mut encoder = JpegEncoder::new_with_quality(&mut out, 75);
    encoder.encode_image(&thumb).ok()?;
    Some(base64::engine::general_purpose::STANDARD.encode(out.into_inner()))
}
