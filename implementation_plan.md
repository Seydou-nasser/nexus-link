# Plan d'implémentation détaillé — NexusLink

Alternative ultra-légère, rapide et 100 % locale (sans dépendance au Cloud) à *Mobile connecté* de Windows, reliant un PC (**Tauri v2 + Rust + React/TypeScript**) et un smartphone **Android Natif (Kotlin + Jetpack Compose)**.

> [!IMPORTANT]
> **Règle d'exécution stricte** : Nous suivons ce plan **sous-étape par sous-étape dans l'ordre exact**. Aucune sous-étape suivante n'est entamée sans validation explicite. Chaque sous-étape indique les fichiers exacts à créer ou modifier et son critère de validation.

---

## Architecture globale du système

```mermaid
flowchart LR
    subgraph PC["Application PC (Tauri v2 - Rust + React/TS)"]
        Tray["System Tray & UI Desktop"]
        RustCore["Moteur Rust (Tokio)"]
        InputHook["Hook Souris / Clavier (Bord d'écran)"]
        NotifWin["Notifications Système Windows"]
        VideoPlayer["Décodeur Flux Écran"]
    end

    subgraph Network["Réseau Local (LAN / Wi-Fi) - Chiffré"]
        mDNS["mDNS (_nexuslink._tcp :52840)"]
        WS["Canal WebSocket (:52840 - Événements, Presse-papiers, Notifications, Batterie)"]
        UDP["Canal UDP 60-120 Hz (:52841 - Trames binaires 16 octets Souris & Clavier)"]
        HTTP["Serveur HTTP/TCP Direct (:52842 - Transfert Fichiers & Flux Vidéo)"]
    end

    subgraph Android["Application Android Native (Kotlin + Jetpack Compose)"]
        ComposeUI["Interface Jetpack Compose & Scan QR"]
        FgService["ConnectionForegroundService (Maintien connexion)"]
        NotifService["NexusNotificationListenerService (Notifications & Réponses)"]
        AccessService["CursorAccessibilityService + Overlay Curseur"]
        MediaProj["ScreenMirrorService (MediaProjection + MediaCodec)"]
    end

    Tray <--> RustCore
    InputHook --> RustCore
    RustCore --> NotifWin
    RustCore --> VideoPlayer

    RustCore <--> mDNS
    RustCore <--> WS
    RustCore --> UDP
    RustCore <--> HTTP

    mDNS <--> FgService
    WS <--> FgService
    UDP --> AccessService
    HTTP <--> FgService
    HTTP <-- MediaProj

    ComposeUI <--> FgService
    NotifService <--> FgService
    FgService <--> AccessService
```

---

## Étape 1 — Initialisation de l'espace de travail et spécification du protocole [TERMINÉ]

- [x] **1.1. Création de l'arborescence racine (`C:\projets\nexus-link`)** :
  - Fichiers : `.gitignore`, `README.md`, `desktop/`, `android/`, `docs/`.
- [x] **1.2. Spécification du protocole réseau (`docs/protocol-spec.md`)** :
  - Définition formelle de mDNS, du payload JSON du QR Code, de l'enveloppe WebSocket, de la trame binaire UDP de 16 octets et des endpoints HTTP.

---

## Étape 2 — Jalon 1 : Socle Desktop, Socle Android et Appairage local

