# Spécification du Protocole Réseau — NexusLink (v1.0)

Ce document définit le protocole de communication local entre le serveur PC (**Rust / Tauri v2**) et le client mobile (**Android / Kotlin**).

---

## 1. Découverte Réseau (mDNS / Zeroconf)

- **Type de service** : `_nexuslink._tcp.local.`
- **Port annoncé** : Port du serveur WebSocket/HTTP (par défaut `52840`).
- **Attributs TXT mDNS** :
  - `version=1`
  - `device_id=<UUID_PC>`
  - `device_name=<NOM_DU_PC>`
  - `udp_port=52841`

---

## 2. Appairage par QR Code (Pairing Payload)

Le QR Code affiché par le PC contient une chaîne JSON encodée (ou URI `nexuslink://pair?...`) :

```json
{
  "version": 1,
  "deviceId": "e4b8c9d0-1234-4ef5-89ab-cdef01234567",
  "deviceName": "PC-BUREAU",
  "addresses": ["192.168.1.42"],
  "wsPort": 52840,
  "udpPort": 52841,
  "httpPort": 52842,
  "pairingToken": "8f9d2a7b4c6e1f0a3b5d7e9f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b"
}
```

---

## 3. Canal de Contrôle et d'Événements (WebSocket JSON)

- **Endpoint** : `ws://<IP_PC>:52840/ws`
- **En-tête d'authentification** : `Authorization: Bearer <sharedSecret>` (ou message initial `PairingRequest` lors du premier appairage).

### 3.1. Enveloppe standard des messages WebSocket

Tous les messages JSON échangés sur le canal WebSocket respectent la structure suivante :

```json
{
  "id": "msg-uuid-v4",
  "timestamp": 1763251200000,
  "type": "NOM_DU_MESSAGE",
  "payload": {}
}
```

### 3.2. Types de messages (`type` & `payload`)

#### A. Appairage et Authentification
- **`PAIRING_REQUEST`** (Android $\rightarrow$ PC) :
  ```json
  {
    "mode": "QR",
    "pairingToken": "8f9d2a...",
    "sessionSecret": null,
    "verificationCode": null,
    "deviceId": "android-uuid",
    "deviceName": "Pixel 8 Pro",
    "model": "Pixel 8 Pro",
    "androidVersion": "14"
  }
  ```
  *(Modes possibles : `"QR"` avec `pairingToken`, `"MANUAL"` avec `verificationCode` à 6 chiffres, ou `"RECONNECT"` avec `sessionSecret` déjà mémorisé).*
- **`PAIRING_RESPONSE`** (PC $\rightarrow$ Android) :
  ```json
  {
    "accepted": true,
    "sessionSecret": "shared-long-term-hmac-key-hex",
    "pcName": "PC-BUREAU"
  }
  ```

#### B. État du téléphone et Batterie
- **`DEVICE_STATUS_UPDATE`** (Android $\rightarrow$ PC) :
  ```json
  {
    "batteryLevel": 84,
    "isCharging": true,
    "ringerMode": "NORMAL",
    "screenAwake": true,
    "screenWidth": 1080,
    "screenHeight": 2400
  }
  ```
- **`FIND_MY_PHONE_COMMAND`** (PC $\rightarrow$ Android) :
  ```json
  {
    "action": "START_RINGING"
  }
  ```

#### C. Presse-papiers bidirectionnel
- **`CLIPBOARD_SYNC`** (PC $\leftrightarrow$ Android) :
  ```json
  {
    "mimeType": "text/plain",
    "content": "Texte copié dans le presse-papiers"
  }
  ```

#### D. Notifications Android
- **`NOTIFICATION_POSTED`** (Android $\rightarrow$ PC) :
  ```json
  {
    "notificationKey": "0|com.whatsapp|1001|null|10123",
    "packageName": "com.whatsapp",
    "appName": "WhatsApp",
    "title": "Alice",
    "text": "Tu es dispo ce soir ?",
    "canReply": true,
    "actions": ["Répondre", "Marquer comme lu"],
    "iconBase64": "iVBORw0KGgoAAAANSUhEUgAA..."
  }
  ```
- **`NOTIFICATION_REMOVED`** (Android $\leftrightarrow$ PC) :
  ```json
  {
    "notificationKey": "0|com.whatsapp|1001|null|10123"
  }
  ```
- **`NOTIFICATION_REPLY`** (PC $\rightarrow$ Android) :
  ```json
  {
    "notificationKey": "0|com.whatsapp|1001|null|10123",
    "replyText": "Oui, à 20h !"
  }
  ```

#### E. Contrôle de la bascule Souris / Clavier (Bord d'écran)
- **`INPUT_FOCUS_STATE`** (PC $\leftrightarrow$ Android) :
  ```json
  {
    "activeTarget": "ANDROID",
    "entryEdge": "RIGHT",
    "normalizedPosition": 0.5
  }
  ```

---

## 4. Canal Temps Réel Souris & Clavier (UDP Binaire 60–120 Hz)

- **Port par défaut** : `52841` (UDP)
- **Taille fixe d'une trame** : **16 octets** (Big-Endian) pour éliminer toute surcharge de sérialisation.

| Offset (Octets) | Type | Champ | Description |
| :--- | :--- | :--- | :--- |
| `0` | `u8` | `magic` | Constante `0x4E` (`'N'`) |
| `1` | `u8` | `event_type` | `0x01`: MouseMove, `0x02`: MouseButton, `0x03`: MouseWheel, `0x04`: KeyEvent |
| `2..5` | `u32` | `sequence` | Numéro de séquence monotone (anti-rejeu / détection de perte) |
| `6..7` | `i16` | `dx_or_code` | Déplacement $\Delta x$ (souris) ou `keyCode` (clavier) |
| `8..9` | `i16` | `dy_or_mods` | Déplacement $\Delta y$ (souris), delta molette, ou modificateurs (`Ctrl`, `Shift`, `Alt`) |
| `10` | `u8` | `button_state`| Masque des boutons (`Bit 0`: Gauche, `Bit 1`: Droit, `Bit 2`: Milieu, `1`=Pressé, `0`=Relâché) |
| `11` | `u8` | `flags` | Options (ex. `0x01` = coordonnées absolues normalisées, `0x00` = delta relatif) |
| `12..15` | `u32` | `auth_tag` | Tag d'intégrité rapide (CRC32 / SipHash-2-4 tronqué avec `sessionSecret`) |

---

## 5. Canal Haut Débit : Transfert de Fichiers & Recopie d'Écran (HTTP / TCP)

- **Port par défaut** : `52842`
- **Authentification** : En-tête HTTP `Authorization: Bearer <sessionSecret>`

### 5.1. Endpoints HTTP
- `POST /api/v1/files/upload` : Envoi d'un fichier en flux binaire (`multipart/form-data` ou `application/octet-stream` avec en-têtes `X-File-Name`, `X-File-Size`, `X-File-Id`).
- `GET /api/v1/files/download/:fileId` : Téléchargement d'un fichier préparé par l'autre appareil.
- `GET /api/v1/screen/stream` : Flux vidéo basse latence de recopie d'écran (trames H.264 / MJPEG streamées depuis `MediaProjection` sur Android vers la fenêtre Tauri).
