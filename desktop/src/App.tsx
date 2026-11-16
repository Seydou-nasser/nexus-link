import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowLeftRight,
  Bell,
  Check,
  Clipboard,
  Copy,
  FileUp,
  KeyRound,
  Monitor,
  MonitorPlay,
  MousePointerClick,
  QrCode,
  RefreshCw,
  Smartphone,
  Sparkles,
  Terminal,
  Volume2,
} from "lucide-react";
import { Sidebar, type NavSectionId } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import type { ServerStatus } from "./types/protocol";
import "./App.css";

type ScreenEdge = "LEFT" | "RIGHT" | "BOTTOM";

function App() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [activeSection, setActiveSection] = useState<NavSectionId>("overview");
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(true);
  const [selectedEdge, setSelectedEdge] = useState<ScreenEdge>("RIGHT");
  const [edgeResistanceMs, setEdgeResistanceMs] = useState<number>(120);
  const [requireCtrlKey, setRequireCtrlKey] = useState<boolean>(false);
  const [copiedToken, setCopiedToken] = useState<boolean>(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false);

  const fetchServerStatus = async () => {
    try {
      const currentStatus = await invoke<ServerStatus>("get_server_status");
      setStatus(currentStatus);
    } catch (error) {
      console.error("Erreur lors de la récupération du statut :", error);
    }
  };

  const handleRegenerateToken = async () => {
    try {
      const updated = await invoke<ServerStatus>("regenerate_pairing_token");
      setStatus(updated);
    } catch (error) {
      console.error("Impossible de régénérer le jeton :", error);
    }
  };

  const handleSimulateDevice = async () => {
    try {
      const updated = await invoke<ServerStatus>("simulate_device_connection");
      setStatus(updated);
    } catch (error) {
      console.error("Erreur lors de la simulation :", error);
    }
  };

  const handleDisconnectDevice = async () => {
    try {
      const updated = await invoke<ServerStatus>("disconnect_device");
      setStatus(updated);
    } catch (error) {
      console.error("Erreur lors de la déconnexion :", error);
    }
  };

  const handleCopyPairingJson = async () => {
    if (!status) return;
    await navigator.clipboard.writeText(status.qrRawJson);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 1800);
  };

  useEffect(() => {
    fetchServerStatus();

    const unlistenPromise = listen<ServerStatus>(
      "nexus://state-updated",
      (event) => {
        setStatus(event.payload);
      }
    );

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      } else if (event.altKey && event.key === "1") {
        setActiveSection("overview");
      } else if (event.altKey && event.key === "2") {
        setActiveSection("input");
      } else if (event.altKey && event.key === "3") {
        setActiveSection("notifications");
      } else if (event.altKey && event.key === "4") {
        setActiveSection("files");
      } else if (event.altKey && event.key === "5") {
        setActiveSection("mirror");
      } else if (event.key === "Escape") {
        setCommandPaletteOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  if (!status) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0c0d10] text-zinc-400 text-[12px]">
        <div className="flex items-center gap-2.5">
          <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
          <span>Initialisation du moteur système NexusLink…</span>
        </div>
      </div>
    );
  }

  const connectedDevice = status.connectedDevice;

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0c0d10]/90 text-zinc-100 overflow-hidden">
      {/* 1. Barre de titre intégrée (Frameless Desktop) */}
      <TitleBar
        status={status}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen((prev) => !prev)}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      />

      {/* 2. Corps de l'application : Sidebar + Zone centrale + Inspecteur */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <Sidebar
          activeSection={activeSection}
          onSelectSection={setActiveSection}
          connectedDevice={connectedDevice}
          onSimulateDevice={handleSimulateDevice}
          onDisconnectDevice={handleDisconnectDevice}
        />

        {/* Zone de travail principale */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#0c0d10]/60">
          {/* Barre d'outils contextuelle supérieure du panneau */}
          <div className="h-10 px-5 border-b border-white/[0.065] flex items-center justify-between shrink-0 bg-[#101217]/60">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="text-zinc-400">Poste de travail</span>
              <span className="text-zinc-600">/</span>
              <span className="font-medium text-zinc-100">
                {activeSection === "overview" && "Liaison & Appareil"}
                {activeSection === "input" &&
                  "Passage Souris & Clavier inter-écrans"}
                {activeSection === "notifications" &&
                  "Flux de notifications Android"}
                {activeSection === "files" &&
                  "Transfert direct & Presse-papiers"}
                {activeSection === "mirror" &&
                  "Recopie d'écran faible latence"}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleRegenerateToken}
                className="h-7 px-2.5 rounded bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.07] flex items-center gap-1.5 text-[11px] text-zinc-300 transition cursor-pointer"
              >
                <RefreshCw className="w-3 h-3 text-zinc-400" />
                Nouvelle clé de session
              </button>
            </div>
          </div>

          {/* Contenu du panneau actif */}
          <div className="flex-1 overflow-y-auto p-5">
            {activeSection === "overview" && (
              <div className="space-y-5 max-w-4xl">
                {!connectedDevice ? (
                  /* Panneau d'appairage style matériel Linear / Raycast */
                  <div className="rounded-xl bg-[#111319] border border-white/[0.07] overflow-hidden">
                    <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between bg-[#14171f]/60">
                      <div className="flex items-center gap-2">
                        <QrCode className="w-4 h-4 text-indigo-400" />
                        <span className="text-[12px] font-medium text-zinc-100">
                          Appairage cryptographique local (QR / mDNS)
                        </span>
                      </div>
                      <span className="text-[11px] font-mono-tabular text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                        Prêt sur le port {status.wsPort}
                      </span>
                    </div>

                    <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                      {/* Cadre QR haute précision */}
                      <div className="lg:col-span-5 flex flex-col items-center">
                        <div className="p-3.5 rounded-xl bg-white shadow-inner border border-zinc-200">
                          <div
                            className="w-44 h-44 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
                            dangerouslySetInnerHTML={{ __html: status.qrSvg }}
                          />
                        </div>
                        <span className="mt-2.5 text-[11px] text-zinc-500 font-mono-tabular">
                          Clé éphémère 256-bit • Sans serveur tiers
                        </span>
                      </div>

                      {/* Instructions techniques structurées */}
                      <div className="lg:col-span-7 space-y-4">
                        <div>
                          <h2 className="text-[15px] font-semibold text-zinc-100">
                            Associer un appareil Android sur le réseau local
                          </h2>
                          <p className="text-[12px] text-zinc-400 mt-1 leading-relaxed">
                            Ouvre l'application native <strong>NexusLink</strong>{" "}
                            sur ton téléphone Android. Le PC est détecté
                            automatiquement via mDNS ou en scannant ce code.
                          </p>
                        </div>

                        <div className="rounded-lg bg-[#0c0d11] border border-white/[0.06] divide-y divide-white/[0.05] text-[12px]">
                          <div className="px-3.5 py-2 flex items-center justify-between">
                            <span className="text-zinc-400">Hôte local</span>
                            <span className="font-mono-tabular text-zinc-200">
                              {status.deviceName}
                            </span>
                          </div>
                          <div className="px-3.5 py-2 flex items-center justify-between">
                            <span className="text-zinc-400">
                              Interfaces IPv4
                            </span>
                            <span className="font-mono-tabular text-zinc-200">
                              {status.localIps.join(", ")}
                            </span>
                          </div>
                          <div className="px-3.5 py-2 flex items-center justify-between">
                            <span className="text-zinc-400">
                              Empreinte du jeton
                            </span>
                            <span className="font-mono-tabular text-indigo-300">
                              {status.pairingToken.slice(0, 10)}…
                              {status.pairingToken.slice(-8)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5 pt-1">
                          <button
                            onClick={handleSimulateDevice}
                            className="h-8 px-3.5 rounded-md bg-indigo-500 hover:bg-indigo-400 text-white font-medium text-[12px] flex items-center gap-2 transition cursor-pointer"
                          >
                            <Smartphone className="w-3.5 h-3.5" />
                            Simuler la liaison (Pixel 8 Pro)
                          </button>

                          <button
                            onClick={handleCopyPairingJson}
                            className="h-8 px-3 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-300 text-[12px] flex items-center gap-1.5 transition cursor-pointer"
                          >
                            {copiedToken ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                Copié
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5 text-zinc-400" />
                                Copier la charge utile JSON
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Tableau de bord matériel de l'appareil connecté */
                  <div className="space-y-4">
                    <div className="rounded-xl bg-[#111319] border border-white/[0.07] p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3.5">
                        <div className="w-11 h-11 rounded-xl bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center text-indigo-400">
                          <Smartphone className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="text-[14px] font-semibold text-zinc-100">
                              {connectedDevice.deviceName}
                            </h2>
                            <span className="text-[10px] font-mono-tabular px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/25">
                              Session active
                            </span>
                          </div>
                          <div className="text-[11px] text-zinc-400 font-mono-tabular mt-0.5">
                            {connectedDevice.model} • Android{" "}
                            {connectedDevice.androidVersion} •{" "}
                            {connectedDevice.ipAddress}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button className="h-8 px-3 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.07] text-[12px] text-zinc-200 flex items-center gap-1.5 transition cursor-pointer">
                          <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
                          Faire sonner
                        </button>
                        <button
                          onClick={() => setActiveSection("input")}
                          className="h-8 px-3 rounded-md bg-indigo-500 hover:bg-indigo-400 text-white text-[12px] font-medium flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <MousePointerClick className="w-3.5 h-3.5" />
                          Configurer le bord d'écran
                        </button>
                      </div>
                    </div>

                    {/* Grille de contrôle rapide */}
                    <div className="grid grid-cols-3 gap-3">
                      <button
                        onClick={() => setActiveSection("input")}
                        className="text-left rounded-xl bg-[#111319] hover:bg-[#151821] border border-white/[0.07] p-3.5 transition cursor-pointer space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] font-medium text-zinc-200">
                            Souris & Clavier
                          </span>
                          <ArrowLeftRight className="w-3.5 h-3.5 text-indigo-400" />
                        </div>
                        <p className="text-[11px] text-zinc-400">
                          Bord actif :{" "}
                          <span className="text-zinc-200 font-mono-tabular">
                            {selectedEdge}
                          </span>{" "}
                          • Canal UDP 120 Hz
                        </p>
                      </button>

                      <button
                        onClick={() => setActiveSection("files")}
                        className="text-left rounded-xl bg-[#111319] hover:bg-[#151821] border border-white/[0.07] p-3.5 transition cursor-pointer space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] font-medium text-zinc-200">
                            Presse-papiers & Fichiers
                          </span>
                          <Clipboard className="w-3.5 h-3.5 text-emerald-400" />
                        </div>
                        <p className="text-[11px] text-zinc-400">
                          Synchronisation bidirectionnelle active
                        </p>
                      </button>

                      <button
                        onClick={() => setActiveSection("mirror")}
                        className="text-left rounded-xl bg-[#111319] hover:bg-[#151821] border border-white/[0.07] p-3.5 transition cursor-pointer space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] font-medium text-zinc-200">
                            Recopie d'écran
                          </span>
                          <MonitorPlay className="w-3.5 h-3.5 text-zinc-400" />
                        </div>
                        <p className="text-[11px] text-zinc-400">
                          Flux direct H.264 sur port {status.httpPort}
                        </p>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeSection === "input" && (
              /* Module de positionnement de l'écran du téléphone par rapport au moniteur PC */
              <div className="space-y-4 max-w-4xl">
                <div className="rounded-xl bg-[#111319] border border-white/[0.07] p-5 space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-[14px] font-semibold text-zinc-100">
                        Topologie d'écran & Passage de la souris (PC ↔ Android)
                      </h2>
                      <p className="text-[12px] text-zinc-400 mt-0.5">
                        Choisis de quel côté de ton écran PC se trouve
                        physiquement ton téléphone pour traverser le bord avec
                        la souris.
                      </p>
                    </div>
                    <span className="text-[11px] font-mono-tabular px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                      UDP : {status.udpPort}
                    </span>
                  </div>

                  {/* Schéma visuel interactif Moniteur PC + Téléphone */}
                  <div className="h-56 rounded-lg bg-[#0b0c10] border border-white/[0.06] flex items-center justify-center relative p-6">
                    <div className="flex items-center gap-6">
                      {/* Emplacement Gauche */}
                      <button
                        onClick={() => setSelectedEdge("LEFT")}
                        className={`w-14 h-28 rounded-lg border flex flex-col items-center justify-center gap-1 transition cursor-pointer ${
                          selectedEdge === "LEFT"
                            ? "bg-indigo-500/20 border-indigo-400 text-indigo-200 shadow-[0_0_20px_rgba(99,102,241,0.2)]"
                            : "bg-white/[0.02] border-dashed border-white/[0.12] text-zinc-500 hover:text-zinc-300"
                        }`}
                      >
                        <Smartphone className="w-4 h-4" />
                        <span className="text-[10px] font-mono-tabular">
                          Gauche
                        </span>
                      </button>

                      {/* Écran principal du PC */}
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-56 h-32 rounded-lg bg-[#151822] border border-white/[0.14] flex flex-col items-center justify-center relative">
                          <Monitor className="w-6 h-6 text-zinc-300 mb-1" />
                          <span className="text-[12px] font-medium text-zinc-200">
                            {status.deviceName}
                          </span>
                          <span className="text-[10px] font-mono-tabular text-zinc-500">
                            Écran principal Windows
                          </span>
                        </div>

                        {/* Emplacement Bas */}
                        <button
                          onClick={() => setSelectedEdge("BOTTOM")}
                          className={`w-28 h-10 rounded-lg border flex items-center justify-center gap-1.5 transition cursor-pointer ${
                            selectedEdge === "BOTTOM"
                              ? "bg-indigo-500/20 border-indigo-400 text-indigo-200 shadow-[0_0_20px_rgba(99,102,241,0.2)]"
                              : "bg-white/[0.02] border-dashed border-white/[0.12] text-zinc-500 hover:text-zinc-300"
                          }`}
                        >
                          <Smartphone className="w-3.5 h-3.5" />
                          <span className="text-[10px] font-mono-tabular">
                            Bas
                          </span>
                        </button>
                      </div>

                      {/* Emplacement Droite */}
                      <button
                        onClick={() => setSelectedEdge("RIGHT")}
                        className={`w-14 h-28 rounded-lg border flex flex-col items-center justify-center gap-1 transition cursor-pointer ${
                          selectedEdge === "RIGHT"
                            ? "bg-indigo-500/20 border-indigo-400 text-indigo-200 shadow-[0_0_20px_rgba(99,102,241,0.2)]"
                            : "bg-white/[0.02] border-dashed border-white/[0.12] text-zinc-500 hover:text-zinc-300"
                        }`}
                      >
                        <Smartphone className="w-4 h-4" />
                        <span className="text-[10px] font-mono-tabular">
                          Droite
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Paramètres anti-franchissement accidentel */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    <div className="rounded-lg bg-[#0d0f14] border border-white/[0.06] p-3.5 flex items-center justify-between">
                      <div>
                        <div className="text-[12px] font-medium text-zinc-200">
                          Résistance au bord de l'écran
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          Empêche la souris de passer sur le téléphone par
                          erreur
                        </div>
                      </div>
                      <select
                        value={edgeResistanceMs}
                        onChange={(e) =>
                          setEdgeResistanceMs(Number(e.target.value))
                        }
                        className="bg-[#161922] border border-white/[0.1] rounded px-2.5 py-1 text-[11px] font-mono-tabular text-zinc-200 outline-none"
                      >
                        <option value={0}>Aucune (0 ms)</option>
                        <option value={120}>Douce (120 ms)</option>
                        <option value={250}>Ferme (250 ms)</option>
                      </select>
                    </div>

                    <div className="rounded-lg bg-[#0d0f14] border border-white/[0.06] p-3.5 flex items-center justify-between">
                      <div>
                        <div className="text-[12px] font-medium text-zinc-200">
                          Exiger le maintien de la touche Ctrl
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          Traverse le bord uniquement si Ctrl est maintenu
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={requireCtrlKey}
                        onChange={(e) => setRequireCtrlKey(e.target.checked)}
                        className="w-4 h-4 accent-indigo-500 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeSection === "notifications" && (
              <div className="rounded-xl bg-[#111319] border border-white/[0.07] p-6 max-w-4xl space-y-2">
                <div className="flex items-center gap-2 text-zinc-200 font-medium text-[13px]">
                  <Bell className="w-4 h-4 text-indigo-400" />
                  Centre de notifications Android (Jalon 3)
                </div>
                <p className="text-[12px] text-zinc-400">
                  Les notifications interceptées par{" "}
                  <code className="font-mono-tabular text-zinc-300">
                    NotificationListenerService
                  </code>{" "}
                  s'afficheront ici avec champ de réponse rapide.
                </p>
              </div>
            )}

            {activeSection === "files" && (
              <div className="rounded-xl bg-[#111319] border border-white/[0.07] p-6 max-w-4xl space-y-2">
                <div className="flex items-center gap-2 text-zinc-200 font-medium text-[13px]">
                  <FileUp className="w-4 h-4 text-emerald-400" />
                  Transfert direct HTTP & Presse-papiers (Jalon 2)
                </div>
                <p className="text-[12px] text-zinc-400">
                  Zone de glisser-déposer de fichiers vers le téléphone et
                  historique du presse-papiers partagé.
                </p>
              </div>
            )}

            {activeSection === "mirror" && (
              <div className="rounded-xl bg-[#111319] border border-white/[0.07] p-6 max-w-4xl space-y-2">
                <div className="flex items-center gap-2 text-zinc-200 font-medium text-[13px]">
                  <MonitorPlay className="w-4 h-4 text-indigo-400" />
                  Recopie d'écran Android (Jalon 5)
                </div>
                <p className="text-[12px] text-zinc-400">
                  Réception du flux matériel{" "}
                  <code className="font-mono-tabular text-zinc-300">
                    MediaProjection
                  </code>{" "}
                  et contrôle direct à la souris dans la fenêtre.
                </p>
              </div>
            )}
          </div>
        </main>

        {/* 3. Panneau Inspecteur Technique ancré à droite */}
        {inspectorOpen && (
          <aside className="w-72 h-full bg-[#0e1015]/95 border-l border-white/[0.065] flex flex-col shrink-0">
            <div className="h-10 px-3.5 border-b border-white/[0.065] flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                Inspecteur Système
              </span>
              <span className="text-[10px] font-mono-tabular text-emerald-400">
                TEMPS RÉEL
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-3.5 space-y-4 text-[11px]">
              {/* État des canaux */}
              <div className="space-y-1.5">
                <div className="text-zinc-500 font-medium">
                  Sockets & Services locaux
                </div>
                <div className="rounded-lg bg-[#13161e] border border-white/[0.06] p-2.5 space-y-2 font-mono-tabular">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400">mDNS Daemon</span>
                    <span className="text-emerald-400">
                      {status.mdnsActive ? "ONLINE" : "INIT"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400">WebSocket</span>
                    <span className="text-zinc-200">0.0.0.0:{status.wsPort}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400">UDP Input</span>
                    <span className="text-zinc-200">
                      0.0.0.0:{status.udpPort}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400">HTTP Stream</span>
                    <span className="text-zinc-200">
                      0.0.0.0:{status.httpPort}
                    </span>
                  </div>
                </div>
              </div>

              {/* Sécurité de session */}
              <div className="space-y-1.5">
                <div className="text-zinc-500 font-medium flex items-center gap-1.5">
                  <KeyRound className="w-3 h-3" />
                  Sécurité & Authentification
                </div>
                <div className="rounded-lg bg-[#13161e] border border-white/[0.06] p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400">ID Hôte</span>
                    <span className="font-mono-tabular text-zinc-300">
                      {status.deviceId.slice(0, 8)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400">Trame UDP</span>
                    <span className="font-mono-tabular text-indigo-300">
                      16 octets (Big-Endian)
                    </span>
                  </div>
                </div>
              </div>

              {/* Charge utile JSON d'appairage */}
              <div className="space-y-1.5">
                <div className="text-zinc-500 font-medium">
                  Payload QR d'appairage
                </div>
                <pre className="rounded-lg bg-[#090a0e] border border-white/[0.06] p-2.5 text-[10px] font-mono-tabular text-zinc-400 overflow-x-auto leading-relaxed">
                  {JSON.stringify(JSON.parse(status.qrRawJson), null, 2)}
                </pre>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* 4. Barre d'état inférieure (Status Bar) */}
      <StatusBar status={status} />

      {/* Palette de commandes rapides (Ctrl+K) */}
      {commandPaletteOpen && (
        <div
          onClick={() => setCommandPaletteOpen(false)}
          className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-start justify-center pt-20 z-50"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-xl bg-[#13151c] border border-white/[0.12] shadow-2xl overflow-hidden"
          >
            <div className="px-3.5 py-2.5 border-b border-white/[0.07] flex items-center justify-between text-[12px] text-zinc-300">
              <span className="flex items-center gap-2 font-medium">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                Commandes rapides NexusLink
              </span>
              <kbd className="text-[10px] font-mono-tabular text-zinc-500">
                Échap
              </kbd>
            </div>
            <div className="p-1.5 space-y-0.5 text-[12px]">
              <button
                onClick={() => {
                  handleSimulateDevice();
                  setCommandPaletteOpen(false);
                }}
                className="w-full px-3 py-2 rounded-lg hover:bg-white/[0.06] flex items-center justify-between text-zinc-200 cursor-pointer"
              >
                <span>Simuler la connexion d'un Pixel 8 Pro</span>
                <span className="text-[10px] font-mono-tabular text-zinc-500">
                  Test
                </span>
              </button>
              <button
                onClick={() => {
                  handleRegenerateToken();
                  setCommandPaletteOpen(false);
                }}
                className="w-full px-3 py-2 rounded-lg hover:bg-white/[0.06] flex items-center justify-between text-zinc-200 cursor-pointer"
              >
                <span>Régénérer la clé et le QR Code d'appairage</span>
                <span className="text-[10px] font-mono-tabular text-zinc-500">
                  Sécurité
                </span>
              </button>
              <button
                onClick={() => {
                  setActiveSection("input");
                  setCommandPaletteOpen(false);
                }}
                className="w-full px-3 py-2 rounded-lg hover:bg-white/[0.06] flex items-center justify-between text-zinc-200 cursor-pointer"
              >
                <span>Configurer le bord d'écran pour la souris</span>
                <span className="text-[10px] font-mono-tabular text-zinc-500">
                  Alt+2
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
