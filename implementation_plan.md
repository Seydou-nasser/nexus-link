# Plan d'implémentation — NexusLink

Alternative ultra-légère, rapide et 100 % locale (sans dépendance au Cloud) à *Mobile connecté* de Windows, permettant de relier un PC (Windows/Linux/macOS via **Tauri v2 + Rust**) et un smartphone **Android Natif (Kotlin + Jetpack Compose)**, avec partage de souris/clavier au bord de l'écran, synchronisation des notifications, presse-papiers, transfert de fichiers et recopie d'écran.

> [!IMPORTANT]
> Ce plan est découpé en **5 jalons progressifs et numérotés**. Chaque jalon produit une version fonctionnelle et testable avant de passer au suivant.

---

## Architecture globale du système

```mermaid
flowchart LR
    subgraph PC["Application PC (Tauri v2 - Rust + React/TS)"]
        Tray["System Tray & Quick Panel UI"]
        RustCore["Moteur Rust (Tokio)"]
        InputHook["Hook Souris / Clavier (Bord d'écran)"]
        NotifWin["Notifications Système Windows"]
        VideoPlayer["Décodeur Flux Écran"]
    end

    subgraph Network["Réseau Local (LAN / Wi-Fi) - Chiffré"]
        mDNS["mDNS (Découverte automatique)"]
        WS["Canal WebSocket (Événements, Presse-papiers, Notifications, Batterie)"]
        UDP["Canal UDP 60-120 Hz (Mouvements Souris & Clavier sans latence)"]
        HTTP["Serveur HTTP/TCP Direct (Transfert Fichiers & Flux Vidéo)"]
    end

    subgraph Android["Application Android Native (Kotlin + Jetpack Compose)"]
        ComposeUI["Interface Jetpack Compose & Scan QR"]
        FgService["ForegroundService (Maintien connexion)"]
        NotifService["NotificationListenerService (Notifications & Réponses)"]
        AccessService["AccessibilityService + Overlay Curseur (Souris & Clavier)"]
        MediaProj["MediaProjection + MediaCodec (Capture d'écran H.264)"]
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

## Étape 1 — Initialisation de l'espace de travail et spécification du protocole

1. **Création du répertoire racine du projet** :
   - Création du dossier `C:\projets\nexus-link`.
   - Initialisation de la structure en trois sous-dossiers :
     - `desktop/` : Application PC Tauri v2 (Backend Rust + Frontend React / TypeScript / Tailwind CSS).
     - `android/` : Projet Android Studio / Gradle en Kotlin + Jetpack Compose (SDK minimum Android 10 / API 29).
     - `docs/` : Spécification technique du protocole réseau partagé (`protocol-spec.md`).
2. **Définition du protocole de communication (`docs/protocol-spec.md`)** :
   - Formalisation de l'enveloppe des messages JSON/binaires sur WebSocket (`PairingRequest`, `PairingResponse`, `BatteryStatus`, `ClipboardUpdate`, `PingRingPhone`, `NotificationEvent`, `NotificationAction`, `FileTransferOffer`).
   - Formalisation de la trame binaire compacte sur UDP (8 à 16 octets par paquet : type d'événement souris/clavier, coordonnées delta $\Delta x, \Delta y$ ou absolues, boutons, molette, code touche et numéro de séquence).
   - Définition du format du QR Code d'appairage (contenant l'adresse IP locale du PC, les ports WebSocket/UDP/HTTP, l'identifiant du PC et le jeton secret d'authentification généré aléatoirement).

---

## Étape 2 — Jalon 1 : Socle Desktop (Tauri/Rust), Socle Android (Kotlin) et Appairage local

### 2.1. Côté PC (`desktop/`)
1. **Configuration de Tauri v2 et du System Tray** :
   - Configuration de l'application pour tourner en arrière-plan dans la barre système Windows (*System Tray*) avec menu contextuel (Ouvrir le panneau rapide, Ouvrir la fenêtre principale, Quitter).
   - Fermeture de la fenêtre principale réduite dans la barre système sans couper le moteur Rust.
2. **Moteur réseau Rust (`src-tauri/src/network/`)** :
   - Publication du service sur le réseau local via **mDNS** (`_nexuslink._tcp.local.`).
   - Démarrage du serveur **WebSocket** local (avec `tokio-tungstenite`) protégé par vérification du jeton d'appairage.
   - Génération dynamique du **QR Code d'appairage** et sauvegarde locale des appareils appairés.
3. **Interface Desktop Native (Direction artistique *Linear / Raycast / Windows 11 Mica*)** :
   - **Étape 2.1.a — Configuration fenêtre native sans bordure & Effet Mica** :
     - Passage de `decorations: false` et `transparent: true` dans `tauri.conf.json`.
     - Ajout des permissions `core:window:allow-start-dragging`, `allow-minimize`, `allow-toggle-maximize`, `allow-close`, `allow-hide` dans `capabilities/default.json`.
     - Ajout de `window-vibrancy` dans `Cargo.toml` et activation de l'effet Mica/Acrylic sombre de Windows 11 dans `lib.rs`.
   - **Étape 2.1.b — Système de design Graphite & Argent (`App.css`)** :
     - Définition des variables de thème (`#0C0D10`, `#121318`, `#181920`, bordures `1px` `rgba(255,255,255,0.07)`, accent Indigo `#6366F1`, vert émeraude `#10B981`).
     - Verrouillage du viewport en `h-screen w-screen overflow-hidden select-none` avec barres de défilement internes ultra-fines uniquement dans les panneaux de listes.
   - **Étape 2.1.c — Architecture en 4 zones fixes (`src/components/` & `src/App.tsx`)** :
     - `TitleBar.tsx` : Barre de titre intégrée (`36px`) avec région de glissement `data-tauri-drag-region`, badge de statut, barre de commande rapide (`Ctrl+K`) et contrôles fenêtre Windows 11 (réduire, agrandir, fermer dans le tray).
     - `Sidebar.tsx` : Rail de navigation latéral fixe (`210px`) avec raccourcis clavier (`Alt+1` à `Alt+5`), compteurs et carte d'état du téléphone ancrée en bas.
     - `Workspace` (Panneaux ancrés en *Split-View*) : Vue principale divisée entre le panneau d'action (Appairage QR haute précision ou Contrôle du téléphone) et un panneau d'inspection technique à droite (journal des événements temps réel, état des sockets et métriques).
     - `StatusBar.tsx` : Barre d'état inférieure (`26px`) affichant les indicateurs LED pour mDNS, `WS:52840`, `UDP:52841`, `HTTP:52842`, l'IP locale et la latence.

