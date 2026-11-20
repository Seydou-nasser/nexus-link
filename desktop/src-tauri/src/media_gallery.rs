use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::extract::Path as AxumPath;
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::time::timeout;
use tokio_util::io::ReaderStream;

use crate::file_server::get_nexus_downloads_dir;
use crate::network::NetworkState;

pub const ANDROID_MEDIA_HTTP_PORT: u16 = 52843;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const READ_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_CACHED_THUMBS: usize = 200;

/// Dossier (album) exposé par MediaStore sur Android
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFolderDto {
    pub bucket_id: String,
    pub name: String,
    pub item_count: usize,
    pub photo_count: usize,
    pub video_count: usize,
    pub cover_media_id: i64,
    pub cover_media_type: String,
    pub latest_date_added: i64,
}

/// Élément média (photo ou vidéo) exposé par MediaStore sur Android
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaItemDto {
    pub id: i64,
    pub media_type: String,
    pub display_name: String,
    pub mime_type: String,
    pub size: u64,
    pub date_added: i64,
    pub width: i32,
    pub height: i32,
    pub duration_ms: i64,
    pub bucket_id: String,
    pub bucket_name: String,
}

/// Réponse paginée des médias récents ou d'un dossier
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaPageResponse {
    pub items: Vec<MediaItemDto>,
    pub total: usize,
    pub offset: usize,
    pub limit: usize,
    pub has_more: bool,
}

/// Petit cache mémoire FIFO/LRU borné côté PC pour les miniatures JPEG (~2 à 3 Mo max)
struct ThumbCache {
    device_ip: String,
    entries: HashMap<String, Bytes>,
    order: VecDeque<String>,
}

impl ThumbCache {
    fn new() -> Self {
        Self {
            device_ip: String::new(),
            entries: HashMap::new(),
            order: VecDeque::new(),
        }
    }

    fn get(&mut self, device_ip: &str, key: &str) -> Option<Bytes> {
        if self.device_ip != device_ip {
            self.entries.clear();
            self.order.clear();
            self.device_ip = device_ip.to_string();
            return None;
        }
        self.entries.get(key).cloned()
    }

    fn insert(&mut self, device_ip: &str, key: String, value: Bytes) {
        if self.device_ip != device_ip {
            self.entries.clear();
            self.order.clear();
            self.device_ip = device_ip.to_string();
        }
        if self.entries.contains_key(&key) {
            self.entries.insert(key, value);
            return;
        }
        while self.order.len() >= MAX_CACHED_THUMBS {
            if let Some(oldest) = self.order.pop_front() {
                self.entries.remove(&oldest);
            }
        }
        self.order.push_back(key.clone());
        self.entries.insert(key, value);
    }

    fn remove(&mut self, device_ip: &str, key: &str) {
        if self.device_ip != device_ip {
            return;
        }
        self.entries.remove(key);
        self.order.retain(|k| k != key);
    }
}

fn thumb_cache() -> &'static Mutex<ThumbCache> {
    static CACHE: OnceLock<Mutex<ThumbCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(ThumbCache::new()))
}

struct ParsedHttpHead {
    status_code: u16,
    headers: HashMap<String, String>,
    reader: BufReader<TcpStream>,
}

/// Récupère l'IP et le secret de session du téléphone connecté
fn get_android_media_target(state: &Arc<Mutex<NetworkState>>) -> Result<(String, String), String> {
    let guard = state.lock().unwrap();
    let Some((ip, _udp_port, secret)) = guard.get_active_udp_target() else {
        return Err("Aucun téléphone Android connecté.".to_string());
    };
    Ok((ip, secret))
}

/// Ouvre une requête HTTP/1.1 (GET ou DELETE) vers le serveur média Android (:52843) et lit le statut + en-têtes
async fn send_android_request(
    method: &str,
    ip: &str,
    secret: &str,
    path_and_query: &str,
    range_header: Option<&str>,
) -> Result<ParsedHttpHead, String> {
    let addr = format!("{}:{}", ip, ANDROID_MEDIA_HTTP_PORT);
    let mut stream = timeout(CONNECT_TIMEOUT, TcpStream::connect(&addr))
        .await
        .map_err(|_| format!("Délai dépassé lors de la connexion à {}", addr))?
        .map_err(|e| {
            format!(
                "Impossible de joindre le serveur galerie Android ({}) : {}",
                addr, e
            )
        })?;

    let mut request = format!(
        "{} {} HTTP/1.1\r\nHost: {}\r\nX-Nexus-Token: {}\r\nConnection: close\r\n",
        method, path_and_query, addr, secret
    );
    if let Some(range) = range_header {
        request.push_str(&format!("Range: {}\r\n", range));
    }
    request.push_str("\r\n");

    timeout(CONNECT_TIMEOUT, stream.write_all(request.as_bytes()))
        .await
        .map_err(|_| "Délai dépassé lors de l'envoi de la requête galerie".to_string())?
        .map_err(|e| format!("Erreur d'envoi vers Android : {}", e))?;

    let mut reader = BufReader::with_capacity(64 * 1024, stream);
    let mut status_line = String::new();
    timeout(READ_TIMEOUT, reader.read_line(&mut status_line))
        .await
        .map_err(|_| "Délai dépassé en attente de la réponse galerie".to_string())?
        .map_err(|e| format!("Erreur de lecture réponse Android : {}", e))?;

    let status_code = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| format!("Ligne de statut HTTP invalide : {}", status_line.trim()))?;

    let mut headers = HashMap::new();
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
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }

    Ok(ParsedHttpHead {
        status_code,
        headers,
        reader,
    })
}

