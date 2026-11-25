use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::Router;
use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, Path as AxumPath, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use base64::Engine as _;
use futures_util::StreamExt;
use image::codecs::jpeg::JpegEncoder;
use serde::Deserialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use crate::clipboard::apply_remote_clipboard_image;
use crate::network::{NetworkState, OutgoingPayload, current_time_label};
use crate::protocol::{FileTransferOfferPayload, FileTransferRecord};

const MAX_TRANSFERS_HISTORY: usize = 30;
const MAX_CLIPBOARD_IMAGE_BYTES: usize = 5 * 1024 * 1024; // 5 Mo max
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(120);

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

/// Ouvre le listener HTTP avec repli automatique de port et met à jour l'état partagé
pub async fn bind_http_file_listener(
    state: &Arc<Mutex<NetworkState>>,
    app_handle: &AppHandle,
) -> Option<tokio::net::TcpListener> {
    let preferred_port = {
        let guard = state.lock().unwrap();
        guard.http_port
    };

    match crate::network::bind_tcp_with_fallback(preferred_port, &[42842, 32842, 22842]).await {
        Ok((listener, actual_port)) => {
            {
                let mut guard = state.lock().unwrap();
                guard.http_port = actual_port;
            }
            crate::network::emit_status_update(state, app_handle);
            Some(listener)
        }
        Err(err) => {
            eprintln!(
                "Erreur d'ouverture du serveur HTTP (préféré {}) : {}",
                preferred_port, err
            );
            None
        }
    }
}

