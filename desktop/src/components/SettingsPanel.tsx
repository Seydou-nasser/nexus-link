import { useState } from "react";
import {
  BatteryCharging,
  Bell,
  Clipboard,
  FolderOpen,
  HardDrive,
  Images,
  Info,
  Keyboard,
  Link2Off,
  MonitorSmartphone,
  MousePointerClick,
  Network,
  QrCode,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Wifi,
} from "lucide-react";
import type { ServerStatus } from "../types/protocol";

type SettingsSectionId = "general" | "device" | "about";

interface SettingsPanelProps {
  status: ServerStatus;
  onRegenerateToken: () => void;
  onRequestDisconnect: () => void;
  onOpenDownloadsFolder: () => void;
}

export function SettingsPanel({
  status,
  onRegenerateToken,
  onRequestDisconnect,
  onOpenDownloadsFolder,
}: SettingsPanelProps) {
  const [activeSection, setActiveSection] =
    useState<SettingsSectionId>("general");

  const connectedDevice = status.connectedDevice;

  const navItems: {
    id: SettingsSectionId;
    label: string;
    icon: typeof SlidersHorizontal;
  }[] = [
    { id: "general", label: "Général", icon: SlidersHorizontal },
    { id: "device", label: "Appareil & Association", icon: Smartphone },
    { id: "about", label: "À propos", icon: Info },
  ];

  return (
    <div className="h-full flex gap-6 min-h-0">
      {/* Colonne gauche : menu latéral façon Paramètres Windows 11 */}
      <aside className="w-[220px] shrink-0 flex flex-col gap-1 border-r border-white/[0.07] pr-4">
        <div className="px-2.5 pb-2.5">
          <h2 className="text-[16px] font-semibold text-[#f2f5f8]">
            Paramètres
          </h2>
          <p className="text-[11.5px] text-[#788896]">
            Configuration locale du PC
          </p>
        </div>

        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveSection(item.id)}
              className={`relative h-9 px-3 rounded-lg flex items-center gap-2.5 text-[13px] transition cursor-pointer ${
                isActive
                  ? "bg-white/[0.07] text-[#f2f5f8] font-medium"
                  : "text-[#b0cadc] hover:text-[#f2f5f8] hover:bg-white/[0.04]"
              }`}
            >
              {isActive && (
                <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-[#87CFF9]" />
              )}
              <Icon
                className={`w-4 h-4 shrink-0 ${
                  isActive ? "text-[#87CFF9]" : "text-[#9cb1c2]"
                }`}
              />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </aside>

      {/* Colonne droite : détails de la section active */}
      <section className="flex-1 min-w-0 overflow-y-auto pr-1 space-y-5">
        {activeSection === "general" && (
          <>
            <div>
              <h3 className="text-[15px] font-semibold text-[#f2f5f8]">
                Général
              </h3>
              <p className="text-[12px] text-[#b0cadc]">
                Dossier de réception, services réseau locaux et raccourcis
                clavier.
              </p>
            </div>

            {/* Dossier de réception */}
            <div className="rounded-xl bg-[#232934]/75 border border-white/[0.07] p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-[#005C7D]/50 border border-[#87CFF9]/25 flex items-center justify-center text-[#87CFF9] shrink-0">
                  <FolderOpen className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-[#f2f5f8]">
                    Dossier des fichiers reçus
                  </div>
                  <div className="text-[12px] text-[#788896]">
                    Tous les fichiers envoyés depuis Android sont enregistrés
                    localement sur ce PC.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onOpenDownloadsFolder}
                className="h-8 px-3 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[12px] text-[#d6e4ee] flex items-center gap-1.5 transition cursor-pointer shrink-0"
              >
                <FolderOpen className="w-3.5 h-3.5 text-[#87CFF9]" />
                Ouvrir le dossier
              </button>
            </div>

            {/* État du réseau local */}
            <div className="rounded-xl bg-[#232934]/75 border border-white/[0.07] p-4 space-y-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Network className="w-4 h-4 text-[#87CFF9]" />
                  <span className="text-[13px] font-medium text-[#f2f5f8]">
                    Services réseau local (Wi-Fi)
                  </span>
                </div>
                <span
                  className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium ${
                    status.wsListening
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-rose-500/15 text-rose-300"
                  }`}
                >
                  {status.wsListening ? "Serveur actif" : "Serveur arrêté"}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-[12px]">
                <div className="rounded-lg bg-[#14171c]/70 border border-white/[0.06] px-3 py-2.5 flex items-center justify-between gap-2">
                  <span className="text-[#788896]">Nom de cet ordinateur</span>
                  <span className="font-medium text-[#f2f5f8] truncate">
                    {status.deviceName}
                  </span>
                </div>
                <div className="rounded-lg bg-[#14171c]/70 border border-white/[0.06] px-3 py-2.5 flex items-center justify-between gap-2">
                  <span className="text-[#788896]">Découverte mDNS</span>
                  <span
                    className={
                      status.mdnsActive
                        ? "text-[#87CFF9] font-medium"
                        : "text-[#788896]"
                    }
                  >
                    {status.mdnsActive ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="rounded-lg bg-[#14171c]/70 border border-white/[0.06] px-3 py-2.5 flex items-center justify-between gap-2">
                  <span className="text-[#788896]">Adresses IP locales</span>
                  <span className="font-mono-tabular text-[#d6e4ee] truncate">
                    {status.localIps.length > 0
                      ? status.localIps.join(", ")
                      : "Aucune"}
                  </span>
                </div>
                <div className="rounded-lg bg-[#14171c]/70 border border-white/[0.06] px-3 py-2.5 flex items-center justify-between gap-2">
                  <span className="text-[#788896]">
                    Ports (WS / UDP / HTTP / Média)
                  </span>
                  <span className="font-mono-tabular text-[#d6e4ee]">
                    {status.wsPort} / {status.udpPort} / {status.httpPort} /
                    52843
                  </span>
                </div>
              </div>
            </div>

            {/* Raccourcis clavier */}
            <div className="rounded-xl bg-[#232934]/75 border border-white/[0.07] p-4 space-y-3">
              <div className="flex items-center gap-2.5">
                <Keyboard className="w-4 h-4 text-[#87CFF9]" />
                <span className="text-[13px] font-medium text-[#f2f5f8]">
                  Raccourcis clavier
                </span>
              </div>

              <div className="space-y-2 text-[12px]">
                <div className="flex items-center justify-between py-1 border-b border-white/[0.05]">
                  <span className="text-[#b0cadc]">
                    Ouvrir la palette d&apos;actions rapides
                  </span>
                  <kbd className="px-2 py-0.5 rounded bg-[#14171c] border border-white/[0.1] text-[#87CFF9] font-mono-tabular text-[11px]">
                    Ctrl + K
                  </kbd>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-white/[0.05]">
                  <span className="text-[#b0cadc]">
                    Changer rapidement d&apos;onglet
                  </span>
                  <kbd className="px-2 py-0.5 rounded bg-[#14171c] border border-white/[0.1] text-[#87CFF9] font-mono-tabular text-[11px]">
                    Alt + 1..6
                  </kbd>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-[#b0cadc]">
                    Reprendre immédiatement la souris sur le PC
                  </span>
                  <kbd className="px-2 py-0.5 rounded bg-[#14171c] border border-white/[0.1] text-[#87CFF9] font-mono-tabular text-[11px]">
                    Échap
                  </kbd>
                </div>
              </div>
            </div>
          </>
        )}

        {activeSection === "device" && (
          <>
            <div>
              <h3 className="text-[15px] font-semibold text-[#f2f5f8]">
                Appareil &amp; Association
              </h3>
              <p className="text-[12px] text-[#b0cadc]">
                Gérez le téléphone actuellement connecté ou associez un nouvel
                appareil Android.
              </p>
            </div>

            {/* Carte de l'appareil connecté */}
            <div className="rounded-xl bg-[#232934]/75 border border-white/[0.07] p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${
                      connectedDevice
                        ? "bg-[#005C7D]/60 border-[#87CFF9]/35 text-[#87CFF9]"
                        : "bg-white/[0.04] border-white/[0.08] text-[#788896]"
                    }`}
                  >
                    <Smartphone className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold text-[#f2f5f8] truncate">
                      {connectedDevice
                        ? connectedDevice.deviceName
                        : "Aucun appareil connecté"}
                    </div>
                    <div className="text-[12px] text-[#788896]">
                      {connectedDevice
                        ? `${connectedDevice.model} • Android ${connectedDevice.androidVersion}`
                        : "Scannez le QR Code ci-dessous depuis l'application Android NexusLink."}
                    </div>
                  </div>
                </div>

                {connectedDevice && (
                  <button
                    type="button"
                    onClick={onRequestDisconnect}
                    className="h-8 px-3 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-[12px] font-medium flex items-center gap-1.5 transition cursor-pointer shrink-0"
                  >
                    <Link2Off className="w-3.5 h-3.5" />
                    Déconnecter
                  </button>
                )}
              </div>

              {connectedDevice && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[12px]">
                  <div className="rounded-lg bg-[#14171c]/70 border border-white/[0.06] px-3 py-2 flex items-center justify-between">
                    <span className="text-[#788896] flex items-center gap-1.5">
                      <Wifi className="w-3.5 h-3.5 text-[#87CFF9]" />
                      Adresse IP
                    </span>
                    <span className="font-mono-tabular text-[#f2f5f8]">
                      {connectedDevice.ipAddress}
                    </span>
                  </div>
                  <div className="rounded-lg bg-[#14171c]/70 border border-white/[0.06] px-3 py-2 flex items-center justify-between">
                    <span className="text-[#788896] flex items-center gap-1.5">
                      <BatteryCharging className="w-3.5 h-3.5 text-[#87CFF9]" />
                      Batterie
                    </span>
                    <span className="font-mono-tabular text-[#f2f5f8]">
                      {connectedDevice.batteryLevel}%
                      {connectedDevice.isCharging ? " (en charge)" : ""}
                    </span>
                  </div>
                  <div className="rounded-lg bg-[#14171c]/70 border border-white/[0.06] px-3 py-2 flex items-center justify-between">
                    <span className="text-[#788896]">Statut</span>
                    <span className="text-emerald-300 font-medium">
                      Connecté
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Bloc QR Code d'association */}
            <div className="rounded-xl bg-[#232934]/75 border border-white/[0.07] p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <QrCode className="w-4 h-4 text-[#87CFF9]" />
                  <div>
                    <div className="text-[13px] font-medium text-[#f2f5f8]">
                      QR Code d&apos;association
                    </div>
                    <div className="text-[12px] text-[#788896]">
                      Régénérez le jeton de sécurité si vous souhaitez invalider
                      l&apos;ancien QR Code.
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onRegenerateToken}
                  className="h-8 px-3 rounded-lg bg-[#005C7D] hover:bg-[#00719a] text-[#f2f5f8] text-[12px] font-medium flex items-center gap-1.5 transition cursor-pointer shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-[#87CFF9]" />
                  Régénérer le jeton
                </button>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-5 pt-1">
                <div
                  className="w-[172px] h-[172px] rounded-2xl bg-white p-3 flex items-center justify-center shadow-lg shrink-0"
                  dangerouslySetInnerHTML={{ __html: status.qrSvg }}
                />
                <div className="space-y-2 text-[12.5px] text-[#b0cadc]">
                  <p>
                    Ouvrez <strong className="text-[#f2f5f8]">NexusLink</strong>{" "}
                    sur votre téléphone Android et scannez ce code pour établir
                    une liaison chiffrée sur votre réseau Wi-Fi local.
                  </p>
                  <p className="text-[11.5px] text-[#788896]">
                    Astuce : vous pouvez aussi sélectionner{" "}
                    <strong className="text-[#d6e4ee]">
                      {status.deviceName}
                    </strong>{" "}
                    directement depuis la liste des PC détectés sur Android.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}

        {activeSection === "about" && (
          <>
            <div>
              <h3 className="text-[15px] font-semibold text-[#f2f5f8]">
                À propos de NexusLink
              </h3>
              <p className="text-[12px] text-[#b0cadc]">
                Pont local rapide, léger et privé entre votre PC Windows et
                votre téléphone Android.
              </p>
            </div>

            <div className="rounded-xl bg-[#232934]/75 border border-white/[0.07] p-5 space-y-4">
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-[#005C7D] border border-[#87CFF9]/35 flex items-center justify-center text-[#87CFF9] shrink-0">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <div className="text-[15px] font-semibold text-[#f2f5f8]">
                    NexusLink Desktop
                  </div>
                  <div className="text-[12px] text-[#b0cadc]">
                    Version 0.1.0 • Tauri v2 + Rust + React
                  </div>
                </div>
              </div>

              <p className="text-[12.5px] text-[#c7d6e2] leading-relaxed">
                NexusLink connecte directement votre téléphone Android à votre
                PC sur votre réseau Wi-Fi local. Vos photos, vidéos, fichiers,
                notifications et contrôles ne passent par aucun serveur externe
                ni compte cloud : tout reste chez vous, avec une empreinte
                mémoire minimale.
              </p>

              {/* Grille des fonctionnalités principales */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                {[
                  {
                    icon: Images,
                    title: "Galerie Photos & Vidéos",
                    desc: "Récents, dossiers du téléphone, lecture vidéo en streaming et suppression directe.",
                  },
                  {
                    icon: HardDrive,
                    title: "Explorateur de fichiers",
                    desc: "Navigation complète du stockage, recherche récursive et glisser-déposer direct.",
                  },
                  {
                    icon: Clipboard,
                    title: "Transferts & Presse-papiers",
                    desc: "Envoi haut débit en streaming et synchronisation texte/captures en temps réel.",
                  },
                  {
                    icon: Bell,
                    title: "Messages SMS & Notifications",
                    desc: "Conversations SMS temps réel, envoi depuis le PC, notifications et réponses rapides.",
                  },
                  {
                    icon: MonitorSmartphone,
                    title: "Écran du téléphone",
                    desc: "Fenêtre dédiée fluide avec gestes tactiles interactifs depuis la souris.",
                  },
                  {
                    icon: MousePointerClick,
                    title: "Souris & Clavier partagés",
                    desc: "Bascule naturelle au bord de l'écran en UDP 120 Hz avec retour Échap.",
                  },
                ].map((feature) => {
                  const Icon = feature.icon;
                  return (
                    <div
                      key={feature.title}
                      className="rounded-xl bg-[#14171c]/70 border border-white/[0.06] p-3 flex items-start gap-2.5"
                    >
                      <div className="w-7 h-7 rounded-lg bg-[#005C7D]/45 border border-[#87CFF9]/25 flex items-center justify-center text-[#87CFF9] shrink-0 mt-0.5">
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium text-[#f2f5f8]">
                          {feature.title}
                        </div>
                        <div className="text-[11px] text-[#788896] leading-snug mt-0.5">
                          {feature.desc}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[12px] pt-1">
                <div className="rounded-lg bg-[#14171c]/70 border border-white/[0.06] px-3 py-2.5 flex items-center justify-between gap-2">
                  <span className="text-[#788896]">Confidentialité</span>
                  <span className="text-emerald-300 font-medium">
                    100 % Local
                  </span>
                </div>
                <div className="rounded-lg bg-[#14171c]/70 border border-white/[0.06] px-3 py-2.5 flex items-center justify-between gap-2">
                  <span className="text-[#788896]">Contrôle UDP</span>
                  <span className="text-[#87CFF9] font-medium">
                    HMAC-SHA256
                  </span>
                </div>
                <div className="rounded-lg bg-[#14171c]/70 border border-white/[0.06] px-3 py-2.5 flex items-center justify-between gap-2">
                  <span className="text-[#788896]">Identifiant PC</span>
                  <span className="font-mono-tabular text-[#d6e4ee] truncate max-w-[120px]">
                    {status.deviceId}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
