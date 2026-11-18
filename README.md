# NexusLink

Alternative ultra-légère, rapide et **100 % locale** (sans dépendance au Cloud) à _Mobile connecté_ de Windows, reliant un ordinateur (**Windows / Linux / macOS**) et un smartphone **Android**.

---

## Fonctionnalités disponibles (Jalons 1 à 4)

- **Découverte automatique sur le réseau Wi-Fi local** (mDNS / Zeroconf) sans configuration manuelle.
- **Deux modes d'association sécurisés** :
  - **Par QR Code** affiché sur l'application PC et scanné depuis l'appareil Android.
  - **En un clic depuis la liste « Ordinateurs à proximité »** sur Android, avec notification Windows et **code de vérification à 6 chiffres** affiché sur les deux écrans.
- **Mémorisation locale & reconnexion automatique** : les appareils associés sont enregistrés localement (`paired_devices.json` côté PC et préférences Android) pour se reconnecter automatiquement après redémarrage.
- **Déconnexion sécurisée et synchronisée** : confirmation explicite avant déconnexion côté PC comme côté Android, avec réinitialisation immédiate de la session sur les deux appareils.
- **Application PC résidente en barre système (_System Tray_)** et **service persistant Android (_ForegroundService_)**.
- **État du téléphone en temps réel & « Faire sonner »** : suivi en direct de la batterie, de la charge et du mode sonnerie, et déclenchement de la sonnerie à volume maximal depuis le PC (même en mode silencieux/vibreur).
- **Presse-papiers bidirectionnel 100 % automatique (Texte & Captures d'écran)** :
  - Synchronisation instantanée PC ↔ Android des textes copiés (`AccessibilityService`, sans ADB).
  - Synchronisation automatique des captures d'écran / images du presse-papiers en JPEG ($\le$ 5 Mo) dans les deux sens (`ScreenshotObserver` universel sur Android).
- **Transfert rapide de fichiers & photos (`HTTP :52842`)** :
  - Envoi par glisser-déposer ou sélecteur natif depuis le PC, et via le sélecteur ou le menu système **« Envoyer vers mon PC (NexusLink) »** depuis Android.
  - Enregistrement automatique dans `Téléchargements\NexusLink` (PC) et `Downloads/NexusLink` (Android) avec miniatures et ouverture directe au clic.
- **Centre de notifications Android ↔ PC** :
  - Synchronisation en temps réel et récupération des notifications déjà actives à la connexion (`NotificationListenerService`).
  - Affichage du nom réel et de l'icône de chaque application, pliage/dépliage des messages longs, fermeture synchronisée et **réponse directe** depuis le PC (`RemoteInput`).
- **Passage fluide Souris & Clavier (`UDP :52841`, 120 Hz)** :
  - Bascule naturelle au bord configuré de l'écran (`Gauche`, `Droite`, `Bas`) avec résistance anti-franchissement et maintien optionnel de `Ctrl`.
  - Trames binaires de **16 octets** authentifiées par **HMAC-SHA256** tronqué (anti-rejeu par numéro de séquence).
  - Curseur virtuel matériel en surimpression Android (`Choreographer` VSync), clics/glisser-déposer/molette (`dispatchGesture`), clic droit (`Retour`), clic milieu (`Accueil`), saisie clavier et retour instantané par le bord opposé ou `Échap`.

## Feuille de route

- **Jalon 1** _(terminé)_ : Découverte mDNS, appairage sécurisé QR / code 6 chiffres, reconnexion automatique et statut batterie/sonnerie.
- **Jalon 2** _(terminé)_ : Presse-papiers bidirectionnel (texte & captures d'écran) et transfert rapide de fichiers via HTTP.
- **Jalon 3** _(terminé)_ : Centre de notifications Android sur PC avec réponse directe et suppression synchronisée.
- **Jalon 4** _(terminé)_ : Passage fluide souris/clavier au bord d'écran vers Android en UDP binaire 120 Hz.
- **Jalon 5** _(prochaine étape)_ : Recopie d'écran du téléphone sur le PC (_Screen Mirroring_).

---

## Architecture & Technologies

| Dossier    | Rôle                                       | Stack technique                                                                                                             |
| :--------- | :----------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| `desktop/` | Application PC (serveur local & interface) | **Tauri v2**, **Rust** (Tokio, `tokio-tungstenite`, `mdns-sd`, `hmac`/`sha2`, `windows-sys`), **React**, **TypeScript**, **Tailwind CSS** |
| `android/` | Application mobile native                  | **Kotlin**, **Jetpack Compose** (Material 3), **OkHttp**, **NsdManager**, **CameraX** + **ML Kit**          |
| `docs/`    | Spécification du protocole réseau          | [protocol-spec.md](docs/protocol-spec.md) (WebSocket JSON, UDP binaire 16 octets, HTTP streaming)           |

---

## Lancer le projet en développement

### 1. Application PC (`desktop/`)

Prérequis : **Node.js**, **pnpm** et **Rust / Cargo**.

```powershell
cd desktop
pnpm install
pnpm tauri dev
```

_(Sous Windows, autorisez l'accès au **réseau privé** lorsque le Pare-feu Windows le demande au premier lancement)._

### 2. Application Android (`android/`)

Prérequis : **Android Studio** (ou **Android CLI**), SDK Android API 36 (minimum API 29 / Android 10).

- Ouvrez le dossier `android/` dans **Android Studio** et cliquez sur **Run (▶)** sur un téléphone connecté au même Wi-Fi que le PC.
- Ou en ligne de commande depuis `android\app` :
  ```powershell
  android run
  ```