/// Exécute une requête GET et lit l'intégralité du corps en mémoire (pour JSON et miniatures)
async fn fetch_android_bytes(
    ip: &str,
    secret: &str,
    path_and_query: &str,
) -> Result<(u16, HashMap<String, String>, Vec<u8>), String> {
    let mut head = send_android_request("GET", ip, secret, path_and_query, None).await?;
    let mut body = Vec::new();
    timeout(READ_TIMEOUT, head.reader.read_to_end(&mut body))
        .await
        .map_err(|_| "Délai dépassé lors de la lecture du corps".to_string())?
        .map_err(|e| format!("Erreur de lecture du corps : {}", e))?;

    Ok((head.status_code, head.headers, body))
}

/// Liste les dossiers (albums) de la galerie Android
pub async fn fetch_media_folders(
    state: &Arc<Mutex<NetworkState>>,
) -> Result<Vec<MediaFolderDto>, String> {
    let (ip, secret) = get_android_media_target(state)?;
    let (status, _headers, body) = fetch_android_bytes(&ip, &secret, "/media/folders").await?;
    if status != 200 {
        return Err(format!("Erreur Android (/media/folders) : HTTP {}", status));
    }
    serde_json::from_slice(&body)
        .map_err(|e| format!("Impossible de décoder la liste des dossiers : {}", e))
}

/// Liste une page de photos et vidéos (tous dossiers ou filtrée par bucketId)
pub async fn fetch_media_items(
    state: &Arc<Mutex<NetworkState>>,
    bucket_id: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<MediaPageResponse, String> {
    let (ip, secret) = get_android_media_target(state)?;
    let safe_limit = limit.unwrap_or(60).clamp(1, 200);
    let safe_offset = offset.unwrap_or(0);

    let mut path = format!("/media/items?limit={}&offset={}", safe_limit, safe_offset);
    if let Some(bucket) = bucket_id.filter(|b| !b.trim().is_empty()) {
        path.push_str("&bucketId=");
        path.push_str(&encode_query_component(&bucket));
    }

    let (status, _headers, body) = fetch_android_bytes(&ip, &secret, &path).await?;
    if status != 200 {
        return Err(format!("Erreur Android (/media/items) : HTTP {}", status));
    }
    serde_json::from_slice(&body).map_err(|e| format!("Impossible de décoder les médias : {}", e))
}

/// Télécharge un média original en streaming dans Téléchargements/NexusLink
pub async fn download_media_to_pc(
    state: &Arc<Mutex<NetworkState>>,
    media_id: i64,
    media_type: &str,
    display_name: &str,
) -> Result<String, String> {
    let (ip, secret) = get_android_media_target(state)?;
    let normalized = normalize_media_type(media_type)?;
    let path = format!("/media/file/{}/{}", normalized, media_id);

    let mut head = send_android_request("GET", &ip, &secret, &path, None).await?;
    if head.status_code != 200 {
        return Err(format!(
            "Impossible de télécharger le média : HTTP {}",
            head.status_code
        ));
    }

    let target_path = build_unique_download_path(display_name);
    let mut file = tokio::fs::File::create(&target_path)
        .await
        .map_err(|e| format!("Impossible de créer le fichier local : {}", e))?;

    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let read = head
            .reader
            .read(&mut buf)
            .await
            .map_err(|e| format!("Erreur de lecture réseau : {}", e))?;
        if read == 0 {
            break;
        }
        file.write_all(&buf[..read])
            .await
            .map_err(|e| format!("Erreur d'écriture locale : {}", e))?;
    }
    file.flush()
        .await
        .map_err(|e| format!("Erreur de finalisation fichier : {}", e))?;

    Ok(target_path.to_string_lossy().to_string())
}

