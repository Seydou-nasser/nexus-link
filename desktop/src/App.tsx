import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  Clipboard,
  FileUp,
  FolderOpen,
  FolderSync,
  HardDrive,
  Images,
  Monitor,
  MoreHorizontal,
  MousePointerClick,
  QrCode,
  RefreshCw,
  Send,
  Settings,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { FileExplorerPanel } from "./components/FileExplorerPanel";
import { GalleryPanel } from "./components/GalleryPanel";
import { PhoneSidebar } from "./components/PhoneSidebar";
import { SettingsPanel } from "./components/SettingsPanel";
import { TitleBar } from "./components/TitleBar";
import type {
  ClipboardHistoryEntry,
  FileTransferRecord,
  PhoneNotificationRecord,
  ServerStatus,
} from "./types/protocol";
import "./App.css";

type ScreenEdge = "LEFT" | "RIGHT" | "BOTTOM";
type TopTabId =
  | "gallery"
  | "explorer"
  | "files"
  | "clipboard"
  | "input"
  | "settings";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

function App() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [activeTab, setActiveTab] = useState<TopTabId>("files");
  const [selectedEdge, setSelectedEdge] = useState<ScreenEdge>("RIGHT");
  const [edgeResistanceMs, setEdgeResistanceMs] = useState<number>(120);
  const [requireCtrlKey, setRequireCtrlKey] = useState<boolean>(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] =
    useState<boolean>(false);
  const [isRingingPhone, setIsRingingPhone] = useState<boolean>(false);
  const [clipboardHistory, setClipboardHistory] = useState<
    ClipboardHistoryEntry[]
  >([]);
  const [clipboardDraft, setClipboardDraft] = useState<string>("");
  const [fileTransfers, setFileTransfers] = useState<FileTransferRecord[]>([]);
  const [notifications, setNotifications] = useState<PhoneNotificationRecord[]>(
    [],
  );
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);

  const activeTabRef = useRef<TopTabId>(activeTab);
  activeTabRef.current = activeTab;
  const explorerDropHandlerRef = useRef<
    ((paths: string[]) => Promise<void>) | null
  >(null);

  const handleRegisterExplorerDrop = useCallback(
    (handler: ((paths: string[]) => Promise<void>) | null) => {
      explorerDropHandlerRef.current = handler;
    },
    [],
  );

  const fetchServerStatus = async () => {
    try {
      const currentStatus = await invoke<ServerStatus>("get_server_status");
      setStatus(currentStatus);
      if (currentStatus.inputSettings) {
        setSelectedEdge(currentStatus.inputSettings.edge);
        setEdgeResistanceMs(currentStatus.inputSettings.edgeResistanceMs);
        setRequireCtrlKey(currentStatus.inputSettings.requireCtrl);
      }
    } catch (error) {
      console.error("Erreur lors de la récupération du statut :", error);
    }
  };

  const syncInputSettings = async (
    edge: ScreenEdge,
    resistanceMs: number,
    requireCtrl: boolean,
  ) => {
    try {
      const updated = await invoke<ServerStatus>("update_input_settings", {
        settings: {
          enabled: true,
          edge,
          edgeResistanceMs: resistanceMs,
          requireCtrl,
        },
      });
      setStatus(updated);
    } catch (error) {
      console.error(
        "Impossible de mettre à jour les paramètres d'entrée :",
        error,
      );
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

  const handleRespondToPairing = async (
    requestId: string,
    accepted: boolean,
  ) => {
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

  const handleReplyNotification = async (
    notificationKey: string,
    replyText: string,
  ): Promise<boolean> => {
    try {
      return await invoke<boolean>("reply_to_notification", {
        notificationKey,
        replyText,
      });
    } catch (error) {
      console.error("Impossible d'envoyer la réponse :", error);
      return false;
    }
  };

  const handleDismissNotification = async (notificationKey: string) => {
    try {
      await invoke<boolean>("dismiss_notification", { notificationKey });
    } catch (error) {
      console.error("Impossible de fermer la notification :", error);
    }
  };

  const handleDismissAllNotifications = async () => {
    try {
      await invoke<number>("dismiss_all_notifications");
    } catch (error) {
      console.error("Impossible d'effacer les notifications :", error);
    }
  };

  const handleOpenMirror = async () => {
    if (!status?.connectedDevice) return;
    try {
      if (
        status.mirrorState === "ACTIVE" ||
        status.mirrorState === "WAITING_PERMISSION"
      ) {
        await invoke("focus_mirror_window");
      } else {
        await invoke<boolean>("start_screen_mirror");
      }
    } catch (error) {
      console.error("Impossible d'ouvrir l'écran du téléphone :", error);
    }
  };

  const handleSendClipboardDraft = async () => {
    const trimmed = clipboardDraft.trim();
    if (!trimmed) return;
    try {
      const ok = await invoke<boolean>("send_clipboard_to_phone", {
        content: trimmed,
      });
      if (ok) {
        setClipboardDraft("");
      }
    } catch (error) {
      console.error("Impossible d'envoyer le texte :", error);
    }
  };

  useEffect(() => {
    fetchServerStatus();
    invoke<ClipboardHistoryEntry[]>("get_clipboard_history")
      .then(setClipboardHistory)
      .catch(() => {});
    invoke<FileTransferRecord[]>("get_file_transfers")
      .then(setFileTransfers)
      .catch(() => {});
    invoke<PhoneNotificationRecord[]>("get_notifications")
      .then(setNotifications)
      .catch(() => {});

    const unlistenPromise = listen<ServerStatus>(
      "nexus://state-updated",
      (event) => {
        setStatus(event.payload);
        if (!event.payload.connectedDevice) {
          setIsRingingPhone(false);
        }
      },
    );

    const unlistenClipboardPromise = listen<ClipboardHistoryEntry[]>(
      "nexus://clipboard-updated",
      (event) => {
        setClipboardHistory(event.payload);
      },
    );

    const unlistenFilesPromise = listen<FileTransferRecord[]>(
      "nexus://files-updated",
      (event) => {
        setFileTransfers(event.payload);
      },
    );

    const unlistenNotificationsPromise = listen<PhoneNotificationRecord[]>(
      "nexus://notifications-updated",
      (event) => {
        setNotifications(event.payload);
      },
    );

    const unlistenDragDropPromise = getCurrentWebview().onDragDropEvent(
      (event) => {
        if (event.payload.type === "over" || event.payload.type === "enter") {
          setIsDraggingFile(true);
        } else if (event.payload.type === "leave") {
          setIsDraggingFile(false);
        } else if (event.payload.type === "drop") {
          setIsDraggingFile(false);
          if (event.payload.paths.length > 0) {
            if (
              activeTabRef.current === "explorer" &&
              explorerDropHandlerRef.current
            ) {
              explorerDropHandlerRef
                .current(event.payload.paths)
                .catch((err) =>
                  console.error("Erreur upload explorateur :", err),
                );
            } else {
              invoke("send_files_to_phone", {
                paths: event.payload.paths,
              }).catch((err) => console.error("Erreur lors de l'envoi :", err));
            }
          }
        }
      },
    );

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      } else if (event.altKey && event.key === "1") {
        setActiveTab("gallery");
      } else if (event.altKey && event.key === "2") {
        setActiveTab("explorer");
      } else if (event.altKey && event.key === "3") {
        setActiveTab("files");
      } else if (event.altKey && event.key === "4") {
        setActiveTab("clipboard");
      } else if (event.altKey && event.key === "5") {
        setActiveTab("input");
      } else if (event.key === "Escape") {
        setCommandPaletteOpen(false);
        setDisconnectConfirmOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      unlistenPromise.then((unlisten) => unlisten());
      unlistenClipboardPromise.then((unlisten) => unlisten());
      unlistenFilesPromise.then((unlisten) => unlisten());
      unlistenNotificationsPromise.then((unlisten) => unlisten());
      unlistenDragDropPromise.then((unlisten) => unlisten());
    };
  }, []);

  if (!status) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#14171c] text-[#b0cadc] text-[12px]">
        <div className="flex items-center gap-2.5">
          <RefreshCw className="w-4 h-4 animate-spin text-[#87CFF9]" />
          <span>Démarrage de NexusLink…</span>
        </div>
      </div>
    );
  }

  const connectedDevice = status.connectedDevice;

  const topTabs: {
    id: TopTabId;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: "gallery", label: "Galerie", icon: Images },
    { id: "explorer", label: "Explorateur", icon: HardDrive },
    { id: "files", label: "Transferts", icon: FolderSync },
    { id: "clipboard", label: "Presse-papiers", icon: Clipboard },
    { id: "input", label: "Souris & Clavier", icon: MousePointerClick },
  ];

  return (
    <div className="h-screen w-screen flex flex-col bg-[#14171c]/95 text-[#f2f5f8] overflow-hidden">
      {/* 1. Barre de titre épurée */}
      <TitleBar />

      {/* 2. Corps principal : Colonne gauche permanente + Zone droite à onglets */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <PhoneSidebar
          status={status}
          connectedDevice={connectedDevice}
          notifications={notifications}
          isRingingPhone={isRingingPhone}
          onOpenMirror={handleOpenMirror}
          onToggleRingPhone={handleToggleRingPhone}
          onPickFiles={() => invoke("pick_and_send_files")}
          onRequestDisconnect={() => setDisconnectConfirmOpen(true)}
          onRefreshStatus={fetchServerStatus}
          onReplyNotification={handleReplyNotification}
          onDismissNotification={handleDismissNotification}
          onDismissAllNotifications={handleDismissAllNotifications}
        />

        {/* Zone principale à droite */}
        <div className="flex-1 flex flex-col min-w-0 pr-2 pb-2">
          {/* Barre d'onglets horizontaux (style Mobile connecté) */}
          <nav className="h-11 px-2 flex items-center justify-between shrink-0 select-none">
            <div className="flex items-center gap-1">
              {topTabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`relative h-9 px-3.5 rounded-lg flex items-center gap-2 text-[13px] transition cursor-pointer ${
                      isActive
                        ? "text-[#f2f5f8] font-medium bg-white/[0.06]"
                        : "text-[#9cb1c2] hover:text-[#f2f5f8] hover:bg-white/[0.04]"
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 ${
                        isActive ? "text-[#87CFF9]" : "text-[#788896]"
                      }`}
                    />
                    <span>{tab.label}</span>
                    {isActive && (
                      <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-6 h-[2.5px] rounded-full bg-[#87CFF9]" />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCommandPaletteOpen(true)}
                title="Actions rapides (Ctrl+K)"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#9cb1c2] hover:text-[#f2f5f8] hover:bg-white/[0.06] transition cursor-pointer"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() =>
                  setActiveTab(activeTab === "settings" ? "files" : "settings")
                }
                title="Paramètres"
                className={`relative w-8 h-8 rounded-lg flex items-center justify-center transition cursor-pointer ${
                  activeTab === "settings"
                    ? "bg-white/[0.09] text-[#87CFF9]"
                    : "text-[#9cb1c2] hover:text-[#f2f5f8] hover:bg-white/[0.06]"
                }`}
              >
                <Settings className="w-4 h-4" />
                {activeTab === "settings" && (
                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-4 h-[2.5px] rounded-full bg-[#87CFF9]" />
                )}
              </button>
            </div>
          </nav>

          {/* Grand panneau arrondi Fluent */}
          <main className="flex-1 min-h-0 rounded-2xl bg-[#1b2028]/95 border border-white/[0.07] overflow-y-auto p-6">
            {/* Si aucun appareil connecté (hors vue Paramètres) : écran d'association QR Code */}
            {!connectedDevice && activeTab !== "settings" ? (
              <div className="h-full flex items-center justify-center">
                <div className="w-full max-w-2xl rounded-2xl bg-[#232934]/80 border border-white/[0.08] p-6 space-y-5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[#005C7D]/70 border border-[#87CFF9]/30 flex items-center justify-center text-[#87CFF9]">
                        <QrCode className="w-5 h-5" />
                      </div>
                      <div>
                        <h2 className="text-[15px] font-semibold text-[#f2f5f8]">
                          Associer votre téléphone Android
                        </h2>
                        <p className="text-[12px] text-[#b0cadc]">
                          Scannez ce QR Code ou sélectionnez{" "}
                          <strong className="text-[#f2f5f8]">
                            {status.deviceName}
                          </strong>{" "}
                          sur votre téléphone.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleRegenerateToken}
                      className="h-8 px-3 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] flex items-center gap-1.5 text-[12px] text-[#d6e4ee] transition cursor-pointer shrink-0"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-[#87CFF9]" />
                      Actualiser
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6 items-center">
                    <div
                      className="w-[220px] h-[220px] rounded-2xl bg-white p-3.5 flex items-center justify-center mx-auto shadow-xl"
                      dangerouslySetInnerHTML={{ __html: status.qrSvg }}
                    />

                    <div className="space-y-3 text-[13px] text-[#c7d6e2]">
                      <div className="flex items-start gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-[#005C7D] text-[#87CFF9] text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">
                          1
                        </span>
                        <span>
                          Connectez votre téléphone au{" "}
                          <strong className="text-[#f2f5f8]">
                            même réseau Wi-Fi
                          </strong>{" "}
                          que cet ordinateur.
                        </span>
                      </div>
                      <div className="flex items-start gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-[#005C7D] text-[#87CFF9] text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">
                          2
                        </span>
                        <span>
                          Ouvrez{" "}
                          <strong className="text-[#f2f5f8]">NexusLink</strong>{" "}
                          sur Android et appuyez sur{" "}
                          <strong className="text-[#f2f5f8]">
                            Scanner QR
                          </strong>{" "}
                          ou choisissez ce PC dans la liste.
                        </span>
                      </div>
                      <div className="flex items-start gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-[#005C7D] text-[#87CFF9] text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">
                          3
                        </span>
                        <span>
                          Toutes vos données restent{" "}
                          <strong className="text-[#87CFF9]">
                            100 % en local
                          </strong>{" "}
                          sans aucun passage par Internet.
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Onglet Galerie (Photos, Vidéos & Dossiers du téléphone) */}
                {activeTab === "gallery" && (
                  <GalleryPanel
                    httpPort={status.httpPort}
                    deviceId={connectedDevice?.deviceId ?? null}
                  />
                )}

                {/* Onglet Explorateur de fichiers Android */}
                {activeTab === "explorer" && (
                  <FileExplorerPanel
                    deviceId={connectedDevice?.deviceId ?? null}
                    isDraggingFile={isDraggingFile}
                    onRegisterDropHandler={handleRegisterExplorerDrop}
                  />
                )}

                {/* Onglet Transferts */}
                {activeTab === "files" && (
                  <div className="h-full flex flex-col gap-5">
                    <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
                      <div>
                        <h2 className="text-[16px] font-semibold text-[#f2f5f8]">
                          Transferts de fichiers
                        </h2>
                        <p className="text-[12px] text-[#b0cadc]">
                          Envoyez et recevez des photos, vidéos ou documents
                          instantanément sur le Wi-Fi local.
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => invoke("open_downloads_folder")}
                          className="h-8 px-3 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[12px] text-[#d6e4ee] flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <FolderOpen className="w-3.5 h-3.5 text-[#87CFF9]" />
                          Dossier reçu
                        </button>
                        <button
                          type="button"
                          onClick={() => invoke("pick_and_send_files")}
                          disabled={!connectedDevice}
                          className="h-8 px-3.5 rounded-lg bg-[#005C7D] hover:bg-[#00719a] disabled:opacity-40 text-[#f2f5f8] text-[12px] font-medium flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <FileUp className="w-3.5 h-3.5 text-[#87CFF9]" />
                          Envoyer des fichiers
                        </button>
                      </div>
                    </div>

                    {/* Zone glisser-déposer agrandie et cliquable */}
                    <button
                      type="button"
                      onClick={() => invoke("pick_and_send_files")}
                      disabled={!connectedDevice}
                      className={`w-full min-h-[200px] shrink-0 rounded-2xl border-2 border-dashed px-6 py-10 flex flex-col items-center justify-center gap-3 text-center transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                        isDraggingFile
                          ? "border-[#87CFF9] bg-[#005C7D]/25 text-[#f2f5f8] shadow-[0_0_24px_rgba(135,207,249,0.16)]"
                          : "border-white/[0.12] bg-[#14171c]/65 hover:border-[#87CFF9]/50 hover:bg-[#14171c]/90 text-[#b0cadc]"
                      }`}
                    >
                      <div
                        className={`w-12 h-12 rounded-2xl border flex items-center justify-center transition ${
                          isDraggingFile
                            ? "bg-[#005C7D]/70 border-[#87CFF9]/60 text-[#f2f5f8] scale-105"
                            : "bg-[#005C7D]/40 border-[#87CFF9]/25 text-[#87CFF9]"
                        }`}
                      >
                        <FileUp className="w-6 h-6" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-[14px] font-medium text-[#f2f5f8]">
                          Glissez-déposez vos fichiers ici
                        </p>
                        <p className="text-[12.5px] text-[#b0cadc]">
                          ou cliquez pour parcourir et envoyer vers{" "}
                          <strong className="text-[#87CFF9]">
                            {connectedDevice?.deviceName}
                          </strong>
                        </p>
                      </div>
                    </button>

                    {/* Liste des transferts récents */}
                    <div className="flex-1 min-h-0 flex flex-col gap-2.5">
                      <div className="flex items-center justify-between shrink-0">
                        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[#b0cadc]">
                          Transferts récents
                        </h3>
                        {fileTransfers.length > 0 && (
                          <span className="text-[11px] text-[#788896]">
                            {fileTransfers.length} élément
                            {fileTransfers.length > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>

                      {fileTransfers.length === 0 ? (
                        <div className="flex-1 min-h-[140px] rounded-2xl bg-[#232934]/50 border border-white/[0.06] flex items-center justify-center p-8 text-center text-[13px] text-[#788896]">
                          Aucun transfert récent pour le moment.
                        </div>
                      ) : (
                        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 content-start pr-1">
                          {fileTransfers.map((item) => {
                            const canOpen = Boolean(
                              item.savedPath && item.status === "COMPLETED",
                            );
                            const isPending = item.status === "PENDING";
                            const transferred = item.bytesTransferred ?? 0;
                            const progressPct =
                              item.fileSize > 0
                                ? Math.min(
                                    100,
                                    Math.round(
                                      (transferred / item.fileSize) * 100,
                                    ),
                                  )
                                : 0;
                            return (
                              <div
                                key={item.fileId}
                                onClick={() => {
                                  if (canOpen && item.savedPath) {
                                    invoke("open_local_file", {
                                      path: item.savedPath,
                                    });
                                  }
                                }}
                                className={`rounded-xl bg-[#232934]/75 border border-white/[0.07] p-3 flex flex-col gap-2 ${
                                  canOpen
                                    ? "hover:border-[#87CFF9]/40 hover:bg-[#232934] cursor-pointer transition"
                                    : ""
                                }`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-3 min-w-0">
                                    {item.thumbnailBase64 ? (
                                      <img
                                        src={`data:image/jpeg;base64,${item.thumbnailBase64}`}
                                        alt={item.fileName}
                                        className="w-11 h-11 rounded-lg object-cover shrink-0 border border-white/[0.1]"
                                      />
                                    ) : (
                                      <div className="w-11 h-11 rounded-lg bg-[#005C7D]/40 border border-[#87CFF9]/20 flex items-center justify-center shrink-0">
                                        <FileUp className="w-4 h-4 text-[#87CFF9]" />
                                      </div>
                                    )}
                                    <div className="min-w-0">
                                      <div className="text-[13px] font-medium text-[#f2f5f8] truncate">
                                        {item.fileName}
                                      </div>
                                      <div className="text-[11px] text-[#788896]">
                                        {item.direction === "SENT"
                                          ? "Envoyé"
                                          : "Reçu"}{" "}
                                        •{" "}
                                        {isPending && item.fileSize > 0
                                          ? `${formatFileSize(transferred)} / ${formatFileSize(item.fileSize)}`
                                          : formatFileSize(item.fileSize)}{" "}
                                        • {item.timestamp.replace(" UTC", "")}
                                      </div>
                                    </div>
                                  </div>

                                  <span
                                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 font-mono-tabular ${
                                      item.status === "COMPLETED"
                                        ? "bg-emerald-500/15 text-emerald-300"
                                        : item.status === "FAILED"
                                          ? "bg-rose-500/15 text-rose-300"
                                          : "bg-[#005C7D]/60 text-[#87CFF9]"
                                    }`}
                                  >
                                    {item.status === "COMPLETED"
                                      ? "Terminé"
                                      : item.status === "FAILED"
                                        ? "Échec"
                                        : item.fileSize > 0
                                          ? `${progressPct}%`
                                          : "En cours"}
                                  </span>
                                </div>

                                {isPending && (
                                  <div className="h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
                                    <div
                                      className="h-full rounded-full bg-[#87CFF9] transition-all duration-150"
                                      style={{
                                        width: `${item.fileSize > 0 ? progressPct : 35}%`,
                                      }}
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Onglet Presse-papiers */}
                {activeTab === "clipboard" && (
                  <div className="space-y-5 max-w-3xl mx-auto">
                    <div>
                      <h2 className="text-[16px] font-semibold text-[#f2f5f8]">
                        Presse-papiers partagé
                      </h2>
                      <p className="text-[12px] text-[#b0cadc]">
                        Tout texte ou capture d&apos;écran copié est synchronisé
                        automatiquement entre votre PC et votre téléphone.
                      </p>
                    </div>

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleSendClipboardDraft();
                      }}
                      className="flex items-center gap-2"
                    >
                      <input
                        type="text"
                        value={clipboardDraft}
                        onChange={(e) => setClipboardDraft(e.target.value)}
                        placeholder="Envoyer un texte directement dans le presse-papiers du téléphone…"
                        className="flex-1 h-9 px-3.5 rounded-lg bg-[#14171c] border border-white/[0.09] text-[12.5px] text-[#f2f5f8] placeholder:text-[#788896] focus:outline-none focus:border-[#87CFF9]/60"
                      />
                      <button
                        type="submit"
                        disabled={!clipboardDraft.trim()}
                        className="h-9 px-3.5 rounded-lg bg-[#005C7D] hover:bg-[#00719a] disabled:opacity-40 text-[#f2f5f8] text-[12px] font-medium flex items-center gap-1.5 transition cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5 text-[#87CFF9]" />
                        Envoyer
                      </button>
                    </form>

                    {clipboardHistory.length === 0 ? (
                      <div className="rounded-xl bg-[#232934]/50 border border-white/[0.06] p-8 text-center text-[12px] text-[#788896]">
                        Aucun élément synchronisé pour le moment. Essayez un
                        Ctrl+C !
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {clipboardHistory.map((entry, idx) => (
                          <div
                            key={`${entry.timestamp}-${idx}`}
                            className="rounded-xl bg-[#232934]/75 border border-white/[0.07] px-4 py-3 flex items-start justify-between gap-3"
                          >
                            <p className="text-[12.5px] text-[#f2f5f8] break-all whitespace-pre-wrap line-clamp-3">
                              {entry.content}
                            </p>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#005C7D]/60 text-[#87CFF9] font-medium">
                                {entry.source}
                              </span>
                              <span className="text-[10px] font-mono-tabular text-[#788896]">
                                {entry.timestamp.replace(" UTC", "")}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Onglet Souris & Clavier */}
                {activeTab === "input" && (
                  <div className="space-y-5 max-w-3xl mx-auto">
                    <div>
                      <h2 className="text-[16px] font-semibold text-[#f2f5f8]">
                        Souris &amp; Clavier partagés
                      </h2>
                      <p className="text-[12px] text-[#b0cadc]">
                        Indiquez de quel côté est posé votre téléphone pour y
                        faire glisser naturellement votre souris (appuyez sur{" "}
                        <kbd className="px-1.5 py-0.5 rounded bg-white/[0.08] text-[#87CFF9] text-[11px]">
                          Échap
                        </kbd>{" "}
                        pour revenir immédiatement sur le PC).
                      </p>
                    </div>

                    {/* Schéma visuel interactif */}
                    <div className="h-56 rounded-2xl bg-[#14171c] border border-white/[0.07] flex items-center justify-center p-6">
                      <div className="flex items-center gap-6">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedEdge("LEFT");
                            syncInputSettings(
                              "LEFT",
                              edgeResistanceMs,
                              requireCtrlKey,
                            );
                          }}
                          className={`w-14 h-28 rounded-xl border flex flex-col items-center justify-center gap-1 transition cursor-pointer ${
                            selectedEdge === "LEFT"
                              ? "bg-[#005C7D]/50 border-[#87CFF9] text-[#87CFF9] shadow-[0_0_20px_rgba(135,207,249,0.2)]"
                              : "bg-white/[0.02] border-dashed border-white/[0.14] text-[#788896] hover:text-[#d6e4ee]"
                          }`}
                        >
                          <Smartphone className="w-4 h-4" />
                          <span className="text-[10px]">Gauche</span>
                        </button>

                        <div className="flex flex-col items-center gap-3">
                          <div className="w-56 h-32 rounded-xl bg-[#232934] border border-white/[0.14] flex flex-col items-center justify-center">
                            <Monitor className="w-6 h-6 text-[#87CFF9] mb-1" />
                            <span className="text-[12px] font-medium text-[#f2f5f8]">
                              {status.deviceName}
                            </span>
                            <span className="text-[10px] text-[#788896]">
                              Écran de l&apos;ordinateur
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setSelectedEdge("BOTTOM");
                              syncInputSettings(
                                "BOTTOM",
                                edgeResistanceMs,
                                requireCtrlKey,
                              );
                            }}
                            className={`w-28 h-10 rounded-xl border flex items-center justify-center gap-1.5 transition cursor-pointer ${
                              selectedEdge === "BOTTOM"
                                ? "bg-[#005C7D]/50 border-[#87CFF9] text-[#87CFF9] shadow-[0_0_20px_rgba(135,207,249,0.2)]"
                                : "bg-white/[0.02] border-dashed border-white/[0.14] text-[#788896] hover:text-[#d6e4ee]"
                            }`}
                          >
                            <Smartphone className="w-3.5 h-3.5" />
                            <span className="text-[10px]">Bas</span>
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedEdge("RIGHT");
                            syncInputSettings(
                              "RIGHT",
                              edgeResistanceMs,
                              requireCtrlKey,
                            );
                          }}
                          className={`w-14 h-28 rounded-xl border flex flex-col items-center justify-center gap-1 transition cursor-pointer ${
                            selectedEdge === "RIGHT"
                              ? "bg-[#005C7D]/50 border-[#87CFF9] text-[#87CFF9] shadow-[0_0_20px_rgba(135,207,249,0.2)]"
                              : "bg-white/[0.02] border-dashed border-white/[0.14] text-[#788896] hover:text-[#d6e4ee]"
                          }`}
                        >
                          <Smartphone className="w-4 h-4" />
                          <span className="text-[10px]">Droite</span>
                        </button>
                      </div>
                    </div>

                    {/* Réglages anti-franchissement */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="rounded-xl bg-[#232934]/75 border border-white/[0.07] p-4 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[12.5px] font-medium text-[#f2f5f8]">
                            Résistance au bord
                          </div>
                          <div className="text-[11px] text-[#788896]">
                            Évite de basculer sur le téléphone par erreur
                          </div>
                        </div>
                        <select
                          value={edgeResistanceMs}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setEdgeResistanceMs(val);
                            syncInputSettings(
                              selectedEdge,
                              val,
                              requireCtrlKey,
                            );
                          }}
                          className="bg-[#14171c] border border-white/[0.12] rounded-lg px-2.5 py-1.5 text-[11.5px] text-[#f2f5f8] outline-none"
                        >
                          <option value={0}>Aucune</option>
                          <option value={120}>Douce</option>
                          <option value={250}>Ferme</option>
                        </select>
                      </div>

                      <div className="rounded-xl bg-[#232934]/75 border border-white/[0.07] p-4 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[12.5px] font-medium text-[#f2f5f8]">
                            Maintenir la touche Ctrl
                          </div>
                          <div className="text-[11px] text-[#788896]">
                            Passe sur le téléphone uniquement avec Ctrl
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={requireCtrlKey}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setRequireCtrlKey(checked);
                            syncInputSettings(
                              selectedEdge,
                              edgeResistanceMs,
                              checked,
                            );
                          }}
                          className="w-4 h-4 accent-[#87CFF9] cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Vue Paramètres à 2 colonnes */}
                {activeTab === "settings" && (
                  <SettingsPanel
                    status={status}
                    onRegenerateToken={handleRegenerateToken}
                    onRequestDisconnect={() => setDisconnectConfirmOpen(true)}
                    onOpenDownloadsFolder={() =>
                      invoke("open_downloads_folder")
                    }
                  />
                )}
              </>
            )}
          </main>
        </div>
      </div>

      {/* Boîte de confirmation d'association manuelle (sans QR Code) */}
      {status.pendingPairing && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#1b2028] border border-white/[0.12] shadow-2xl p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#005C7D] border border-[#87CFF9]/30 flex items-center justify-center text-[#87CFF9]">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-[#f2f5f8]">
                  Demande de connexion
                </h3>
                <p className="text-[12.5px] text-[#b0cadc]">
                  <strong className="text-[#f2f5f8]">
                    {status.pendingPairing.deviceName}
                  </strong>{" "}
                  souhaite se connecter à cet ordinateur.
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-[#14171c] border border-white/[0.08] p-4 text-center space-y-1.5">
              <div className="text-[12px] text-[#b0cadc]">
                Vérifiez que ce code correspond à celui affiché sur votre
                téléphone
              </div>
              <div className="text-3xl font-bold tracking-[0.28em] font-mono-tabular text-[#87CFF9] py-1">
                {status.pendingPairing.verificationCode}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() =>
                  handleRespondToPairing(
                    status.pendingPairing!.requestId,
                    false,
                  )
                }
                className="h-9 px-4 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[13px] text-[#d6e4ee] transition cursor-pointer"
              >
                Refuser
              </button>
              <button
                type="button"
                onClick={() =>
                  handleRespondToPairing(status.pendingPairing!.requestId, true)
                }
                className="h-9 px-4 rounded-lg bg-[#005C7D] hover:bg-[#00719a] text-[13px] font-medium text-[#f2f5f8] transition cursor-pointer"
              >
                Accepter
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale de confirmation de déconnexion */}
      {disconnectConfirmOpen && connectedDevice && (
        <div
          onClick={() => setDisconnectConfirmOpen(false)}
          className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-[#1b2028] border border-white/[0.12] shadow-2xl p-6 space-y-5"
          >
            <div className="space-y-1.5">
              <h3 className="text-[15px] font-semibold text-[#f2f5f8]">
                Déconnecter l&apos;appareil ?
              </h3>
              <p className="text-[13px] text-[#b0cadc]">
                Voulez-vous vraiment déconnecter et dissocier{" "}
                <strong className="text-[#f2f5f8]">
                  {connectedDevice.deviceName}
                </strong>{" "}
                de cet ordinateur ?
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDisconnectConfirmOpen(false)}
                className="h-9 px-4 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[13px] text-[#d6e4ee] transition cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={async () => {
                  setDisconnectConfirmOpen(false);
                  await handleDisconnectDevice();
                }}
                className="h-9 px-4 rounded-lg bg-rose-500 hover:bg-rose-400 text-[13px] font-medium text-white transition cursor-pointer"
              >
                Déconnecter
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
            className="w-full max-w-md rounded-xl bg-[#1b2028] border border-white/[0.12] shadow-2xl overflow-hidden"
          >
            <div className="px-3.5 py-2.5 border-b border-white/[0.07] flex items-center justify-between text-[12px] text-[#d6e4ee]">
              <span className="flex items-center gap-2 font-medium">
                <Sparkles className="w-3.5 h-3.5 text-[#87CFF9]" />
                Actions rapides NexusLink
              </span>
              <kbd className="text-[10px] font-mono-tabular text-[#788896]">
                Échap
              </kbd>
            </div>
            <div className="p-1.5 space-y-0.5 text-[12px]">
              <button
                type="button"
                onClick={() => {
                  handleOpenMirror();
                  setCommandPaletteOpen(false);
                }}
                disabled={!connectedDevice}
                className="w-full px-3 py-2 rounded-lg hover:bg-white/[0.06] disabled:opacity-40 flex items-center justify-between text-[#f2f5f8] cursor-pointer"
              >
                <span>Ouvrir l&apos;écran du téléphone</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab("explorer");
                  setCommandPaletteOpen(false);
                }}
                disabled={!connectedDevice}
                className="w-full px-3 py-2 rounded-lg hover:bg-white/[0.06] disabled:opacity-40 flex items-center justify-between text-[#f2f5f8] cursor-pointer"
              >
                <span>Ouvrir l&apos;Explorateur de fichiers</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  invoke("pick_and_send_files");
                  setCommandPaletteOpen(false);
                }}
                disabled={!connectedDevice}
                className="w-full px-3 py-2 rounded-lg hover:bg-white/[0.06] disabled:opacity-40 flex items-center justify-between text-[#f2f5f8] cursor-pointer"
              >
                <span>Envoyer des fichiers vers le téléphone</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  handleRegenerateToken();
                  setCommandPaletteOpen(false);
                }}
                className="w-full px-3 py-2 rounded-lg hover:bg-white/[0.06] flex items-center justify-between text-[#f2f5f8] cursor-pointer"
              >
                <span>Générer un nouveau QR Code d&apos;association</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab("settings");
                  setCommandPaletteOpen(false);
                }}
                className="w-full px-3 py-2 rounded-lg hover:bg-white/[0.06] flex items-center justify-between text-[#f2f5f8] cursor-pointer"
              >
                <span>Ouvrir les paramètres</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