### 2.2. Côté Android (`android/`)
1. **Service persistant (`ConnectionForegroundService`)** :
   - Mise en place d'un `ForegroundService` léger avec notification discrète pour maintenir la connexion WebSocket active en arrière-plan sans être arrêté par Android.
   - Découverte automatique du PC sur le Wi-Fi via `NsdManager` (mDNS) et reconnexion automatique.
2. **Interface Jetpack Compose & Scanner de QR Code** :
   - Écran principal permettant de scanner le QR Code affiché sur le PC (via CameraX + ML Kit) ou de sélectionner le PC détecté sur le réseau local.
   - Stockage sécurisé du jeton d'appairage (`EncryptedSharedPreferences`).

---

## Étape 3 — Jalon 2 : État du téléphone, Presse-papiers partagé et Transfert de fichiers

1. **État du téléphone en temps réel et fonction « Trouver mon téléphone »** :
   - Lecture du niveau de batterie, de l'état de charge et du mode sonore via `BatteryManager` et `AudioManager` sur Android, envoyés au PC à chaque changement.
   - Bouton « Faire sonner mon téléphone » sur le PC qui déclenche une sonnerie maximale sur le téléphone même s'il est en mode silencieux/vibreur.
2. **Presse-papiers bidirectionnel** :
   - Surveillance des changements du presse-papiers texte sur le PC (Rust) et synchronisation vers Android (`ClipboardManager`).
   - Bouton rapide / action dans la barre de notification Android pour envoyer le presse-papiers du téléphone vers le PC (contournant la restriction d'Android 10+ sur la lecture silencieuse du presse-papiers en arrière-plan).
3. **Transfert rapide de fichiers et photos (PC ↔ Android)** :
   - Serveur HTTP/TCP local côté Rust et client/serveur de streaming sur Android pour transférer un ou plusieurs fichiers à la vitesse maximale du Wi-Fi local.
   - Glisser-déposer (*Drag & Drop*) d'un fichier sur la fenêtre/widget Tauri pour l'envoyer instantanément dans le dossier `Téléchargements` du téléphone.
   - Intégration au menu « Partager vers... » (*Share Sheet* Android `ACTION_SEND`) pour envoyer n'importe quelle photo ou fichier du téléphone vers le PC en un clic.

---

## Étape 4 — Jalon 3 : Synchronisation des notifications Android vers le PC

1. **Service d'écoute sur Android (`NexusNotificationListenerService`)** :
   - Implémentation de `NotificationListenerService` pour capter l'arrivée et la suppression des notifications des applications du téléphone (titre, texte, nom de l'application, icône, actions disponibles).
   - Extraction des `RemoteInput` (comme les réponses rapides aux SMS, WhatsApp, Telegram, Signal, etc.).
