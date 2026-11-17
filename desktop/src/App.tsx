import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowLeftRight,
  Bell,
  Clipboard,
  FileUp,
  Monitor,
  MonitorPlay,
  MousePointerClick,
  QrCode,
  RefreshCw,
  Smartphone,
  Sparkles,
  Volume2,
} from "lucide-react";
import { Sidebar, type NavSectionId } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import type { ClipboardHistoryEntry, ServerStatus } from "./types/protocol";
import "./App.css";

type ScreenEdge = "LEFT" | "RIGHT" | "BOTTOM";

function App() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [activeSection, setActiveSection] = useState<NavSectionId>("overview");
  const [selectedEdge, setSelectedEdge] = useState<ScreenEdge>("RIGHT");
  const [edgeResistanceMs, setEdgeResistanceMs] = useState<number>(120);
  const [requireCtrlKey, setRequireCtrlKey] = useState<boolean>(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false);
  const [isRingingPhone, setIsRingingPhone] = useState<boolean>(false);
  const [clipboardHistory, setClipboardHistory] = useState<ClipboardHistoryEntry[]>([]);

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
      console.error("Impossible de régénérer le QR Code :", error);
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

  const handleRespondToPairing = async (requestId: string, accepted: boolean) => {
    try {
      const updated = await invoke<ServerStatus>("respond_to_pairing_request", {
        requestId,
        accepted,
      });
      setStatus(updated);
    } catch (error) {
      console.error("Erreur lors de la réponse à l'appairage :", error);
    }
  };

  const handleToggleRingPhone = async () => {
    const nextRinging = !isRingingPhone;
    try {
      const sent = await invoke<boolean>("trigger_find_my_phone", {
        ringing: nextRinging,
      });
      if (sent) {
        setIsRingingPhone(nextRinging);
      }
    } catch (error) {
      console.error("Impossible de déclencher la sonnerie :", error);
    }
  };

  useEffect(() => {
    fetchServerStatus();
    invoke<ClipboardHistoryEntry[]>("get_clipboard_history")
      .then(setClipboardHistory)
      .catch(() => {});

    const unlistenPromise = listen<ServerStatus>(
      "nexus://state-updated",
      (event) => {
        setStatus(event.payload);
        if (!event.payload.connectedDevice) {
          setIsRingingPhone(false);
        }
      }
    );

    const unlistenClipboardPromise = listen<ClipboardHistoryEntry[]>(
      "nexus://clipboard-updated",
      (event) => {
        setClipboardHistory(event.payload);
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
      unlistenClipboardPromise.then((unlisten) => unlisten());
    };
  }, []);

  if (!status) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0c0d10] text-zinc-400 text-[12px]">
        <div className="flex items-center gap-2.5">
          <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
          <span>Démarrage de NexusLink…</span>
        </div>
      </div>
    );
  }

  const connectedDevice = status.connectedDevice;

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0c0d10]/90 text-zinc-100 overflow-hidden">
      {/* 1. Barre de titre intégrée */}
      <TitleBar
        status={status}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      />

      {/* 2. Corps de l'application : Sidebar + Zone centrale */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <Sidebar
          activeSection={activeSection}
          onSelectSection={setActiveSection}
          connectedDevice={connectedDevice}
          onDisconnectDevice={handleDisconnectDevice}
        />

        {/* Zone de travail principale */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#0c0d10]/60">
          {/* Barre d'outils supérieure */}
          <div className="h-10 px-5 border-b border-white/[0.065] flex items-center justify-between shrink-0 bg-[#101217]/60">
            <div className="flex items-center gap-2 text-[13px]">
              <span className="text-zinc-400">NexusLink</span>
              <span className="text-zinc-600">/</span>
              <span className="font-medium text-zinc-100">
                {activeSection === "overview" && "Mon téléphone"}
                {activeSection === "input" && "Souris & Clavier"}
                {activeSection === "notifications" && "Notifications"}
                {activeSection === "files" && "Fichiers & Presse-papiers"}
                {activeSection === "mirror" && "Écran du téléphone"}
              </span>
            </div>

            {!connectedDevice && (
              <button
                onClick={handleRegenerateToken}
                className="h-7 px-3 rounded bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.07] flex items-center gap-1.5 text-[12px] text-zinc-300 transition cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 text-zinc-400" />
                Actualiser le QR Code
              </button>
            )}
          </div>

          {/* Contenu du panneau actif */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeSection === "overview" && (
              <div className="space-y-5 max-w-3xl mx-auto">
                {!connectedDevice ? (
                  <div className="rounded-xl bg-[#111319] border border-white/[0.07] overflow-hidden">
                    <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between bg-[#14171f]/60">
                      <div className="flex items-center gap-2">
                        <QrCode className="w-4 h-4 text-indigo-400" />
                        <span className="text-[13px] font-medium text-zinc-100">
                          Associer votre téléphone Android
                        </span>
                      </div>
                      <span className="text-[12px] text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded border border-emerald-500/20">
                        Prêt pour l'association
                      </span>
                    </div>

                    <div className="p-6 grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                      {/* QR Code */}
                      <div className="md:col-span-5 flex flex-col items-center">
                        <div className="p-3.5 rounded-xl bg-white shadow-inner border border-zinc-200">
                          <div
                            className="w-44 h-44 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
                            dangerouslySetInnerHTML={{ __html: status.qrSvg }}
                          />
                        </div>
                        <span className="mt-2.5 text-[12px] text-zinc-500">
                          Connexion directe sans passer par Internet
                        </span>
                      </div>

                      {/* Instructions simples */}
                      <div className="md:col-span-7 space-y-4">
                        <div>
                          <h2 className="text-[17px] font-semibold text-zinc-100">
                            Connectez votre smartphone en un scan
                          </h2>
                          <p className="text-[13px] text-zinc-400 mt-1.5 leading-relaxed">
                            Ouvrez l'application <strong>NexusLink</strong> sur
                            votre téléphone Android et assurez-vous qu'il est
                            connecté au même réseau Wi-Fi que cet ordinateur.
                          </p>
                        </div>

                        <div className="rounded-lg bg-[#0c0d11] border border-white/[0.06] p-4 space-y-2 text-[13px] text-zinc-300">
                          <div>1. Ouvrez NexusLink sur votre téléphone</div>
                          <div>
                            2. Appuyez sur <strong>Scanner le QR Code</strong>
                          </div>
                          <div>3. Visez ce code avec votre caméra</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Tableau de bord de l'appareil connecté */
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
                            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/25">
                              Connecté
                            </span>
                          </div>
                          <div className="text-[11px] text-zinc-400 mt-0.5">
                            {connectedDevice.model} • Android{" "}
                            {connectedDevice.androidVersion} • Batterie{" "}
                            {connectedDevice.batteryLevel}%
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleToggleRingPhone}
                          className={`h-8 px-3 rounded-md border text-[12px] flex items-center gap-1.5 transition cursor-pointer ${
                            isRingingPhone
                              ? "bg-amber-500/20 hover:bg-amber-500/30 border-amber-400/40 text-amber-200"
                              : "bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.07] text-zinc-200"
                          }`}
                        >
                          <Volume2
                            className={`w-3.5 h-3.5 ${
                              isRingingPhone ? "text-amber-300 animate-pulse" : "text-indigo-400"
                            }`}
                          />
                          {isRingingPhone ? "Arrêter la sonnerie" : "Faire sonner"}
                        </button>
                        <button
                          onClick={() => setActiveSection("input")}
                          className="h-8 px-3 rounded-md bg-indigo-500 hover:bg-indigo-400 text-white text-[12px] font-medium flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <MousePointerClick className="w-3.5 h-3.5" />
                          Position du téléphone
                        </button>
                      </div>
                    </div>

                    {/* Raccourcis vers les fonctionnalités */}
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
                          Glissez la souris vers votre téléphone pour le contrôler
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
                          Partagez textes, photos et fichiers en un instant
                        </p>
                      </button>

                      <button
                        onClick={() => setActiveSection("mirror")}
                        className="text-left rounded-xl bg-[#111319] hover:bg-[#151821] border border-white/[0.07] p-3.5 transition cursor-pointer space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] font-medium text-zinc-200">
                            Écran du téléphone
                          </span>
                          <MonitorPlay className="w-3.5 h-3.5 text-zinc-400" />
                        </div>
                        <p className="text-[11px] text-zinc-400">
                          Affichez et utilisez votre téléphone sur votre PC
                        </p>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeSection === "input" && (
              <div className="space-y-4 max-w-3xl mx-auto">
                <div className="rounded-xl bg-[#111319] border border-white/[0.07] p-5 space-y-5">
                  <div>
                    <h2 className="text-[14px] font-semibold text-zinc-100">
                      Position du téléphone par rapport à votre écran
                    </h2>
                    <p className="text-[12px] text-zinc-400 mt-0.5">
                      Indiquez de quel côté est posé votre téléphone pour y
                      faire glisser votre souris naturellement.
                    </p>
                  </div>

                  {/* Schéma visuel interactif Moniteur PC + Téléphone */}
                  <div className="h-56 rounded-lg bg-[#0b0c10] border border-white/[0.06] flex items-center justify-center relative p-6">
                    <div className="flex items-center gap-6">
                      <button
                        onClick={() => setSelectedEdge("LEFT")}
                        className={`w-14 h-28 rounded-lg border flex flex-col items-center justify-center gap-1 transition cursor-pointer ${
                          selectedEdge === "LEFT"
                            ? "bg-indigo-500/20 border-indigo-400 text-indigo-200 shadow-[0_0_20px_rgba(99,102,241,0.2)]"
                            : "bg-white/[0.02] border-dashed border-white/[0.12] text-zinc-500 hover:text-zinc-300"
                        }`}
                      >
                        <Smartphone className="w-4 h-4" />
                        <span className="text-[10px]">Gauche</span>
                      </button>

                      <div className="flex flex-col items-center gap-3">
                        <div className="w-56 h-32 rounded-lg bg-[#151822] border border-white/[0.14] flex flex-col items-center justify-center relative">
                          <Monitor className="w-6 h-6 text-zinc-300 mb-1" />
                          <span className="text-[12px] font-medium text-zinc-200">
                            {status.deviceName}
                          </span>
                          <span className="text-[10px] text-zinc-500">
                            Écran de l'ordinateur
                          </span>
                        </div>

                        <button
                          onClick={() => setSelectedEdge("BOTTOM")}
                          className={`w-28 h-10 rounded-lg border flex items-center justify-center gap-1.5 transition cursor-pointer ${
                            selectedEdge === "BOTTOM"
                              ? "bg-indigo-500/20 border-indigo-400 text-indigo-200 shadow-[0_0_20px_rgba(99,102,241,0.2)]"
                              : "bg-white/[0.02] border-dashed border-white/[0.12] text-zinc-500 hover:text-zinc-300"
                          }`}
                        >
                          <Smartphone className="w-3.5 h-3.5" />
                          <span className="text-[10px]">Bas</span>
                        </button>
                      </div>

                      <button
                        onClick={() => setSelectedEdge("RIGHT")}
                        className={`w-14 h-28 rounded-lg border flex flex-col items-center justify-center gap-1 transition cursor-pointer ${
                          selectedEdge === "RIGHT"
                            ? "bg-indigo-500/20 border-indigo-400 text-indigo-200 shadow-[0_0_20px_rgba(99,102,241,0.2)]"
                            : "bg-white/[0.02] border-dashed border-white/[0.12] text-zinc-500 hover:text-zinc-300"
                        }`}
                      >
                        <Smartphone className="w-4 h-4" />
                        <span className="text-[10px]">Droite</span>
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
                          Évite de passer sur le téléphone par erreur
                        </div>
                      </div>
                      <select
                        value={edgeResistanceMs}
                        onChange={(e) =>
                          setEdgeResistanceMs(Number(e.target.value))
                        }
                        className="bg-[#161922] border border-white/[0.1] rounded px-2.5 py-1 text-[11px] text-zinc-200 outline-none"
                      >
                        <option value={0}>Aucune</option>
                        <option value={120}>Douce</option>
                        <option value={250}>Ferme</option>
                      </select>
                    </div>

                    <div className="rounded-lg bg-[#0d0f14] border border-white/[0.06] p-3.5 flex items-center justify-between">
                      <div>
                        <div className="text-[12px] font-medium text-zinc-200">
                          Maintenir la touche Ctrl
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          Passe sur le téléphone uniquement avec Ctrl
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
              <div className="rounded-xl bg-[#111319] border border-white/[0.07] p-6 max-w-3xl mx-auto space-y-2">
                <div className="flex items-center gap-2 text-zinc-200 font-medium text-[13px]">
                  <Bell className="w-4 h-4 text-indigo-400" />
                  Notifications du téléphone
                </div>
                <p className="text-[12px] text-zinc-400">
                  Vos notifications et messages Android apparaîtront ici avec la
                  possibilité d'y répondre directement depuis votre clavier.
                </p>
              </div>
            )}

            {activeSection === "files" && (
              <div className="space-y-4 max-w-3xl mx-auto">
                {/* Presse-papiers partagé */}
                <div className="rounded-xl bg-[#111319] border border-white/[0.07] p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-zinc-200 font-medium text-[14px]">
                      <Clipboard className="w-4 h-4 text-emerald-400" />
                      Presse-papiers partagé
                    </div>
                    <span className="text-[11px] text-zinc-400">
                      Synchronisation automatique PC ↔ Téléphone
                    </span>
                  </div>

                  {clipboardHistory.length > 0 ? (
                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                      {clipboardHistory.map((entry, idx) => (
                        <div
                          key={`${entry.timestamp}-${idx}`}
                          className="rounded-lg bg-[#0c0d12] border border-white/[0.06] px-3.5 py-2.5 flex items-start justify-between gap-3"
                        >
                          <p className="text-[12px] text-zinc-200 break-all line-clamp-2">
                            {entry.content}
                          </p>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-white/[0.05] text-zinc-400 shrink-0">
                            {entry.source}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[12px] text-zinc-500">
                      Aucun texte synchronisé pour le moment. Copiez un texte avec Ctrl+C lorsque votre téléphone est connecté.
                    </p>
                  )}
                </div>

                {/* Zone Transfert de fichiers (Étape 3.3) */}
                <div className="rounded-xl bg-[#111319] border border-white/[0.07] p-5 space-y-2">
                  <div className="flex items-center gap-2 text-zinc-200 font-medium text-[14px]">
                    <FileUp className="w-4 h-4 text-indigo-400" />
                    Transfert de fichiers
                  </div>
                  <p className="text-[12px] text-zinc-400">
                    Le glisser-déposer de photos et documents vers votre téléphone sera disponible à l'étape suivante.
                  </p>
                </div>
              </div>
            )}

            {activeSection === "mirror" && (
              <div className="rounded-xl bg-[#111319] border border-white/[0.07] p-6 max-w-3xl mx-auto space-y-2">
                <div className="flex items-center gap-2 text-zinc-200 font-medium text-[13px]">
                  <MonitorPlay className="w-4 h-4 text-indigo-400" />
                  Écran du téléphone
                </div>
                <p className="text-[12px] text-zinc-400">
                  Affichez l'écran de votre téléphone en direct dans cette
                  fenêtre et contrôlez vos applications à la souris.
                </p>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* 3. Barre d'état inférieure */}
      <StatusBar status={status} />

      {/* Boîte de confirmation d'association manuelle (sans QR Code) */}
      {status.pendingPairing && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#13151d] border border-white/[0.12] shadow-2xl p-6 space-y-5">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-indigo-500/15 border border-indigo-400/30 flex items-center justify-center text-indigo-400 shrink-0">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-[16px] font-semibold text-zinc-100">
                  Demande de connexion
                </h3>
                <p className="text-[13px] text-zinc-400">
                  <strong>{status.pendingPairing.deviceName}</strong> souhaite se
                  connecter à cet ordinateur.
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-[#0c0d12] border border-white/[0.08] p-4 text-center space-y-1.5">
              <div className="text-[12px] text-zinc-400">
                Vérifiez que ce code correspond à celui affiché sur votre téléphone
              </div>
              <div className="text-3xl font-bold tracking-[0.28em] font-mono-tabular text-indigo-300 py-1">
                {status.pendingPairing.verificationCode}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5">
              <button
                onClick={() =>
                  handleRespondToPairing(status.pendingPairing!.requestId, false)
                }
                className="h-9 px-4 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[13px] text-zinc-300 transition cursor-pointer"
              >
                Refuser
              </button>
              <button
                onClick={() =>
                  handleRespondToPairing(status.pendingPairing!.requestId, true)
                }
                className="h-9 px-4 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-[13px] font-medium text-white transition cursor-pointer"
              >
                Accepter
              </button>
            </div>
          </div>
        </div>
      )}

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
                Actions rapides NexusLink
              </span>
              <kbd className="text-[10px] font-mono-tabular text-zinc-500">
                Échap
              </kbd>
            </div>
            <div className="p-1.5 space-y-0.5 text-[12px]">
              <button
                onClick={() => {
                  handleRegenerateToken();
                  setCommandPaletteOpen(false);
                }}
                className="w-full px-3 py-2 rounded-lg hover:bg-white/[0.06] flex items-center justify-between text-zinc-200 cursor-pointer"
              >
                <span>Générer un nouveau QR Code d'association</span>
              </button>
              <button
                onClick={() => {
                  setActiveSection("input");
                  setCommandPaletteOpen(false);
                }}
                className="w-full px-3 py-2 rounded-lg hover:bg-white/[0.06] flex items-center justify-between text-zinc-200 cursor-pointer"
              >
                <span>Configurer la position du téléphone</span>
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
