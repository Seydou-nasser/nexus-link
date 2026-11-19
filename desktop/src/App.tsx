import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  Clipboard,
  FolderSync,
  HardDrive,
  Images,
  MessageSquare,
  MoreHorizontal,
  MousePointerClick,
  Phone,
  RefreshCw,
  Settings,
} from "lucide-react";
import { AppModals } from "./components/AppModals";
import { CallsPanel } from "./components/CallsPanel";
import { ClipboardPanel } from "./components/ClipboardPanel";
import { FileExplorerPanel } from "./components/FileExplorerPanel";
import { GalleryPanel } from "./components/GalleryPanel";
import {
  InputControlPanel,
  type ScreenEdge,
} from "./components/InputControlPanel";
import { MessagesPanel } from "./components/MessagesPanel";
import { PairingPanel } from "./components/PairingPanel";
import { PhoneSidebar } from "./components/PhoneSidebar";
import { SettingsPanel } from "./components/SettingsPanel";
import { TitleBar } from "./components/TitleBar";
import { TransfersPanel } from "./components/TransfersPanel";
import type {
  ClipboardHistoryEntry,
  FileTransferRecord,
  PhoneNotificationRecord,
  ServerStatus,
  SmsContactDto,
} from "./types/protocol";
import "./App.css";

type TopTabId =
  | "messages"
  | "calls"
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

function formatLocalTime(raw: string): string {
  const num = Number(raw);
  if (Number.isFinite(num) && num > 1_000_000_000_000) {
    return new Date(num).toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  return raw.replace(" UTC", "");
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
  const [pendingSmsRecipient, setPendingSmsRecipient] =
    useState<SmsContactDto | null>(null);

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
      console.error("Impossible de régénérer le jeton :", error);
    }
  };

  const handleDisconnectDevice = async () => {
    try {
      const updated = await invoke<ServerStatus>("disconnect_device");
      setStatus(updated);
      setIsRingingPhone(false);
    } catch (error) {
      console.error("Impossible de déconnecter l'appareil :", error);
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
      console.error("Impossible de répondre à la demande :", error);
    }
  };

  const handleToggleRingPhone = async () => {
    const nextState = !isRingingPhone;
    try {
      const sent = await invoke<boolean>("trigger_find_my_phone", {
        ringing: nextState,
      });
      if (sent) {
        setIsRingingPhone(nextState);
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
      (event) => setClipboardHistory(event.payload),
    );

    const unlistenFilesPromise = listen<FileTransferRecord[]>(
      "nexus://files-updated",
      (event) => setFileTransfers(event.payload),
    );

    const unlistenNotificationsPromise = listen<PhoneNotificationRecord[]>(
      "nexus://notifications-updated",
      (event) => setNotifications(event.payload),
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
        setActiveTab("messages");
      } else if (event.altKey && event.key === "2") {
        setActiveTab("calls");
      } else if (event.altKey && event.key === "3") {
        setActiveTab("gallery");
      } else if (event.altKey && event.key === "4") {
        setActiveTab("explorer");
      } else if (event.altKey && event.key === "5") {
        setActiveTab("files");
      } else if (event.altKey && event.key === "6") {
        setActiveTab("clipboard");
      } else if (event.altKey && event.key === "7") {
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
    { id: "messages", label: "Messages", icon: MessageSquare },
    { id: "calls", label: "Appels", icon: Phone },
    { id: "gallery", label: "Galerie", icon: Images },
    { id: "explorer", label: "Explorateur", icon: HardDrive },
    { id: "files", label: "Transferts", icon: FolderSync },
    { id: "clipboard", label: "Presse-papiers", icon: Clipboard },
    { id: "input", label: "Souris & Clavier", icon: MousePointerClick },
  ];

  return (
    <div className="h-screen w-screen flex flex-col bg-[#14171c]/95 text-[#f2f5f8] overflow-hidden">
      <TitleBar />

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
          {/* Barre d'onglets horizontaux */}
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
            {!connectedDevice && activeTab !== "settings" ? (
              <PairingPanel
                deviceName={status.deviceName}
                qrSvg={status.qrSvg}
                onRegenerateToken={handleRegenerateToken}
              />
            ) : (
              <>
                {activeTab === "messages" && (
                  <MessagesPanel
                    deviceId={connectedDevice?.deviceId ?? null}
                    initialRecipient={pendingSmsRecipient}
                    onConsumeInitialRecipient={() =>
                      setPendingSmsRecipient(null)
                    }
                  />
                )}

                {activeTab === "calls" && (
                  <CallsPanel
                    deviceId={connectedDevice?.deviceId ?? null}
                    onStartSms={(contactName, phoneNumber) => {
                      setPendingSmsRecipient({
                        name: contactName,
                        phoneNumber,
                      });
                      setActiveTab("messages");
                    }}
                  />
                )}

                {activeTab === "gallery" && (
                  <GalleryPanel
                    httpPort={status.httpPort}
                    deviceId={connectedDevice?.deviceId ?? null}
                  />
                )}

                {activeTab === "explorer" && (
                  <FileExplorerPanel
                    deviceId={connectedDevice?.deviceId ?? null}
                    isDraggingFile={isDraggingFile}
                    onRegisterDropHandler={handleRegisterExplorerDrop}
                  />
                )}

                {activeTab === "files" && (
                  <TransfersPanel
                    connectedDeviceName={connectedDevice?.deviceName ?? null}
                    fileTransfers={fileTransfers}
                    isDraggingFile={isDraggingFile}
                    formatFileSize={formatFileSize}
                    formatLocalTime={formatLocalTime}
                  />
                )}

                {activeTab === "clipboard" && (
                  <ClipboardPanel
                    clipboardDraft={clipboardDraft}
                    clipboardHistory={clipboardHistory}
                    onChangeDraft={setClipboardDraft}
                    onSendDraft={handleSendClipboardDraft}
                    formatLocalTime={formatLocalTime}
                  />
                )}

                {activeTab === "input" && (
                  <InputControlPanel
                    pcDeviceName={status.deviceName}
                    selectedEdge={selectedEdge}
                    edgeResistanceMs={edgeResistanceMs}
                    requireCtrlKey={requireCtrlKey}
                    onChangeEdge={(edge) => {
                      setSelectedEdge(edge);
                      syncInputSettings(edge, edgeResistanceMs, requireCtrlKey);
                    }}
                    onChangeResistance={(ms) => {
                      setEdgeResistanceMs(ms);
                      syncInputSettings(selectedEdge, ms, requireCtrlKey);
                    }}
                    onChangeRequireCtrl={(checked) => {
                      setRequireCtrlKey(checked);
                      syncInputSettings(
                        selectedEdge,
                        edgeResistanceMs,
                        checked,
                      );
                    }}
                  />
                )}

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

      <AppModals
        pendingPairing={status.pendingPairing}
        connectedDevice={connectedDevice}
        disconnectConfirmOpen={disconnectConfirmOpen}
        commandPaletteOpen={commandPaletteOpen}
        onRespondToPairing={handleRespondToPairing}
        onCloseDisconnectConfirm={() => setDisconnectConfirmOpen(false)}
        onConfirmDisconnect={async () => {
          setDisconnectConfirmOpen(false);
          await handleDisconnectDevice();
        }}
        onCloseCommandPalette={() => setCommandPaletteOpen(false)}
        onOpenMirror={handleOpenMirror}
        onOpenExplorer={() => setActiveTab("explorer")}
        onRegenerateToken={handleRegenerateToken}
        onOpenSettings={() => setActiveTab("settings")}
      />
    </div>
  );
}

export default App;