2. **Affichage et interaction sur le PC** :
   - Affichage des notifications dans le centre de notifications de NexusLink ET sous forme de notifications natives Windows.
   - Possibilité de fermer une notification depuis le PC (la supprime aussi sur le téléphone) ou de **taper une réponse directe** depuis le PC (exécutée sur le téléphone via le `PendingIntent` de la notification).

---

## Étape 5 — Jalon 4 : Passage fluide de la souris et du clavier du PC vers le téléphone

1. **Capture souris/clavier et détection du bord d'écran côté PC (Rust)** :
   - Configuration visuelle dans l'interface PC de la position physique du téléphone par rapport à l'écran du PC (Gauche, Droite ou Bas).
   - Implémentation en Rust d'un moniteur/hook bas niveau Windows (`SetWindowsHookEx` / API Win32) qui détecte lorsque le curseur atteint le bord configuré.
   - **Sécurité anti-franchissement accidentel** configurable : passage après une légère résistance (maintien de la poussée sur le bord pendant X ms ou franchissement d'une barrière de pixels) OU en maintenant une touche (`Ctrl` / `Alt`).
   - Une fois basculé en « mode Téléphone », blocage/masquage du curseur sur le PC et envoi des déplacements $\Delta x, \Delta y$, des clics, de la molette et des frappes clavier à 60–120 Hz via le canal **UDP**.
   - Retour instantané sur le PC dès que le curseur retraverse le bord en sens inverse (ou via un raccourci clavier de secours comme `Échap`).
2. **Curseur virtuel et injection d'événements sur Android (`CursorAccessibilityService`)** :
   - Création d'un `AccessibilityService` affichant un curseur de souris fluide par-dessus toutes les applications via `WindowManager` (`TYPE_ACCESSIBILITY_OVERLAY`).
   - Réception des paquets UDP pour déplacer le curseur sans latence.
   - Injection des clics simples, clics longs, défilements (molette) et glisser-déposer via `dispatchGesture()`.
   - Bouton droit de la souris mappé sur l'action « Retour » d'Android et bouton du milieu sur « Accueil ».
   - Injection du texte tapé au clavier du PC dans le champ de texte actif sur Android (`ACTION_SET_TEXT` / `AccessibilityNodeInfo`).

---

## Étape 6 — Jalon 5 : Recopie d'écran du téléphone sur le PC (Screen Mirroring)

1. **Capture et encodage sur Android (`ScreenMirrorController`)** :
   - Utilisation de l'API `MediaProjection` + `MediaCodec` (encodage matériel H.264 ou flux d'images basse latence) pour capturer l'écran du téléphone à la demande.
2. **Fenêtre de visualisation et contrôle sur le PC** :
   - Ouverture d'une fenêtre dédiée dans Tauri affichant l'écran du téléphone en direct.
   - Prise en charge directe des clics et du clavier à l'intérieur de cette fenêtre (en réutilisant le même canal UDP + `AccessibilityService` développé au Jalon 4).

---

## Étape 7 — Architecture préparée pour de futures fonctions hors réseau local (Optionnel / v2)

- Abstraction de la couche de transport réseau (`TransportTrait` en Rust / interface `TransportChannel` en Kotlin) afin que les canaux WebSocket/UDP/HTTP locaux puissent plus tard être remplacés de manière transparente par un tunnel **WebRTC P2P** ou un réseau virtuel type **Tailscale / Relais auto-hébergé** sans modifier la logique métier.
