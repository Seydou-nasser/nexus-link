use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::time::timeout;

use crate::file_server::get_nexus_downloads_dir;
use crate::media_gallery::ANDROID_MEDIA_HTTP_PORT;
use crate::network::NetworkState;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const READ_TIMEOUT: Duration = Duration::from_secs(30);
const IO_CHUNK_SIZE: usize = 64 * 1024;
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(120);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsTransferProgressPayload {
    pub file_name: String,
    pub direction: String,
    pub bytes_transferred: u64,
    pub total_bytes: u64,
    pub speed_bytes_per_sec: u64,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsShortcutDto {
    pub label: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsStorageInfoDto {
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub used_bytes: u64,
    pub has_all_files_access: bool,
    pub shortcuts: Vec<FsShortcutDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntryDto {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    pub last_modified: i64,
    pub extension: String,
    pub child_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsListResponse {
    pub current_path: String,
    pub parent_path: Option<String>,
    pub entries: Vec<FsEntryDto>,
}

fn get_android_target(state: &Arc<Mutex<NetworkState>>) -> Result<(String, String), String> {
    let guard = state.lock().unwrap();
    let Some((ip, _udp_port, secret)) = guard.get_active_udp_target() else {
        return Err("Aucun téléphone Android connecté.".to_string());
    };
    Ok((ip, secret))
}

async fn read_http_head(reader: &mut BufReader<TcpStream>) -> Result<(u16, u64), String> {
    let mut status_line = String::new();
    timeout(READ_TIMEOUT, reader.read_line(&mut status_line))
        .await
        .map_err(|_| "Délai dépassé en attente de la réponse Android".to_string())?
        .map_err(|e| format!("Erreur de lecture réponse Android : {}", e))?;

    let status_code = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| format!("Statut HTTP invalide : {}", status_line.trim()))?;

    let mut content_length = 0u64;
    loop {
        let mut line = String::new();
        timeout(READ_TIMEOUT, reader.read_line(&mut line))
            .await
            .map_err(|_| "Délai dépassé lors de la lecture des en-têtes".to_string())?
            .map_err(|e| format!("Erreur de lecture des en-têtes : {}", e))?;
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some((k, v)) = trimmed.split_once(':') {
            if k.trim().eq_ignore_ascii_case("content-length") {
                if let Ok(parsed) = v.trim().parse::<u64>() {
                    content_length = parsed;
                }
            }
        }
    }

    Ok((status_code, content_length))
}

fn emit_fs_progress(
    app_handle: &AppHandle,
    file_name: &str,
    direction: &str,
    bytes_transferred: u64,
    total_bytes: u64,
    started_at: Instant,
    done: bool,
) {
    let elapsed_secs = started_at.elapsed().as_secs_f64();
    let speed = if elapsed_secs > 0.05 {
        (bytes_transferred as f64 / elapsed_secs) as u64
    } else {
        0
    };
    let _ = app_handle.emit(
        "nexus://fs-transfer-progress",
        FsTransferProgressPayload {
            file_name: file_name.to_string(),
            direction: direction.to_string(),
            bytes_transferred,
            total_bytes,
            speed_bytes_per_sec: speed,
            done,
        },
    );
}

async fn send_android_request(
    method: &str,
    ip: &str,
    secret: &str,
    path_and_query: &str,
    json_body: Option<&[u8]>,
) -> Result<(u16, Vec<u8>), String> {
    let addr = format!("{}:{}", ip, ANDROID_MEDIA_HTTP_PORT);
    let mut stream = timeout(CONNECT_TIMEOUT, TcpStream::connect(&addr))
        .await
        .map_err(|_| format!("Délai dépassé lors de la connexion à {}", addr))?
        .map_err(|e| format!("Impossible de joindre Android ({}) : {}", addr, e))?;

    let mut request = format!(
        "{} {} HTTP/1.1\r\nHost: {}\r\nX-Nexus-Token: {}\r\nConnection: close\r\n",
        method, path_and_query, addr, secret
    );
    if let Some(body) = json_body {
        request.push_str("Content-Type: application/json; charset=utf-8\r\n");
        request.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    request.push_str("\r\n");

    timeout(CONNECT_TIMEOUT, stream.write_all(request.as_bytes()))
        .await
        .map_err(|_| "Délai dépassé lors de l'envoi de la requête".to_string())?
        .map_err(|e| format!("Erreur d'envoi vers Android : {}", e))?;

    if let Some(body) = json_body {
        timeout(CONNECT_TIMEOUT, stream.write_all(body))
            .await
            .map_err(|_| "Délai dépassé lors de l'envoi du corps JSON".to_string())?
            .map_err(|e| format!("Erreur d'envoi JSON vers Android : {}", e))?;
    }

    let mut reader = BufReader::with_capacity(IO_CHUNK_SIZE, stream);
    let (status, _) = read_http_head(&mut reader).await?;
    let mut body = Vec::new();
    timeout(READ_TIMEOUT, reader.read_to_end(&mut body))
        .await
        .map_err(|_| "Délai dépassé lors de la lecture de la réponse".to_string())?
        .map_err(|e| format!("Erreur de lecture réponse : {}", e))?;

    Ok((status, body))
}

fn map_error(status: u16, body: &[u8]) -> String {
    let text = String::from_utf8_lossy(body).trim().to_string();
    if !text.is_empty() {
        text
    } else {
        format!("Erreur serveur Android (HTTP {})", status)
    }
}

pub async fn fs_storage_info(state: &Arc<Mutex<NetworkState>>) -> Result<FsStorageInfoDto, String> {
    let (ip, secret) = get_android_target(state)?;
    let (status, body) = send_android_request("GET", &ip, &secret, "/fs/info", None).await?;
    if status != 200 {
        return Err(map_error(status, &body));
    }
    serde_json::from_slice(&body)
        .map_err(|e| format!("Impossible de décoder les infos stockage : {}", e))
}

pub async fn fs_list_dir(
    state: &Arc<Mutex<NetworkState>>,
    path: String,
) -> Result<FsListResponse, String> {
    let (ip, secret) = get_android_target(state)?;
    let url = format!("/fs/list?path={}", encode_query_component(&path));
    let (status, body) = send_android_request("GET", &ip, &secret, &url, None).await?;
    if status != 200 {
        return Err(map_error(status, &body));
    }
    serde_json::from_slice(&body).map_err(|e| format!("Impossible de décoder le dossier : {}", e))
}

pub async fn fs_search_entries(
    state: &Arc<Mutex<NetworkState>>,
    path: String,
    query: String,
) -> Result<Vec<FsEntryDto>, String> {
    let (ip, secret) = get_android_target(state)?;
    let url = format!(
        "/fs/search?path={}&q={}",
        encode_query_component(&path),
        encode_query_component(&query)
    );
    let (status, body) = send_android_request("GET", &ip, &secret, &url, None).await?;
    if status != 200 {
        return Err(map_error(status, &body));
    }
    serde_json::from_slice(&body)
        .map_err(|e| format!("Impossible de décoder les résultats de recherche : {}", e))
}

pub async fn fs_create_dir(
    state: &Arc<Mutex<NetworkState>>,
    parent_path: String,
    name: String,
) -> Result<FsEntryDto, String> {
    let (ip, secret) = get_android_target(state)?;
    let payload = serde_json::json!({
        "parentPath": parent_path,
        "name": name,
    });
    let payload_bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let (status, body) =
        send_android_request("POST", &ip, &secret, "/fs/mkdir", Some(&payload_bytes)).await?;
    if status != 200 {
        return Err(map_error(status, &body));
    }
    serde_json::from_slice(&body)
        .map_err(|e| format!("Impossible de décoder le nouveau dossier : {}", e))
}

pub async fn fs_rename_entry(
    state: &Arc<Mutex<NetworkState>>,
    path: String,
    new_name: String,
) -> Result<FsEntryDto, String> {
    let (ip, secret) = get_android_target(state)?;
    let payload = serde_json::json!({
        "path": path,
        "newName": new_name,
    });
    let payload_bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let (status, body) =
        send_android_request("POST", &ip, &secret, "/fs/rename", Some(&payload_bytes)).await?;
    if status != 200 {
        return Err(map_error(status, &body));
    }
    serde_json::from_slice(&body)
        .map_err(|e| format!("Impossible de décoder l'élément renommé : {}", e))
}

pub async fn fs_delete_entry(state: &Arc<Mutex<NetworkState>>, path: String) -> Result<(), String> {
    let (ip, secret) = get_android_target(state)?;
    let url = format!("/fs/delete?path={}", encode_query_component(&path));
    let (status, body) = send_android_request("DELETE", &ip, &secret, &url, None).await?;
    if status != 200 {
        return Err(map_error(status, &body));
    }
    Ok(())
}

pub async fn fs_move_entry(
    state: &Arc<Mutex<NetworkState>>,
    source_path: String,
    target_dir: String,
) -> Result<FsEntryDto, String> {
    let (ip, secret) = get_android_target(state)?;
    let payload = serde_json::json!({
        "sourcePath": source_path,
        "targetDir": target_dir,
    });
    let payload_bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let (status, body) =
        send_android_request("POST", &ip, &secret, "/fs/move", Some(&payload_bytes)).await?;
    if status != 200 {
        return Err(map_error(status, &body));
    }
    serde_json::from_slice(&body)
        .map_err(|e| format!("Impossible de décoder l'élément déplacé : {}", e))
}

pub async fn fs_copy_entry(
    state: &Arc<Mutex<NetworkState>>,
    source_path: String,
    target_dir: String,
) -> Result<FsEntryDto, String> {
    let (ip, secret) = get_android_target(state)?;
    let payload = serde_json::json!({
        "sourcePath": source_path,
        "targetDir": target_dir,
    });
    let payload_bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let (status, body) =
        send_android_request("POST", &ip, &secret, "/fs/copy", Some(&payload_bytes)).await?;
    if status != 200 {
        return Err(map_error(status, &body));
    }
    serde_json::from_slice(&body)
        .map_err(|e| format!("Impossible de décoder l'élément copié : {}", e))
}

/// Télécharge un fichier Android en streaming (64 Ko) dans Téléchargements/NexusLink
pub async fn fs_download_file(
    state: &Arc<Mutex<NetworkState>>,
    app_handle: &AppHandle,
    path: String,
    display_name: String,
) -> Result<String, String> {
    let (ip, secret) = get_android_target(state)?;
    let addr = format!("{}:{}", ip, ANDROID_MEDIA_HTTP_PORT);
    let url = format!("/fs/download?path={}", encode_query_component(&path));

    let mut stream = timeout(CONNECT_TIMEOUT, TcpStream::connect(&addr))
        .await
        .map_err(|_| format!("Délai dépassé lors de la connexion à {}", addr))?
        .map_err(|e| format!("Impossible de joindre Android ({}) : {}", addr, e))?;

    let request = format!(
        "GET {} HTTP/1.1\r\nHost: {}\r\nX-Nexus-Token: {}\r\nConnection: close\r\n\r\n",
        url, addr, secret
    );
    timeout(CONNECT_TIMEOUT, stream.write_all(request.as_bytes()))
        .await
        .map_err(|_| "Délai dépassé lors de la demande de téléchargement".to_string())?
        .map_err(|e| format!("Erreur d'envoi vers Android : {}", e))?;

    let mut reader = BufReader::with_capacity(IO_CHUNK_SIZE, stream);
    let (status, total_bytes) = read_http_head(&mut reader).await?;
    if status != 200 {
        let mut err_body = Vec::new();
        let _ = reader.read_to_end(&mut err_body).await;
        return Err(map_error(status, &err_body));
    }

    let target_path = build_unique_download_path(&display_name);
    let mut file = tokio::fs::File::create(&target_path)
        .await
        .map_err(|e| format!("Impossible de créer le fichier local : {}", e))?;

    let started_at = Instant::now();
    let mut last_emit = Instant::now();
    let mut downloaded_bytes = 0u64;
    emit_fs_progress(
        app_handle,
        &display_name,
        "DOWNLOAD",
        0,
        total_bytes,
        started_at,
        false,
    );

    let mut buf = vec![0u8; IO_CHUNK_SIZE];
    loop {
        let read = match reader.read(&mut buf).await {
            Ok(n) => n,
            Err(e) => {
                emit_fs_progress(
                    app_handle,
                    &display_name,
                    "DOWNLOAD",
                    downloaded_bytes,
                    total_bytes,
                    started_at,
                    true,
                );
                return Err(format!("Erreur réseau pendant le téléchargement : {}", e));
            }
        };
        if read == 0 {
            break;
        }
        if let Err(e) = file.write_all(&buf[..read]).await {
            emit_fs_progress(
                app_handle,
                &display_name,
                "DOWNLOAD",
                downloaded_bytes,
                total_bytes,
                started_at,
                true,
            );
            return Err(format!("Erreur d'écriture locale : {}", e));
        }
        downloaded_bytes += read as u64;
        if last_emit.elapsed() >= PROGRESS_EMIT_INTERVAL {
            last_emit = Instant::now();
            emit_fs_progress(
                app_handle,
                &display_name,
                "DOWNLOAD",
                downloaded_bytes,
                total_bytes.max(downloaded_bytes),
                started_at,
                false,
            );
        }
    }
    file.flush()
        .await
        .map_err(|e| format!("Erreur de finalisation du fichier : {}", e))?;

    emit_fs_progress(
        app_handle,
        &display_name,
        "DOWNLOAD",
        downloaded_bytes,
        total_bytes.max(downloaded_bytes),
        started_at,
        true,
    );

    Ok(target_path.to_string_lossy().to_string())
}

/// Envoie un ou plusieurs fichiers PC en streaming (64 Ko) directement dans le dossier Android cible
pub async fn fs_upload_files(
    state: &Arc<Mutex<NetworkState>>,
    app_handle: &AppHandle,
    target_dir: String,
    local_paths: Vec<PathBuf>,
) -> Result<usize, String> {
    let (ip, secret) = get_android_target(state)?;
    let addr = format!("{}:{}", ip, ANDROID_MEDIA_HTTP_PORT);
    let mut uploaded = 0usize;

    for path in local_paths {
        let meta = match tokio::fs::metadata(&path).await {
            Ok(m) if m.is_file() => m,
            _ => continue,
        };
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("fichier")
            .to_string();
        let file_size = meta.len();

        let url = format!(
            "/fs/upload?dir={}&name={}",
            encode_query_component(&target_dir),
            encode_query_component(&file_name)
        );

        let mut stream = timeout(CONNECT_TIMEOUT, TcpStream::connect(&addr))
            .await
            .map_err(|_| format!("Délai dépassé lors de la connexion à {}", addr))?
            .map_err(|e| format!("Impossible de joindre Android ({}) : {}", addr, e))?;

        let header = format!(
            "POST {} HTTP/1.1\r\nHost: {}\r\nX-Nexus-Token: {}\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            url, addr, secret, file_size
        );
        stream
            .write_all(header.as_bytes())
            .await
            .map_err(|e| format!("Erreur d'envoi en-tête upload : {}", e))?;

        let mut file = tokio::fs::File::open(&path)
            .await
            .map_err(|e| format!("Impossible d'ouvrir {} : {}", file_name, e))?;

        let started_at = Instant::now();
        let mut last_emit = Instant::now();
        let mut sent_bytes = 0u64;
        emit_fs_progress(
            app_handle, &file_name, "UPLOAD", 0, file_size, started_at, false,
        );

        let mut buf = vec![0u8; IO_CHUNK_SIZE];
        loop {
            let read = match file.read(&mut buf).await {
                Ok(n) => n,
                Err(e) => {
                    emit_fs_progress(
                        app_handle, &file_name, "UPLOAD", sent_bytes, file_size, started_at, true,
                    );
                    return Err(format!("Erreur lecture locale : {}", e));
                }
            };
            if read == 0 {
                break;
            }
            if let Err(e) = stream.write_all(&buf[..read]).await {
                emit_fs_progress(
                    app_handle, &file_name, "UPLOAD", sent_bytes, file_size, started_at, true,
                );
                return Err(format!("Erreur réseau pendant l'envoi : {}", e));
            }
            sent_bytes += read as u64;
            if last_emit.elapsed() >= PROGRESS_EMIT_INTERVAL {
                last_emit = Instant::now();
                emit_fs_progress(
                    app_handle, &file_name, "UPLOAD", sent_bytes, file_size, started_at, false,
                );
            }
        }
        stream
            .flush()
            .await
            .map_err(|e| format!("Erreur finalisation envoi : {}", e))?;

        let mut reader = BufReader::with_capacity(4096, stream);
        let (status, _) = read_http_head(&mut reader).await?;
        emit_fs_progress(
            app_handle, &file_name, "UPLOAD", sent_bytes, file_size, started_at, true,
        );
        if status != 200 {
            let mut err_body = Vec::new();
            let _ = reader.read_to_end(&mut err_body).await;
            return Err(map_error(status, &err_body));
        }

        uploaded += 1;
    }

    Ok(uploaded)
}

fn encode_query_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => {
                out.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    out
}

fn build_unique_download_path(display_name: &str) -> PathBuf {
    let dir = get_nexus_downloads_dir();
    let sanitized: String = display_name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => c,
        })
        .collect();
    let safe_name = if sanitized.trim().is_empty() {
        "fichier_nexuslink".to_string()
    } else {
        sanitized
    };

    let candidate = dir.join(&safe_name);
    if !candidate.exists() {
        return candidate;
    }

    let stem = candidate
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("fichier");
    let ext = candidate.extension().and_then(|e| e.to_str());

    for idx in 1..1000 {
        let next_name = match ext {
            Some(e) => format!("{} ({}).{}", stem, idx, e),
            None => format!("{} ({})", stem, idx),
        };
        let next_path = dir.join(next_name);
        if !next_path.exists() {
            return next_path;
        }
    }
    dir.join(safe_name)
}
