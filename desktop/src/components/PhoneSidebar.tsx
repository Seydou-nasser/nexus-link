import { useState } from "react";
import {
  Battery,
  BatteryCharging,
  Bell,
  Check,
  FileUp,
  MonitorPlay,
  RefreshCw,
  Send,
  Smartphone,
  Unplug,
  Volume2,
  Wifi,
  X,
} from "lucide-react";
import type {
  ConnectedDevice,
  PhoneNotificationRecord,
  ServerStatus,
} from "../types/protocol";

interface PhoneSidebarProps {
  status: ServerStatus;
  connectedDevice: ConnectedDevice | null;
  notifications: PhoneNotificationRecord[];
  isRingingPhone: boolean;
  onOpenMirror: () => void;
  onToggleRingPhone: () => void;
  onPickFiles: () => void;
  onRequestDisconnect: () => void;
  onRefreshStatus: () => void;
  onReplyNotification: (
    notificationKey: string,
    replyText: string,
  ) => Promise<boolean>;
  onDismissNotification: (notificationKey: string) => Promise<void>;
  onDismissAllNotifications: () => Promise<void>;
}

export function PhoneSidebar({
  status,
  connectedDevice,
  notifications,
  isRingingPhone,
  onOpenMirror,
  onToggleRingPhone,
  onPickFiles,
  onRequestDisconnect,
  onRefreshStatus,
  onReplyNotification,
  onDismissNotification,
  onDismissAllNotifications,
}: PhoneSidebarProps) {
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [sendingKeys, setSendingKeys] = useState<Record<string, boolean>>({});
  const [sentKeys, setSentKeys] = useState<Record<string, boolean>>({});
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});

  const isConnected = Boolean(connectedDevice);
  const isMirrorActive =
    status.mirrorState === "ACTIVE" ||
    status.mirrorState === "WAITING_PERMISSION";

  const handleSendReply = async (notificationKey: string) => {
    const draft = (replyDrafts[notificationKey] ?? "").trim();
    if (!draft || sendingKeys[notificationKey]) return;

    setSendingKeys((prev) => ({ ...prev, [notificationKey]: true }));
    try {
      const ok = await onReplyNotification(notificationKey, draft);
      if (ok) {
        setReplyDrafts((prev) => ({ ...prev, [notificationKey]: "" }));
        setSentKeys((prev) => ({ ...prev, [notificationKey]: true }));
        setTimeout(() => {
          setSentKeys((prev) => ({ ...prev, [notificationKey]: false }));
        }, 1800);
      }
    } finally {
      setSendingKeys((prev) => ({ ...prev, [notificationKey]: false }));
    }
  };

  return (
    <aside className="w-[310px] h-full shrink-0 flex flex-col bg-gradient-to-b from-[#17212a]/90 via-[#14171c]/95 to-[#14171c] px-3.5 pt-2 pb-3 select-none overflow-hidden">
      {/* 1. En-tête du téléphone (façon Mobile connecté) */}
      <div className="flex items-center gap-3.5 pb-3.5">
        {/* Miniature smartphone cliquable pour ouvrir la recopie d'écran */}
        <button
          type="button"
          disabled={!isConnected}
          onClick={onOpenMirror}
          title={
            isConnected
              ? "Ouvrir l'écran du téléphone"
              : "Connectez un téléphone"
          }
          className="relative w-[50px] h-[90px] rounded-[11px] bg-gradient-to-br from-[#005C7D] via-[#0e3244] to-[#14171c] border border-white/20 shadow-lg flex flex-col items-center justify-center shrink-0 overflow-hidden group transition hover:border-[#87CFF9]/70 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <div className="w-4 h-[3px] rounded-full bg-white/25 absolute top-1.5" />
          <Smartphone className="w-5 h-5 text-[#87CFF9] group-hover:scale-110 transition-transform" />
          {isMirrorActive && (
            <span className="absolute bottom-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
          )}
        </button>

        {/* Informations appareil + badge Connecté */}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="text-[14px] font-semibold text-[#f2f5f8] truncate">
            {connectedDevice ? connectedDevice.deviceName : "Aucun téléphone"}
          </div>

          {connectedDevice ? (
            <div className="flex items-center gap-2 text-[12px] text-[#b0cadc]">
              <Wifi className="w-3.5 h-3.5 text-[#87CFF9]" />
              <span className="flex items-center gap-1 font-mono-tabular">
                {connectedDevice.isCharging ? (
                  <BatteryCharging className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Battery className="w-3.5 h-3.5 text-[#b0cadc]" />
                )}
                {connectedDevice.batteryLevel} %
              </span>
            </div>
          ) : (
            <div className="text-[12px] text-[#788896]">
              En attente d&apos;association
            </div>
          )}

          <div className="flex items-center gap-1.5 pt-0.5">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.06] border border-white/[0.07] text-[11px] font-medium text-[#f2f5f8]">
              <span
                className={`w-2 h-2 rounded-full ${
                  isConnected
                    ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]"
                    : "bg-zinc-500"
                }`}
              />
              {isConnected ? "Connecté" : "Déconnecté"}
            </div>

            <button
              type="button"
              onClick={onRefreshStatus}
              title="Actualiser le statut"
              className="w-7 h-7 rounded-md bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.07] flex items-center justify-center text-[#b0cadc] hover:text-white transition cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* 2. Rangée de 4 boutons d'actions rapides */}
      <div className="grid grid-cols-4 gap-2 pb-4 border-b border-white/[0.07]">
        <button
          type="button"
          disabled={!isConnected}
          onClick={onOpenMirror}
          title="Écran du téléphone"
          className={`h-8 rounded-md border flex items-center justify-center transition cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
            isMirrorActive
              ? "bg-[#87CFF9] text-[#09202c] border-[#87CFF9]"
              : "bg-white/[0.05] hover:bg-white/[0.1] text-[#d6e4ee] border-white/[0.08]"
          }`}
        >
          <MonitorPlay className="w-4 h-4" />
        </button>

        <button
          type="button"
          disabled={!isConnected}
          onClick={onToggleRingPhone}
          title={
            isRingingPhone
              ? "Arrêter la sonnerie"
              : "Faire sonner mon téléphone"
          }
          className={`h-8 rounded-md border flex items-center justify-center transition cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
            isRingingPhone
              ? "bg-[#87CFF9] text-[#09202c] border-[#87CFF9]"
              : "bg-white/[0.05] hover:bg-white/[0.1] text-[#d6e4ee] border-white/[0.08]"
          }`}
        >
          <Volume2 className="w-4 h-4" />
        </button>

        <button
          type="button"
          disabled={!isConnected}
          onClick={onPickFiles}
          title="Envoyer des fichiers"
          className="h-8 rounded-md bg-white/[0.05] hover:bg-white/[0.1] text-[#d6e4ee] border border-white/[0.08] flex items-center justify-center transition cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
        >
          <FileUp className="w-4 h-4" />
        </button>

        <button
          type="button"
          disabled={!isConnected}
          onClick={onRequestDisconnect}
          title="Déconnecter l'appareil"
          className="h-8 rounded-md bg-white/[0.05] hover:bg-rose-500/20 text-[#d6e4ee] hover:text-rose-300 border border-white/[0.08] hover:border-rose-500/30 flex items-center justify-center transition cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
        >
          <Unplug className="w-4 h-4" />
        </button>
      </div>

      {/* 3. En-tête du fil Notifications */}
      <div className="flex items-center justify-between pt-3.5 pb-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold text-[#f2f5f8]">
            Notifications
          </h2>
          {notifications.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-[#005C7D]/80 text-[#87CFF9] text-[10px] font-mono-tabular font-medium leading-none">
              {notifications.length}
            </span>
          )}
        </div>

        {notifications.length > 0 && (
          <button
            type="button"
            onClick={onDismissAllNotifications}
            className="text-[12px] font-medium text-[#87CFF9] hover:text-[#b5e1fc] transition cursor-pointer"
          >
            Effacer tout
          </button>
        )}
      </div>

      {/* 4. Liste scrollable des notifications */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-1">
        {notifications.length === 0 ? (
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-4 py-8 text-center space-y-1.5">
            <Bell className="w-5 h-5 text-[#788896] mx-auto" />
            <div className="text-[12px] font-medium text-[#b0cadc]">
              Aucune notification
            </div>
            <p className="text-[11px] text-[#788896]">
              {isConnected
                ? "Les alertes de votre téléphone apparaîtront ici."
                : "Associez votre téléphone pour recevoir ses notifications."}
            </p>
          </div>
        ) : (
          notifications.map((notif) => {
            const draft = replyDrafts[notif.notificationKey] ?? "";
            const isSending = Boolean(sendingKeys[notif.notificationKey]);
            const isSent = Boolean(sentKeys[notif.notificationKey]);
            const isLongText =
              notif.text.length > 130 || notif.text.split("\n").length > 3;
            const isExpanded = Boolean(expandedKeys[notif.notificationKey]);

            return (
              <div
                key={notif.notificationKey}
                className="group rounded-xl bg-white/[0.045] hover:bg-white/[0.065] border border-white/[0.07] p-3 space-y-2 transition"
              >
                {/* Ligne App + Heure + Fermer */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {notif.iconBase64 ? (
                      <img
                        src={`data:image/png;base64,${notif.iconBase64}`}
                        alt={notif.appName}
                        className="w-4 h-4 rounded object-cover shrink-0"
                      />
                    ) : (
                      <Bell className="w-3.5 h-3.5 text-[#87CFF9] shrink-0" />
                    )}
                    <span className="text-[11px] font-medium text-[#b0cadc] truncate">
                      {notif.appName}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] font-mono-tabular text-[#788896]">
                      {notif.timestamp.replace(" UTC", "")}
                    </span>
                    <button
                      type="button"
                      onClick={() => onDismissNotification(notif.notificationKey)}
                      title="Fermer"
                      className="w-5 h-5 rounded flex items-center justify-center text-[#788896] opacity-70 group-hover:opacity-100 hover:bg-white/[0.1] hover:text-white transition cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Titre & Corps */}
                <div className="space-y-0.5">
                  {notif.title && (
                    <div className="text-[12.5px] font-semibold text-[#f2f5f8] break-words leading-snug">
                      {notif.title}
                    </div>
                  )}
                  {notif.text && (
                    <div>
                      <p
                        className={`text-[12px] text-[#c7d6e2] leading-relaxed whitespace-pre-wrap break-words ${
                          isLongText && !isExpanded ? "line-clamp-3" : ""
                        }`}
                      >
                        {notif.text}
                      </p>
                      {isLongText && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedKeys((prev) => ({
                              ...prev,
                              [notif.notificationKey]:
                                !prev[notif.notificationKey],
                            }))
                          }
                          className="text-[11px] font-medium text-[#87CFF9] hover:text-[#b5e1fc] mt-0.5 transition cursor-pointer"
                        >
                          {isExpanded ? "Réduire" : "Voir plus"}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Réponse rapide intégrée (style Mobile connecté) */}
                {notif.canReply && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSendReply(notif.notificationKey);
                    }}
                    className="flex items-center gap-1.5 pt-1"
                  >
                    <input
                      type="text"
                      value={draft}
                      onChange={(e) =>
                        setReplyDrafts((prev) => ({
                          ...prev,
                          [notif.notificationKey]: e.target.value,
                        }))
                      }
                      placeholder="Saisir un message"
                      disabled={!isConnected || isSending}
                      className="flex-1 h-7 px-2.5 rounded-md bg-black/25 border border-white/[0.08] text-[11.5px] text-[#f2f5f8] placeholder:text-[#788896] focus:outline-none focus:border-[#87CFF9]/60 disabled:opacity-50"
                    />
                    <button
                      type="submit"
                      disabled={!isConnected || !draft.trim() || isSending}
                      title="Envoyer"
                      className="h-7 w-7 rounded-md bg-[#005C7D] hover:bg-[#00719a] disabled:bg-white/[0.05] disabled:text-zinc-600 text-[#87CFF9] flex items-center justify-center transition shrink-0 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {isSent ? (
                        <Check className="w-3.5 h-3.5 text-emerald-300" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </form>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