/// Sert les routes HTTP haut débit sur un listener déjà ouvert
pub async fn serve_http_file_listener(
    listener: tokio::net::TcpListener,
    state: Arc<Mutex<NetworkState>>,
    app_handle: AppHandle,
) {
    let shared = HttpServerState {
        network: state,
        app_handle,
    };

    let app = Router::new()
        .route("/api/v1/files/upload", post(handle_upload))
        .route("/api/v1/files/download/{file_id}", get(handle_download))
        .route("/api/v1/screen/frame", post(handle_screen_frame_upload))
        .route("/api/v1/screen/stream", get(handle_screen_stream))
        .route(
            "/api/v1/media/thumb/{media_type}/{media_id}",
            get(handle_media_thumb),
        )
        .route(
            "/api/v1/media/file/{media_type}/{media_id}",
            get(handle_media_file),
        )
        // Autorise le streaming de gros fichiers sans limite par défaut d'Axum (2 Mo)
        .layer(DefaultBodyLimit::disable())
        .with_state(shared);

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
                    bytes_transferred: 0,
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

        eprintln!(
            "Image presse-papiers reçue d'Android ({} octets)",
            bytes_buf.len()
        );
        apply_remote_clipboard_image(&bytes_buf, &state.network, &state.app_handle);
        return (StatusCode::OK, "Image appliquée au presse-papiers").into_response();
    }

    // Cas 2 : Fichier ou photo envoyé vers Téléchargements/NexusLink
    let dest_dir = get_nexus_downloads_dir();
    let dest_path = unique_destination_path(&dest_dir, &safe_name);
    let expected_size = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);

    let mut file = match tokio::fs::File::create(&dest_path).await {
        Ok(f) => f,
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Création impossible").into_response();
        }
    };

    let file_id = Uuid::new_v4().to_string();
    {
        let mut guard = state.network.lock().unwrap();
        push_transfer_record(
            &mut guard,
            FileTransferRecord {
                file_id: file_id.clone(),
                file_name: safe_name.clone(),
                file_size: expected_size,
                bytes_transferred: 0,
                direction: "RECEIVED".to_string(),
                status: "PENDING".to_string(),
                saved_path: Some(dest_path.to_string_lossy().to_string()),
                thumbnail_base64: None,
                timestamp: current_time_label(),
            },
        );
    }
    emit_file_transfers(&state.network, &state.app_handle);

    let mut total_bytes = 0u64;
    let mut last_emit = Instant::now();
    let mut stream = body.into_data_stream();
    while let Some(chunk_res) = stream.next().await {
        let Ok(chunk) = chunk_res else {
            let _ = tokio::fs::remove_file(&dest_path).await;
            mark_transfer_failed(&state.network, &state.app_handle, &file_id);
            return (StatusCode::BAD_REQUEST, "Flux interrompu").into_response();
        };
        if file.write_all(&chunk).await.is_err() {
            let _ = tokio::fs::remove_file(&dest_path).await;
            mark_transfer_failed(&state.network, &state.app_handle, &file_id);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Erreur d'écriture").into_response();
        }
        total_bytes += chunk.len() as u64;
        if last_emit.elapsed() >= PROGRESS_EMIT_INTERVAL {
            last_emit = Instant::now();
            update_transfer_progress(&state.network, &state.app_handle, &file_id, total_bytes);
        }
    }

    let _ = file.flush().await;

    let thumbnail_base64 = if guess_mime_type(&safe_name).starts_with("image/") {
        generate_image_thumbnail_base64(&dest_path)
    } else {
        None
    };

    {
        let mut guard = state.network.lock().unwrap();
        if let Some(rec) = guard
            .file_transfers
            .iter_mut()
            .find(|r| r.file_id == file_id)
        {
            rec.file_size = total_bytes;
            rec.bytes_transferred = total_bytes;
            rec.status = "COMPLETED".to_string();
            rec.thumbnail_base64 = thumbnail_base64;
        }
    }

    emit_file_transfers(&state.network, &state.app_handle);

    let _ = state
        .app_handle
        .notification()
        .builder()
        .title("Fichier reçu via NexusLink")
        .body(format!(
            "{} enregistré dans Téléchargements\\NexusLink",
            safe_name
        ))
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

            let reader_stream = ReaderStream::with_capacity(file, 64 * 1024);
            let progress_network = Arc::clone(&state.network);
            let progress_app = state.app_handle.clone();
            let progress_file_id = file_id.clone();

            let tracked_stream = futures_util::stream::unfold(
                (reader_stream, 0u64, Instant::now()),
                move |(mut inner, mut sent_bytes, mut last_emit)| {
                    let net = Arc::clone(&progress_network);
                    let app = progress_app.clone();
                    let fid = progress_file_id.clone();
                    async move {
                        match inner.next().await {
                            Some(Ok(chunk)) => {
                                sent_bytes += chunk.len() as u64;
                                if file_len > 0 && sent_bytes >= file_len {
                                    mark_transfer_completed(
                                        &net,
                                        &app,
                                        &fid,
                                        file_len.max(sent_bytes),
                                    );
                                } else if last_emit.elapsed() >= PROGRESS_EMIT_INTERVAL {
                                    last_emit = Instant::now();
                                    update_transfer_progress(&net, &app, &fid, sent_bytes);
                                }
                                Some((
                                    Ok::<Bytes, std::io::Error>(chunk),
                                    (inner, sent_bytes, last_emit),
                                ))
                            }
                            Some(Err(err)) => {
                                mark_transfer_failed(&net, &app, &fid);
                                Some((Err(err), (inner, sent_bytes, last_emit)))
                            }
                            None => {
                                mark_transfer_completed(&net, &app, &fid, file_len.max(sent_bytes));
                                None
                            }
                        }
                    }
                },
            );

            let body = Body::from_stream(tracked_stream);

            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, guess_mime_type(file_name))
                .header(header::CONTENT_LENGTH, file_len)
                .body(body)
                .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Erreur").into_response())
        }
    }
}

fn update_transfer_progress(
    network: &Arc<Mutex<NetworkState>>,
    app_handle: &AppHandle,
    file_id: &str,
    bytes_transferred: u64,
) {
    let updated = {
        let mut guard = network.lock().unwrap();
        if let Some(rec) = guard
            .file_transfers
            .iter_mut()
            .find(|r| r.file_id == file_id)
        {
            rec.bytes_transferred = bytes_transferred;
            true
        } else {
            false
        }
    };
    if updated {
        emit_file_transfers(network, app_handle);
    }
}