### 2.1. Socle Desktop PC (`desktop/`) [TERMINÉ]
- [x] **2.1.1. Initialisation Tauri v2, Vite, TypeScript et Tailwind CSS** :
  - Fichiers : `desktop/package.json`, `desktop/vite.config.ts`, `desktop/src-tauri/Cargo.toml`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/capabilities/default.json`.
- [x] **2.1.2. Moteur réseau Rust initial (mDNS, Serveur WebSocket, Génération QR Code) & System Tray** :
  - Fichiers : `desktop/src-tauri/src/protocol.rs`, `desktop/src-tauri/src/network.rs`, `desktop/src-tauri/src/tray.rs`, `desktop/src-tauri/src/lib.rs`, `desktop/src-tauri/src/main.rs`.
- [x] **2.1.3. Interface fonctionnelle initiale de test d'appairage** :
  - Fichiers : `desktop/src/types/protocol.ts`, `desktop/src/App.tsx`, `desktop/src/App.css`, `desktop/src/components/TitleBar.tsx`, `desktop/src/components/Sidebar.tsx`, `desktop/src/components/StatusBar.tsx`.
  - *(Note : la refonte esthétique finale de l'interface Desktop est planifiée à l'Étape 7.2 une fois toutes les briques techniques en place).*

### 2.2. Socle Android Natif (`android/`) [TERMINÉ]
- [x] **2.2.1. Initialisation du projet Gradle Kotlin DSL & Jetpack Compose** :
  - Création de la configuration Gradle multi-fichiers propre dans `C:\projets\nexus-link\android` :
    - `android/settings.gradle.kts`, `android/build.gradle.kts`, `android/gradle.properties`,
    - `android/app/build.gradle.kts` (SDK min 29 / cible 35, Jetpack Compose, OkHttp pour WebSocket, Kotlinx Serialization, CameraX & ML Kit Barcode Scanning pour le QR Code),
    - `android/app/src/main/AndroidManifest.xml` (permissions `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `CHANGE_WIFI_MULTICAST_STATE`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_ConnectedDevice`, `POST_NOTIFICATIONS`, `CAMERA`).
  - **Critère de validation** : Structure Android complète et prête pour les classes Kotlin.
- [x] **2.2.2. Modèles du protocole et stockage sécurisé d'appairage (`protocol/` & `data/`)** :
  - `android/app/src/main/java/com/nexuslink/android/protocol/ProtocolModels.kt` : Classes de données sérialisables (`PairingQrPayload`, `WsEnvelope`, `PairingRequestPayload`, `PairingResponsePayload`, `DeviceStatusPayload`) strictement identiques à `docs/protocol-spec.md` et `protocol.rs`.
  - `android/app/src/main/java/com/nexuslink/android/data/PairingStore.kt` : Sauvegarde locale du PC appairé (IP, ports, `deviceId`, `sessionSecret`) dans les `SharedPreferences`.
  - **Critère de validation** : Compatibilité 100 % JSON avec le serveur Rust.
- [x] **2.2.3. Service persistant en arrière-plan, découverte mDNS et client WebSocket (`service/` & `network/`)** :
  - `android/app/src/main/java/com/nexuslink/android/network/NsdDiscoveryManager.kt` : Découverte automatique du service `_nexuslink._tcp.` sur le réseau Wi-Fi via `NsdManager`.
  - `android/app/src/main/java/com/nexuslink/android/network/NexusWebSocketClient.kt` : Client WebSocket (`OkHttpClient`) gérant la connexion à `ws://<IP_PC>:52840`, l'envoi automatique de `PAIRING_REQUEST`, la réception de `PAIRING_RESPONSE` et la reconnexion automatique.
  - `android/app/src/main/java/com/nexuslink/android/service/ConnectionForegroundService.kt` : `ForegroundService` maintenant le client WebSocket actif en arrière-plan avec une notification système discrète.
  - **Critère de validation** : Le service Android maintient la connexion WebSocket et s'authentifie auprès du PC.
- [x] **2.2.4. Interface Jetpack Compose d'appairage et lecteur de QR Code (`ui/`)** :
  - `android/app/src/main/java/com/nexuslink/android/ui/QrScannerView.kt` : Composant CameraX + ML Kit décodant le JSON du QR Code affiché par le PC.
  - `android/app/src/main/java/com/nexuslink/android/ui/MainScreen.kt` & `MainActivity.kt` : Écran principal permettant soit de scanner le QR Code, soit de cliquer sur un PC découvert via mDNS, soit de coller le JSON d'appairage (pratique sur émulateur sans caméra), et affichant l'état de la liaison en direct.
  - **Critère de validation de fin du Jalon 1** : L'application Android se connecte réellement au serveur Rust du PC et l'interface PC affiche les vraies informations du téléphone.

### 2.3. Appairage en un clic (sans QR), code à 6 chiffres & mémorisation [TERMINÉ]
- [x] **2.3.1. Protocole & Côté PC (`docs/`, `desktop/`)** :
  - Mise à jour de `PAIRING_REQUEST` dans `docs/protocol-spec.md`, `protocol.rs` et `ProtocolModels.kt` (modes `QR`, `MANUAL` avec code à 6 chiffres, et `RECONNECT` avec `sessionSecret`).
  - Mémorisation locale des appareils appairés sur le PC (`paired_devices.json`) pour reconnexion automatique après redémarrage.
  - Notification Windows + mise au premier plan + boîte de dialogue dans NexusLink avec le code à 6 chiffres et les boutons **Accepter / Refuser**.
- [x] **2.3.2. Côté Android (`android/`)** :
  - Suppression de l'adresse IP dans la notification persistante (`ConnectionForegroundService.kt`).
  - Liste **« Ordinateurs à proximité »** cliquable avec affichage du code à 6 chiffres pendant l'attente de confirmation sur le PC.

---

## Étape 3 — Jalon 2 : Batterie, « Trouver mon téléphone », Presse-papiers et Transfert de fichiers

