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
pub struct SmsConversationDto {
    pub thread_id: i64,
    pub address: String,
    pub contact_name: String,
    pub snippet: String,
    pub date_ms: i64,
    pub unread_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmsMessageDto {
    pub id: i64,
    pub thread_id: i64,
    pub address: String,
    pub body: String,
    pub date_ms: i64,
    pub is_outgoing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmsContactDto {
    pub name: String,
    pub phone_number: String,
}

fn get_android_target(state: &Arc<Mutex<NetworkState>>) -> Result<(String, String), String> {
    let guard = state.lock().unwrap();
    let Some((ip, _udp_port, secret)) = guard.get_active_udp_target() else {
        return Err("Aucun téléphone Android connecté.".to_string());
    };
    Ok((ip, secret))
}

async fn send_android_sms_request(
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
        .map_err(|_| "Délai dépassé lors de l'envoi de la requête SMS".to_string())?
        .map_err(|e| format!("Erreur d'envoi vers Android : {}", e))?;

    if let Some(body) = json_body {
        timeout(CONNECT_TIMEOUT, stream.write_all(body))
            .await
            .map_err(|_| "Délai dépassé lors de l'envoi JSON SMS".to_string())?
            .map_err(|e| format!("Erreur d'envoi JSON vers Android : {}", e))?;
    }

    let mut reader = BufReader::with_capacity(32 * 1024, stream);
    let mut status_line = String::new();
    timeout(READ_TIMEOUT, reader.read_line(&mut status_line))
        .await
        .map_err(|_| "Délai dépassé en attente de la réponse SMS".to_string())?
        .map_err(|e| format!("Erreur de lecture réponse SMS : {}", e))?;

    let status_code = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| format!("Statut HTTP invalide : {}", status_line.trim()))?;

    loop {
        let mut line = String::new();
        timeout(READ_TIMEOUT, reader.read_line(&mut line))
            .await
            .map_err(|_| "Délai dépassé lecture en-têtes SMS".to_string())?
            .map_err(|e| format!("Erreur lecture en-têtes SMS : {}", e))?;
        if line.trim_end_matches(['\r', '\n']).is_empty() {
            break;
        }
    }

    let mut body = Vec::new();
    timeout(READ_TIMEOUT, reader.read_to_end(&mut body))
        .await
        .map_err(|_| "Délai dépassé lecture corps SMS".to_string())?
        .map_err(|e| format!("Erreur lecture corps SMS : {}", e))?;

    Ok((status_code, body))
}

fn map_error(status: u16, body: &[u8]) -> String {
    let text = String::from_utf8_lossy(body).trim().to_string();
    if !text.is_empty() {
        text
    } else {
        format!("Erreur serveur SMS Android (HTTP {})", status)
    }
}

pub async fn sms_list_conversations(
    state: &Arc<Mutex<NetworkState>>,
    limit: Option<usize>,
) -> Result<Vec<SmsConversationDto>, String> {
    let (ip, secret) = get_android_target(state)?;
    let safe_limit = limit.unwrap_or(60).clamp(1, 120);
    let path = format!("/sms/conversations?limit={}", safe_limit);
    let (status, body) = send_android_sms_request("GET", &ip, &secret, &path, None).await?;
    if status != 200 {
        return Err(map_error(status, &body));
    }
    serde_json::from_slice(&body)
        .map_err(|e| format!("Impossible de décoder les conversations SMS : {}", e))
}

pub async fn sms_list_messages(
    state: &Arc<Mutex<NetworkState>>,
    thread_id: i64,
    limit: Option<usize>,
) -> Result<Vec<SmsMessageDto>, String> {
    let (ip, secret) = get_android_target(state)?;
    let safe_limit = limit.unwrap_or(80).clamp(1, 200);
    let path = format!("/sms/messages?threadId={}&limit={}", thread_id, safe_limit);
    let (status, body) = send_android_sms_request("GET", &ip, &secret, &path, None).await?;
    if status != 200 {
        return Err(map_error(status, &body));
    }
    serde_json::from_slice(&body)
        .map_err(|e| format!("Impossible de décoder les messages SMS : {}", e))
}

pub async fn sms_search_contacts(
    state: &Arc<Mutex<NetworkState>>,
    query: String,
) -> Result<Vec<SmsContactDto>, String> {
    let (ip, secret) = get_android_target(state)?;
    let path = format!("/sms/contacts?q={}", encode_query_component(&query));
    let (status, body) = send_android_sms_request("GET", &ip, &secret, &path, None).await?;
    if status != 200 {
        return Err(map_error(status, &body));
    }
    serde_json::from_slice(&body).map_err(|e| format!("Impossible de décoder les contacts : {}", e))
}

pub async fn sms_send(
    state: &Arc<Mutex<NetworkState>>,
    address: String,
    body_text: String,
) -> Result<(), String> {
    let (ip, secret) = get_android_target(state)?;
    let payload = serde_json::json!({
        "address": address,
        "body": body_text,
    });
    let payload_bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let (status, body) =
        send_android_sms_request("POST", &ip, &secret, "/sms/send", Some(&payload_bytes)).await?;
    if status != 200 {
        return Err(map_error(status, &body));
    }
    Ok(())
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
