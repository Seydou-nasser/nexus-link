use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BluetoothAudioDevice {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BluetoothAudioStatus {
    pub active: bool,
    pub active_device_id: Option<String>,
    pub active_device_name: Option<String>,
    pub devices: Vec<BluetoothAudioDevice>,
}

#[cfg(target_os = "windows")]
mod imp {
    use std::sync::{Mutex, OnceLock};

    use windows::Devices::Enumeration::DeviceInformation;
    use windows::Media::Audio::{
        AudioPlaybackConnection, AudioPlaybackConnectionOpenResultStatus,
        AudioPlaybackConnectionState,
    };
    use windows::core::HSTRING;

    use super::{BluetoothAudioDevice, BluetoothAudioStatus};

    struct ActiveConnection {
        device_id: String,
        device_name: String,
        connection: AudioPlaybackConnection,
    }

    fn active_slot() -> &'static Mutex<Option<ActiveConnection>> {
        static SLOT: OnceLock<Mutex<Option<ActiveConnection>>> = OnceLock::new();
        SLOT.get_or_init(|| Mutex::new(None))
    }

    fn enumerate_devices() -> Result<Vec<BluetoothAudioDevice>, String> {
        let selector = AudioPlaybackConnection::GetDeviceSelector()
            .map_err(|e| format!("AudioPlaybackConnection indisponible : {}", e))?;
        let async_op = DeviceInformation::FindAllAsyncAqsFilter(&selector)
            .map_err(|e| format!("Impossible d'énumérer les appareils Bluetooth : {}", e))?;
        let collection = async_op
            .get()
            .map_err(|e| format!("Erreur lecture liste Bluetooth : {}", e))?;

        let count = collection.Size().unwrap_or(0);
        let mut devices = Vec::with_capacity(count as usize);
        for i in 0..count {
            if let Ok(info) = collection.GetAt(i) {
                let id = info.Id().map(|s| s.to_string()).unwrap_or_default();
                let name = info.Name().map(|s| s.to_string()).unwrap_or_default();
                if !id.is_empty() {
                    devices.push(BluetoothAudioDevice {
                        id,
                        name: if name.is_empty() {
                            "Appareil Bluetooth".to_string()
                        } else {
                            name
                        },
                    });
                }
            }
        }
        Ok(devices)
    }

    pub fn get_status() -> Result<BluetoothAudioStatus, String> {
        let devices = enumerate_devices()?;
        let mut guard = active_slot().lock().unwrap();

        // Vérifie que la connexion active est toujours ouverte côté Windows
        if let Some(ref active) = *guard {
            let is_open = active
                .connection
                .State()
                .map(|s| s == AudioPlaybackConnectionState::Opened)
                .unwrap_or(false);
            if !is_open {
                *guard = None;
            }
        }

        let (active, active_device_id, active_device_name) = match *guard {
            Some(ref a) => (true, Some(a.device_id.clone()), Some(a.device_name.clone())),
            None => (false, None, None),
        };

        Ok(BluetoothAudioStatus {
            active,
            active_device_id,
            active_device_name,
            devices,
        })
    }

    pub fn connect(
        requested_device_id: Option<String>,
        preferred_name: Option<String>,
    ) -> Result<BluetoothAudioStatus, String> {
        let devices = enumerate_devices()?;
        if devices.is_empty() {
            return Err(
                "Aucun téléphone Bluetooth jumelé détecté. Jumelez d'abord votre téléphone dans Paramètres Windows → Bluetooth."
                    .to_string(),
            );
        }

        let target = if let Some(req_id) = requested_device_id.filter(|s| !s.trim().is_empty()) {
            devices
                .iter()
                .find(|d| d.id == req_id)
                .cloned()
                .ok_or_else(|| "Appareil Bluetooth introuvable.".to_string())?
        } else if let Some(pref) = preferred_name.filter(|s| !s.trim().is_empty()) {
            let pref_lower = pref.to_lowercase();
            devices
                .iter()
                .find(|d| {
                    let dn = d.name.to_lowercase();
                    dn.contains(&pref_lower) || pref_lower.contains(&dn)
                })
                .cloned()
                .unwrap_or_else(|| devices[0].clone())
        } else {
            devices[0].clone()
        };

        // Ferme toute connexion précédente avant d'en ouvrir une nouvelle
        {
            let mut guard = active_slot().lock().unwrap();
            if let Some(prev) = guard.take() {
                let _ = prev.connection.Close();
            }
        }

        let conn = AudioPlaybackConnection::TryCreateFromId(&HSTRING::from(&target.id))
            .map_err(|e| format!("Impossible d'initialiser l'audio Bluetooth : {}", e))?;

        conn.StartAsync()
            .map_err(|e| format!("Échec démarrage AudioPlaybackConnection : {}", e))?
            .get()
            .map_err(|e| format!("Impossible de démarrer la liaison audio : {}", e))?;

        let open_result = conn
            .Open()
            .map_err(|e| format!("Impossible d'ouvrir le flux audio Bluetooth : {}", e))?;
        let open_status = open_result
            .Status()
            .unwrap_or(AudioPlaybackConnectionOpenResultStatus::UnknownFailure);

        if open_status != AudioPlaybackConnectionOpenResultStatus::Success {
            let _ = conn.Close();
            return Err(match open_status {
                AudioPlaybackConnectionOpenResultStatus::RequestTimedOut => {
                    "Délai dépassé : vérifiez que le Bluetooth est activé sur votre téléphone."
                        .to_string()
                }
                AudioPlaybackConnectionOpenResultStatus::DeniedBySystem => {
                    "Connexion audio Bluetooth refusée par Windows.".to_string()
                }
                _ => "Impossible de connecter l'audio Bluetooth (téléphone hors de portée ou Bluetooth éteint)."
                    .to_string(),
            });
        }

        {
            let mut guard = active_slot().lock().unwrap();
            *guard = Some(ActiveConnection {
                device_id: target.id.clone(),
                device_name: target.name.clone(),
                connection: conn,
            });
        }

        Ok(BluetoothAudioStatus {
            active: true,
            active_device_id: Some(target.id),
            active_device_name: Some(target.name),
            devices,
        })
    }

    pub fn disconnect() -> Result<BluetoothAudioStatus, String> {
        {
            let mut guard = active_slot().lock().unwrap();
            if let Some(prev) = guard.take() {
                let _ = prev.connection.Close();
            }
        }
        get_status()
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    use super::BluetoothAudioStatus;

    pub fn get_status() -> Result<BluetoothAudioStatus, String> {
        Ok(BluetoothAudioStatus {
            active: false,
            active_device_id: None,
            active_device_name: None,
            devices: Vec::new(),
        })
    }

    pub fn connect(
        _requested_device_id: Option<String>,
        _preferred_name: Option<String>,
    ) -> Result<BluetoothAudioStatus, String> {
        Err(
            "Le récepteur audio Bluetooth est disponible uniquement sous Windows 10/11."
                .to_string(),
        )
    }

    pub fn disconnect() -> Result<BluetoothAudioStatus, String> {
        get_status()
    }
}

pub async fn bt_audio_status() -> Result<BluetoothAudioStatus, String> {
    tokio::task::spawn_blocking(imp::get_status)
        .await
        .map_err(|e| format!("Erreur tâche audio Bluetooth : {}", e))?
}

pub async fn bt_audio_connect(
    device_id: Option<String>,
    preferred_name: Option<String>,
) -> Result<BluetoothAudioStatus, String> {
    tokio::task::spawn_blocking(move || imp::connect(device_id, preferred_name))
        .await
        .map_err(|e| format!("Erreur tâche connexion audio Bluetooth : {}", e))?
}

pub async fn bt_audio_disconnect() -> Result<BluetoothAudioStatus, String> {
    tokio::task::spawn_blocking(imp::disconnect)
        .await
        .map_err(|e| format!("Erreur tâche déconnexion audio Bluetooth : {}", e))?
}
