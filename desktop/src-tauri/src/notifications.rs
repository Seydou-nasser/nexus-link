use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

use crate::network::{current_time_label, NetworkState};
use crate::protocol::{
    NotificationDismissPayload, NotificationPostedPayload, NotificationRemovedPayload,
    NotificationReplyPayload, PhoneNotificationRecord,
};

const MAX_NOTIFICATIONS: usize = 50;

/// Enregistre ou met à jour une notification reçue depuis Android,
/// notifie l'interface React et affiche une notification système Windows native.
pub fn handle_notification_posted(
    payload: NotificationPostedPayload,
    state: &Arc<Mutex<NetworkState>>,
    app_handle: &AppHandle,
) {
    let record = PhoneNotificationRecord {
        notification_key: payload.notification_key.clone(),
        package_name: payload.package_name,
        app_name: payload.app_name.clone(),
        title: payload.title.clone(),
        text: payload.text.clone(),
        can_reply: payload.can_reply,
        actions: payload.actions,
        icon_base64: payload.icon_base64,
        timestamp: current_time_label(),
    };

    let snapshot = {
        let mut guard = state.lock().unwrap();
        guard
            .notifications
            .retain(|item| item.notification_key != record.notification_key);
        guard.notifications.insert(0, record);
        if guard.notifications.len() > MAX_NOTIFICATIONS {
            guard.notifications.truncate(MAX_NOTIFICATIONS);
        }
        guard.notifications.clone()
    };

    let _ = app_handle.emit("nexus://notifications-updated", &snapshot);
}

/// Retire une notification supprimée côté Android et met à jour l'interface React.
pub fn handle_notification_removed(
    payload: NotificationRemovedPayload,
    state: &Arc<Mutex<NetworkState>>,
    app_handle: &AppHandle,
) {
    let snapshot = {
        let mut guard = state.lock().unwrap();
        let before = guard.notifications.len();
        guard
            .notifications
            .retain(|item| item.notification_key != payload.notification_key);
        if guard.notifications.len() == before {
            return;
        }
        guard.notifications.clone()
    };

    let _ = app_handle.emit("nexus://notifications-updated", &snapshot);
}

/// Vide la liste des notifications actives (ex. lors de la déconnexion du téléphone).
pub fn clear_notifications(state: &Arc<Mutex<NetworkState>>, app_handle: &AppHandle) {
    let changed = {
        let mut guard = state.lock().unwrap();
        if guard.notifications.is_empty() {
            false
        } else {
            guard.notifications.clear();
            true
        }
    };

    if changed {
        let empty: Vec<PhoneNotificationRecord> = Vec::new();
        let _ = app_handle.emit("nexus://notifications-updated", &empty);
    }
}

/// Envoie une réponse directe à une notification Android via WebSocket.
pub fn reply_to_notification(
    notification_key: String,
    reply_text: String,
    state: &Arc<Mutex<NetworkState>>,
) -> bool {
    let trimmed = reply_text.trim().to_string();
    if trimmed.is_empty() {
        return false;
    }

    let payload = NotificationReplyPayload {
        notification_key,
        reply_text: trimmed,
    };

    let guard = state.lock().unwrap();
    match serde_json::to_value(payload) {
        Ok(value) => guard.send_ws_message("NOTIFICATION_REPLY", value),
        Err(_) => false,
    }
}

/// Demande la suppression d'une notification sur Android et la retire immédiatement côté PC.
pub fn dismiss_notification(
    notification_key: String,
    state: &Arc<Mutex<NetworkState>>,
    app_handle: &AppHandle,
) -> bool {
    let payload = NotificationDismissPayload {
        notification_key: notification_key.clone(),
    };

    let (sent, snapshot) = {
        let mut guard = state.lock().unwrap();
        let sent = match serde_json::to_value(payload) {
            Ok(value) => guard.send_ws_message("NOTIFICATION_DISMISS", value),
            Err(_) => false,
        };
        guard
            .notifications
            .retain(|item| item.notification_key != notification_key);
        (sent, guard.notifications.clone())
    };

    let _ = app_handle.emit("nexus://notifications-updated", &snapshot);
    sent
}
