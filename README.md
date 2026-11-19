# NexusLink

**NexusLink** est une application de liaison **PC ↔ Android** ultra-légère, rapide et **100 % locale** (sans serveur distant ni compte Cloud). Elle permet de relier un ordinateur (**Windows / Linux / macOS**) et un smartphone **Android** sur le même réseau Wi-Fi pour partager presse-papiers, fichiers, notifications, souris, clavier et écran en temps réel.

---

## Fonctionnalités

### Connexion & Appairage
- **Découverte automatique en réseau local** (mDNS / Zeroconf) sans saisie manuelle d'adresse IP.
- **Deux modes d'association sécurisés** :
  - **Par QR Code** affiché sur le PC et scanné depuis l'application Android.
  - **En un clic** depuis la liste des ordinateurs à proximité, avec notification Windows et **code de vérification à 6 chiffres** sur les deux appareils.
- **Reconnexion automatique** : les appareils associés sont mémorisés localement (`paired_devices.json` côté PC, préférences chiffrées côté Android).
- **Déconnexion sécurisée** : confirmation explicite avant dissociation des deux côtés et nettoyage instantané de la session.
- **Exécution discrète en arrière-plan** : icône dans la barre système Windows (*System Tray*) côté PC et service persistant (*Foreground Service*) côté Android.

### Presse-papiers & Transfert de fichiers
- **Presse-papiers bidirectionnel automatique (texte et images)** :
  - Synchronisation instantanée PC ↔ Android du texte copié (via le service d'accessibilité Android, sans ADB).
  - Synchronisation automatique des captures d'écran et images du presse-papiers en JPEG ($\le$ 5 Mo) dans les deux sens.
- **Transfert de fichiers haut débit (`HTTP :52842`)** :
  - Envoi par glisser-déposer ou sélecteur natif depuis le PC, et via le sélecteur ou le menu système **« Envoyer vers mon PC (NexusLink) »** depuis Android.
  - Enregistrement automatique dans `Téléchargements\NexusLink` (PC) et `Downloads/NexusLink` (Android), avec miniatures et ouverture directe au clic.

### Centre de notifications
- **Synchronisation en temps réel** des notifications Android et récupération des notifications déjà actives dès la connexion.
- **Affichage clair** : nom réel et icône de chaque application, horodatage, pliage/dépliage des messages longs.
- **Actions à distance** : fermeture synchronisée et **réponse directe** depuis le clavier du PC pour les applications compatibles (SMS, WhatsApp, Telegram, etc.).

### Souris & Clavier partagés (UDP 120 Hz)
- **Passage fluide au bord de l'écran** : faites glisser le curseur du PC vers le bord configuré (*Gauche*, *Droite* ou *Bas*) pour passer naturellement sur l'écran du téléphone.
- **Protection anti-franchissement accidentel** : délai de résistance réglable au bord et maintien optionnel de la touche `Ctrl`.
- **Curseur virtuel fluide sur Android** : rendu matériel synchronisé sur VSync (`Choreographer`), clics simples, appuis longs, glisser-déposer, défilement à la molette, clic droit (*Retour*), clic milieu (*Accueil*) et saisie clavier.
- **Retour immédiat sur le PC** en retraversant le bord opposé ou en appuyant sur `Échap`.

### Recopie d'écran en fenêtre dédiée
- **Fenêtre indépendante et redimensionnable** : s'ouvre centrée et dimensionnée automatiquement selon l'écran du PC, avec barre compacte (*Retour Android*, menu `⋯` *Toujours au premier plan / Accueil / Actualiser*, réduire, agrandir, fermer).
- **Flux basse latence** (`MediaProjection` + streaming MJPEG sur `HTTP :52842`).
- **Contrôle tactile en direct** : curseur rond façon point tactile, clics courts, appuis longs, glisser-déposer continu en temps réel, molette et saisie clavier.

### Suivi de l'appareil
- **État en temps réel** : niveau de batterie, état de charge et mode sonnerie du téléphone visibles en permanence sur le PC.
- **Faire sonner mon téléphone** : déclenchement de la sonnerie à volume maximal depuis le PC, même lorsque le téléphone est en mode silencieux ou vibreur.

---

## Sécurité & Vie privée

- **100 % local** : aucune donnée (presse-papiers, fichiers, notifications, écran) ne transite par Internet ou par un serveur tiers.
- **Session authentifiée** : chaque appareil appairé dispose d'un `sessionSecret` local vérifié sur le canal WebSocket (`:52840`) et les endpoints HTTP (`:52842`).
- **Trames UDP signées** : chaque paquet binaire de 16 octets (`:52841`) est authentifié par **HMAC-SHA256** tronqué sur 32 bits avec protection anti-rejeu par numéro de séquence.

---

## Architecture & Technologies

| Dossier    | Rôle                                       | Stack technique                                                                                                                            |
| :--------- | :----------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------- |
| `desktop/` | Application PC (serveur local & interface) | **Tauri v2**, **Rust** (Tokio, Axum, `tokio-tungstenite`, `mdns-sd`, `hmac`/`sha2`, `windows-sys`), **React**, **TypeScript**, **Tailwind CSS** |
| `android/` | Application mobile native                  | **Kotlin**, **Jetpack Compose** (Material 3), **OkHttp**, **NsdManager**, **CameraX** + **ML Kit**, `MediaProjection`, `AccessibilityService`   |
| `docs/`    | Spécification du protocole réseau          | [protocol-spec.md](docs/protocol-spec.md) (WebSocket JSON, UDP binaire 16 octets, HTTP streaming)                                          |

---

## Lancer le projet en développement

### 1. Application PC (`desktop/`)

Prérequis : **Node.js**, **pnpm** et **Rust / Cargo**.

```powershell
cd desktop
pnpm install
pnpm tauri dev
```

*(Sous Windows, autorisez l'accès au **réseau privé** lorsque le Pare-feu Windows le demande au premier lancement.)*

### 2. Application Android (`android/`)

Prérequis : **Android Studio** (ou **Android CLI**), SDK Android API 36 (minimum API 29 / Android 10).

- Ouvrez le dossier `android/` dans **Android Studio** et cliquez sur **Run (▶)** sur un téléphone connecté au même réseau Wi-Fi que le PC.
- Ou en ligne de commande depuis `android\app` :
  ```powershell
  android run
  ```