### 3.1. État du téléphone en temps réel & fonction « Trouver mon téléphone »
- [x] **3.1.1. Côté Android (`service/DeviceStatusMonitor.kt` & `service/RingPhoneController.kt`)** :
  - Écoute de `ACTION_BATTERY_CHANGED` (`BatteryManager`) et de `RINGER_MODE_CHANGED_ACTION` (`AudioManager`), et envoi automatique du message `DEVICE_STATUS_UPDATE` au PC via WebSocket.
  - Exécution de la commande `FIND_MY_PHONE_COMMAND` reçue du PC : sauvegarde du volume actuel, passage temporaire du flux d'alarme au maximum et déclenchement de la sonnerie par défaut avec boîte de dialogue/notification pour l'arrêter.
- [x] **3.1.2. Côté PC (`desktop/src-tauri/src/network.rs` & `lib.rs`)** :
  - Ajout de la commande Tauri `trigger_find_my_phone` qui envoie `FIND_MY_PHONE_COMMAND` (`START_RINGING` / `STOP_RINGING`) au téléphone connecté sur le WebSocket actif.
  - Branchement du bouton « Faire sonner » dans l'interface PC.

### 3.2. Presse-papiers bidirectionnel (PC ↔ Android)
- [x] **3.2.1. Côté PC (`desktop/src-tauri/src/clipboard.rs`)** :
  - Surveillance des modifications du presse-papiers texte sous Windows et commande Tauri `send_clipboard_to_phone`.
  - Réception du message WebSocket `CLIPBOARD_SYNC` venant d'Android et copie automatique dans le presse-papiers Windows (avec garde anti-boucle infinie par hash du contenu).
- [x] **3.2.2. Côté Android (`service/ClipboardSyncManager.kt` & `service/NexusAccessibilityService.kt`)** :
  - Réception de `CLIPBOARD_SYNC` venant du PC et écriture immédiate dans le `ClipboardManager` d'Android.
  - Action rapide dans la notification persistante (« Envoyer le presse-papiers au PC ») et activité transparente de partage texte pour envoyer le presse-papiers du téléphone vers le PC malgré les restrictions d'arrière-plan d'Android 10+.

### 3.3. Transfert rapide de fichiers, photos et images du presse-papiers (HTTP `:52842`)
- [x] **3.3.1. Côté PC (`desktop/src-tauri/src/file_server.rs` & `clipboard.rs`)** :
  - Serveur HTTP asynchrone (`axum`) sur le port `52842` vérifiant l'en-tête `Authorization: Bearer <sessionSecret>`.
  - Endpoint `POST /api/v1/files/upload` : réception automatique en flux des fichiers dans `Téléchargements/NexusLink`, et prise en charge des images du presse-papiers (JPEG $\le$ 5 Mo) injectées dans le presse-papiers Windows.
  - Endpoint `GET /api/v1/files/download/:fileId` + offre WebSocket `FILE_TRANSFER_OFFER` pour envoyer des fichiers (glisser-déposer ou sélecteur natif) et des captures d'écran JPEG ($\le$ 5 Mo) vers Android.
- [x] **3.3.2. Côté Android (`network/FileTransferManager.kt` & `ShareReceiverActivity.kt`)** :
  - Téléchargement automatique dans `Downloads/NexusLink` pour les fichiers, et écriture dans `ClipboardManager` (via `FileProvider`) pour les images du presse-papiers.
  - Bouton « Envoyer des fichiers » dans l'app + intégration au menu système **« Partager vers NexusLink »** (`ACTION_SEND` / `ACTION_SEND_MULTIPLE`) + prise en charge des images copiées via `NexusAccessibilityService`.

---

## Étape 4 — Jalon 3 : Synchronisation des notifications Android vers le PC

### 4.1. Interception et actions sur Android
- [ ] **4.1.1. Service d'écoute (`service/NexusNotificationListenerService.kt`)** :
  - Hérite de `NotificationListenerService` (déclaré dans `AndroidManifest.xml` avec `BIND_NOTIFICATION_LISTENER_SERVICE`).
  - Dans `onNotificationPosted` : extrait le nom de l'application, le titre, le texte, l'icône compressée en Base64, et vérifie si une action contient un `RemoteInput` (réponse directe SMS, WhatsApp, Telegram, etc.). Envoie `NOTIFICATION_POSTED` au PC.
  - Dans `onNotificationRemoved` : envoie `NOTIFICATION_REMOVED` au PC.
- [ ] **4.1.2. Exécution des réponses et suppressions à distance** :
  - Conserve une table en mémoire des `PendingIntent` et `RemoteInput` indexée par `notificationKey`.
  - À la réception de `NOTIFICATION_REPLY` depuis le PC : injecte le texte de réponse dans le `RemoteInput` et déclenche le `PendingIntent` sur le téléphone.
  - À la réception de `NOTIFICATION_DISMISS` depuis le PC : appelle `cancelNotification(notificationKey)`.

