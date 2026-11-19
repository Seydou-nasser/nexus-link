use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::time::timeout;

use crate::media_gallery::ANDROID_MEDIA_HTTP_PORT;
use crate::network::NetworkState;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const READ_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallLogEntryDto {
    pub id: i64,
    pub number: String,
    pub contact_name: String,
    pub call_type: String,
    pub date_ms: i64,
    pub duration_sec: i64,
}

fn get_android_target(state: &Arc<Mutex<NetworkState>>) -> Result<(String, String), String> {
    let guard = state.lock().unwrap();
    let Some((ip, _udp_port, secret)) = guard.get_active_udp_target() else {
        return Err("Aucun téléphone Android connecté.".to_string());
    };
    Ok((ip, secret))
}

async fn send_android_calls_request(
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
        .map_err(|_| "Délai dépassé lors de l'envoi de la requête appels".to_string())?
        .map_err(|e| format!("Erreur d'envoi vers Android : {}", e))?;

    if let Some(body) = json_body {
        timeout(CONNECT_TIMEOUT, stream.write_all(body))
            .await
            .map_err(|_| "Délai dépassé lors de l'envoi JSON appels".to_string())?
            .map_err(|e| format!("Erreur d'envoi JSON vers Android : {}", e))?;
    }

    let mut reader = BufReader::with_capacity(32 * 1024, stream);
    let mut status_line = String::new();
    timeout(READ_TIMEOUT, reader.read_line(&mut status_line))
        .await
        .map_err(|_| "Délai dépassé en attente de la réponse appels".to_string())?
        .map_err(|e| format!("Erreur lecture réponse appels : {}", e))?;

    let status_code = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| format!("Statut HTTP invalide : {}", status_line.trim()))?;

    loop {
        let mut line = String::new();
        timeout(READ_TIMEOUT, reader.read_line(&mut line))
            .await
            .map_err(|_| "Délai dépassé lecture en-têtes appels".to_string())?
            .map_err(|e| format!("Erreur lecture en-têtes appels : {}", e))?;
        if line.trim_end_matches(['\r', '\n']).is_empty() {
            break;
        }
    }

    let mut body = Vec::new();
    timeout(READ_TIMEOUT, reader.read_to_end(&mut body))
        .await
        .map_err(|_| "Délai dépassé lecture corps appels".to_string())?
        .map_err(|e| format!("Erreur lecture corps appels : {}", e))?;

    Ok((status_code, body))
}

fn map_error(status: u16, body: &[u8]) -> String {
    let text = String::from_utf8_lossy(body).trim().to_string();
    if !text.is_empty() {
        text
    } else {
        format!("Erreur serveur appels Android (HTTP {})", status)
    }
}

pub async fn calls_list_history(
    state: &Arc<Mutex<NetworkState>>,
    limit: Option<usize>,
) -> Result<Vec<CallLogEntryDto>, String> {
    let (ip, secret) = get_android_target(state)?;
    let safe_limit = limit.unwrap_or(100).clamp(1, 200);
    let path = format!("/calls/history?limit={}", safe_limit);
    let (status, body) = send_android_calls_request("GET", &ip, &secret, &path, None).await?;
    if status != 200 {
        return Err(map_error(status, &body));
    }
    serde_json::from_slice(&body)
        .map_err(|e| format!("Impossible de décoder le journal d'appels : {}", e))
}

pub async fn calls_dial_number(
    state: &Arc<Mutex<NetworkState>>,
    number: String,
) -> Result<(), String> {
    let (ip, secret) = get_android_target(state)?;
    let payload = serde_json::json!({ "number": number });
    let payload_bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let (status, body) =
        send_android_calls_request("POST", &ip, &secret, "/calls/dial", Some(&payload_bytes))
            .await?;
    if status != 200 {
        return Err(map_error(status, &body));
    }
    Ok(())
}
