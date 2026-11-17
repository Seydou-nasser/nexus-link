# NexusLink

Alternative ultra-légère, rapide et **100 % locale** (sans dépendance au Cloud) à *Mobile connecté* de Windows, reliant un ordinateur (**Windows / Linux / macOS**) et un smartphone **Android**.

---

## Fonctionnalités disponibles (Jalon 1)

- **Découverte automatique sur le réseau Wi-Fi local** (mDNS / Zeroconf) sans configuration manuelle.
- **Deux modes d'association sécurisés** :
  - **Par QR Code** affiché sur l'application PC et scanné depuis l'appareil Android.
  - **En un clic depuis la liste « Ordinateurs à proximité »** sur Android, avec notification Windows et **code de vérification à 6 chiffres** affiché sur les deux écrans.
- **Mémorisation locale & reconnexion automatique** : les appareils associés sont enregistrés localement (`paired_devices.json` côté PC et préférences Android) pour se reconnecter automatiquement après redémarrage.
- **Déconnexion synchronisée bidirectionnelle** : la déconnexion depuis le téléphone ou depuis le PC réinitialise immédiatement la session sur les deux appareils.
- **Application PC résidente en barre système (*System Tray*)** : continue de fonctionner en arrière-plan avec une empreinte mémoire minimale.
- **Service persistant Android (*ForegroundService*)** : maintient la liaison active même lorsque l'application est en arrière-plan.

## Feuille de route

- **Jalon 2** *(à venir)* : Batterie et mode sonnerie en temps réel, fonction « Faire sonner mon téléphone », presse-papiers bidirectionnel et transfert rapide de fichiers/photos en Wi-Fi.
- **Jalon 3** *(à venir)* : Synchronisation des notifications Android vers Windows avec réponse directe.
- **Jalon 4** *(à venir)* : Passage fluide de la souris et du clavier du bord de l'écran du PC vers le téléphone (UDP basse latence).
- **Jalon 5** *(à venir)* : Recopie d'écran du téléphone sur le PC (*Screen Mirroring*).

---

## Architecture & Technologies

| Dossier | Rôle | Stack technique |
| :--- | :--- | :--- |
| `desktop/` | Application PC (serveur local & interface) | **Tauri v2**, **Rust** (Tokio, `tokio-tungstenite`, `mdns-sd`), **React**, **TypeScript**, **Tailwind CSS** |
| `android/` | Application mobile native | **Kotlin**, **Jetpack Compose** (Material 3), **OkHttp**, **NsdManager**, **CameraX** + **ML Kit** |
| `docs/` | Spécification du protocole réseau | [protocol-spec.md](docs/protocol-spec.md) (WebSocket JSON, UDP binaire 16 octets, HTTP streaming) |

---

## Lancer le projet en développement

### 1. Application PC (`desktop/`)
Prérequis : **Node.js**, **pnpm** et **Rust / Cargo**.

```powershell
cd desktop
pnpm install
pnpm tauri dev
```
*(Sous Windows, autorisez l'accès au **réseau privé** lorsque le Pare-feu Windows le demande au premier lancement).*

### 2. Application Android (`android/`)
Prérequis : **Android Studio** (ou **Android CLI**), SDK Android API 36 (minimum API 29 / Android 10).

- Ouvrez le dossier `android/` dans **Android Studio** et cliquez sur **Run (▶)** sur un téléphone connecté au même Wi-Fi que le PC.
- Ou en ligne de commande depuis `android\app` :
  ```powershell
  android run --debug
  ```