/// Supprime directement une photo ou une vidéo sur le téléphone Android connecté
pub async fn delete_media_on_phone(
    state: &Arc<Mutex<NetworkState>>,
    media_id: i64,
    media_type: &str,
) -> Result<(), String> {
    let (ip, secret) = get_android_media_target(state)?;
    let normalized = normalize_media_type(media_type)?;
    let path = format!("/media/file/{}/{}", normalized, media_id);

    let mut head = send_android_request("DELETE", &ip, &secret, &path, None).await?;
    let mut body = Vec::new();
    let _ = timeout(READ_TIMEOUT, head.reader.read_to_end(&mut body)).await;

    if head.status_code == 200 {
        let cache_key = format!("{}:{}", normalized, media_id);
        thumb_cache().lock().unwrap().remove(&ip, &cache_key);
        return Ok(());
    }

    let server_msg = String::from_utf8_lossy(&body).trim().to_string();
    if !server_msg.is_empty() {
        Err(server_msg)
    } else {
        Err(format!(
            "Échec de la suppression (HTTP {})",
            head.status_code
        ))
    }
}

/// Proxy Axum : GET /api/v1/media/thumb/{media_type}/{media_id}
pub async fn proxy_media_thumb(
    AxumPath((media_type, media_id)): AxumPath<(String, i64)>,
    network: Arc<Mutex<NetworkState>>,
) -> Response {
    let Ok((ip, secret)) = get_android_media_target(&network) else {
        return (StatusCode::SERVICE_UNAVAILABLE, "Téléphone non connecté").into_response();
    };
    let Ok(normalized) = normalize_media_type(&media_type) else {
        return (StatusCode::BAD_REQUEST, "Type média invalide").into_response();
    };

    let cache_key = format!("{}:{}", normalized, media_id);
    if let Some(cached) = thumb_cache().lock().unwrap().get(&ip, &cache_key) {
        return build_jpeg_thumb_response(cached);
    }

    let path = format!("/media/thumb/{}/{}", normalized, media_id);
    match fetch_android_bytes(&ip, &secret, &path).await {
        Ok((200, _headers, bytes)) if !bytes.is_empty() => {
            let shared_bytes = Bytes::from(bytes);
            thumb_cache()
                .lock()
                .unwrap()
                .insert(&ip, cache_key, shared_bytes.clone());
            build_jpeg_thumb_response(shared_bytes)
        }
        Ok((404, _, _)) => (StatusCode::NOT_FOUND, "Miniature introuvable").into_response(),
        Ok((code, _, _)) => (
            StatusCode::from_u16(code).unwrap_or(StatusCode::BAD_GATEWAY),
            "Erreur serveur Android",
        )
            .into_response(),
        Err(err) => (StatusCode::BAD_GATEWAY, err).into_response(),
    }
}

/// Proxy Axum streaming (avec support Range / 206 pour les vidéos HTML5) :
/// GET /api/v1/media/file/{media_type}/{media_id}
pub async fn proxy_media_file(
    AxumPath((media_type, media_id)): AxumPath<(String, i64)>,
    req_headers: HeaderMap,
    network: Arc<Mutex<NetworkState>>,
) -> Response {
    let Ok((ip, secret)) = get_android_media_target(&network) else {
        return (StatusCode::SERVICE_UNAVAILABLE, "Téléphone non connecté").into_response();
    };
    let Ok(normalized) = normalize_media_type(&media_type) else {
        return (StatusCode::BAD_REQUEST, "Type média invalide").into_response();
    };

    let range_header = req_headers.get(header::RANGE).and_then(|v| v.to_str().ok());
    let path = format!("/media/file/{}/{}", normalized, media_id);

    let head = match send_android_request("GET", &ip, &secret, &path, range_header).await {
        Ok(h) => h,
        Err(err) => return (StatusCode::BAD_GATEWAY, err).into_response(),
    };

    let status = StatusCode::from_u16(head.status_code).unwrap_or(StatusCode::BAD_GATEWAY);
    let mut builder = Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");

    for header_name in [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "content-disposition",
        "cache-control",
    ] {
        if let Some(val) = head.headers.get(header_name) {
            if let Ok(hv) = HeaderValue::from_str(val) {
                builder = builder.header(header_name, hv);
            }
        }
    }

    let stream = ReaderStream::with_capacity(head.reader, 64 * 1024);
    builder
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn build_jpeg_thumb_response(bytes: Bytes) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/jpeg")
        .header(header::CACHE_CONTROL, "public, max-age=3600")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Body::from(bytes))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn normalize_media_type(raw: &str) -> Result<&'static str, String> {
    match raw.to_ascii_uppercase().as_str() {
        "IMAGE" | "PHOTO" => Ok("IMAGE"),
        "VIDEO" => Ok("VIDEO"),
        _ => Err(format!("Type média non supporté : {}", raw)),
    }
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
        "media_nexuslink".to_string()
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
        .unwrap_or("media");
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