fn mark_transfer_completed(
    network: &Arc<Mutex<NetworkState>>,
    app_handle: &AppHandle,
    file_id: &str,
    total_bytes: u64,
) {
    let changed = {
        let mut guard = network.lock().unwrap();
        if let Some(rec) = guard
            .file_transfers
            .iter_mut()
            .find(|r| r.file_id == file_id)
        {
            if rec.status == "COMPLETED" {
                false
            } else {
                rec.bytes_transferred = total_bytes;
                rec.status = "COMPLETED".to_string();
                true
            }
        } else {
            false
        }
    };
    if changed {
        emit_file_transfers(network, app_handle);
    }
}

fn mark_transfer_failed(network: &Arc<Mutex<NetworkState>>, app_handle: &AppHandle, file_id: &str) {
    {
        let mut guard = network.lock().unwrap();
        if let Some(rec) = guard
            .file_transfers
            .iter_mut()
            .find(|r| r.file_id == file_id)
        {
            rec.status = "FAILED".to_string();
        }
    }
    emit_file_transfers(network, app_handle);
}

fn is_authorized(headers: &HeaderMap, state: &Arc<Mutex<NetworkState>>) -> bool {
    let Some(auth_val) = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
    else {
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

#[derive(Deserialize)]
struct StreamQuery {
    token: String,
}

/// Reçoit une frame JPEG envoyée par le téléphone pendant la recopie d'écran
async fn handle_screen_frame_upload(
    State(state): State<HttpServerState>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    if !is_authorized(&headers, &state.network) {
        return (StatusCode::UNAUTHORIZED, "Non autorisé").into_response();
    }
    if body.is_empty() || body.len() > 8 * 1024 * 1024 {
        return (StatusCode::BAD_REQUEST, "Taille de frame invalide").into_response();
    }

    let sender = {
        let guard = state.network.lock().unwrap();
        guard.screen_frame_tx.clone()
    };
    let _ = sender.send(Some(Arc::new(body.to_vec())));
    StatusCode::NO_CONTENT.into_response()
}

/// Diffuse le flux vidéo MJPEG (multipart/x-mixed-replace) vers l'interface PC Tauri
async fn handle_screen_stream(
    State(state): State<HttpServerState>,
    Query(query): Query<StreamQuery>,
) -> Response {
    let (valid_token, rx) = {
        let guard = state.network.lock().unwrap();
        (
            query.token == guard.pairing_token,
            guard.screen_frame_tx.subscribe(),
        )
    };

    if !valid_token {
        return (StatusCode::UNAUTHORIZED, "Jeton de flux invalide").into_response();
    }

    let stream = futures_util::stream::unfold((rx, true), |(mut rx, mut first)| async move {
        loop {
            let maybe_frame = if first {
                first = false;
                rx.borrow_and_update().clone()
            } else {
                if rx.changed().await.is_err() {
                    return None;
                }
                rx.borrow_and_update().clone()
            };

            if let Some(frame) = maybe_frame {
                let header = format!(
                    "--nexusframe\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\n\r\n",
                    frame.len()
                );
                let mut part = Vec::with_capacity(header.len() + frame.len() + 2);
                part.extend_from_slice(header.as_bytes());
                part.extend_from_slice(&frame);
                part.extend_from_slice(b"\r\n");
                return Some((Ok::<Bytes, std::io::Error>(Bytes::from(part)), (rx, false)));
            }
        }
    });

    Response::builder()
        .status(StatusCode::OK)
        .header(
            header::CONTENT_TYPE,
            "multipart/x-mixed-replace; boundary=nexusframe",
        )
        .header(header::CACHE_CONTROL, "no-store, no-cache, must-revalidate")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

/// Relais HTTP local des miniatures de la galerie Android (avec cache mémoire PC)
async fn handle_media_thumb(
    State(state): State<HttpServerState>,
    path: AxumPath<(String, i64)>,
) -> Response {
    crate::media_gallery::proxy_media_thumb(path, Arc::clone(&state.network)).await
}

/// Relais HTTP streaming (Range / 206) des photos et vidéos originales depuis Android
async fn handle_media_file(
    State(state): State<HttpServerState>,
    path: AxumPath<(String, i64)>,
    headers: HeaderMap,
) -> Response {
    crate::media_gallery::proxy_media_file(path, headers, Arc::clone(&state.network)).await
}