### 4.2. Réception et centre de notifications sur le PC
- [ ] **4.2.1. Gestionnaire de notifications Rust (`desktop/src-tauri/src/notifications.rs`)** :
  - Stockage de la liste des notifications actives dans `NetworkState`, émission vers l'interface React et affichage d'une notification système Windows native.
  - Commandes Tauri `reply_to_notification` et `dismiss_notification` envoyant les ordres au téléphone via WebSocket.
- [ ] **4.2.2. Panneau de notifications interactif dans l'interface PC** :
  - Affichage de la liste des notifications reçues avec icône, application, horodatage, bouton de fermeture et champ de saisie pour répondre directement depuis le PC.

---

## Étape 5 — Jalon 4 : Passage fluide de la souris et du clavier du PC vers le téléphone (UDP 120 Hz)

### 5.1. Capture Souris/Clavier au bord de l'écran et émetteur UDP côté PC (Rust)
- [ ] **5.1.1. Encodeur et émetteur UDP binaire (`desktop/src-tauri/src/udp_input.rs`)** :
  - Implémentation de la sérialisation binaire de **16 octets** Big-Endian définie dans `docs/protocol-spec.md` (`MouseMove`, `MouseButton`, `MouseWheel`, `KeyEvent` + numéro de séquence + tag d'authentification rapide).
  - Socket UDP non-bloquant envoyant les trames à `<IP_ANDROID>:52841`.
- [ ] **5.1.2. Hook bas niveau Windows et détection du bord d'écran (`desktop/src-tauri/src/input_hook.rs`)** :
  - Surveillance de la position du curseur sous Windows et détection du bord configuré (`LEFT`, `RIGHT`, `BOTTOM`).
  - Application de la sécurité anti-franchissement accidentel (résistance temporelle en ms ou maintien de la touche `Ctrl`).
  - Lors du basculement vers Android : envoi de `INPUT_FOCUS_STATE (activeTarget = ANDROID)`, verrouillage/masquage du curseur local Windows, capture des deltas $\Delta x, \Delta y$, des boutons, de la molette et du clavier, et transmission immédiate en UDP.
  - Retour automatique sur le PC lorsque le curseur retraverse le bord opposé ou à l'appui sur `Échap`.

### 5.2. Récepteur UDP, curseur virtuel en surimpression et injection sur Android
- [ ] **5.2.1. Serveur UDP basse latence (`android/.../network/UdpInputReceiver.kt`)** :
  - Écoute sur le port UDP `52841`, vérifie l'en-tête magique `0x4E` et le numéro de séquence, et transmet les événements décodés au service d'accessibilité.
- [ ] **5.2.2. Service d'accessibilité et Overlay curseur (`android/.../service/CursorAccessibilityService.kt`)** :
  - Déclaration du `AccessibilityService` dans `AndroidManifest.xml` avec fichier de configuration XML (`canPerformGestures="true"`, `canRetrieveWindowContent="true"`).
  - Affichage d'un curseur de souris vectoriel fluide par-dessus l'écran via `WindowManager` (`TYPE_ACCESSIBILITY_OVERLAY`).
  - Exécution des clics simples, clics maintenus, défilements (molette) et glisser-déposer via `dispatchGesture(GestureDescription)`.
  - Clic droit mappé sur `GLOBAL_ACTION_BACK` (Retour) et clic milieu sur `GLOBAL_ACTION_HOME` (Accueil).
  - Injection des frappes clavier du PC dans le champ de texte Android focalisé (`ACTION_SET_TEXT`).

---

## Étape 6 — Jalon 5 : Recopie d'écran du téléphone sur le PC (Screen Mirroring)

- [ ] **6.1. Capture et diffusion sur Android (`android/.../service/ScreenMirrorService.kt`)** :
  - Demande de permission `MediaProjectionManager` et capture de l'écran dans un flux vidéo basse latence diffusé sur le canal HTTP/TCP (`:52842`).
- [ ] **6.2. Lecteur de flux et contrôle direct dans l'application PC** :
  - Affichage du flux vidéo de l'écran du téléphone dans l'onglet « Recopie d'écran » de Tauri et traduction directe des clics/mouvements de souris sur la vidéo en paquets UDP envoyés au téléphone.

---

## Étape 7 — Architecture transport modulaire & Finition Direction Artistique Desktop

- [ ] **7.1. Abstraction du transport réseau (`TransportTrait` Rust / `TransportChannel` Kotlin)** :
  - Découplage de la couche de transport pour permettre l'ajout futur d'un mode distant hors réseau local (WebRTC P2P / Tailscale / Relais).
- [ ] **7.2. Refonte et finition sur-mesure de l'interface Desktop PC** :
  - Reprise dédiée du design de l'application PC une fois l'ensemble des fonctionnalités des Jalons 1 à 5 opérationnelles.
