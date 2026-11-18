import { useState } from "react";
import { Bell, Check, Send, Smartphone, X } from "lucide-react";
import type { ConnectedDevice, PhoneNotificationRecord } from "../types/protocol";

interface NotificationsPanelProps {
  notifications: PhoneNotificationRecord[];
  connectedDevice: ConnectedDevice | null;
  onReply: (notificationKey: string, replyText: string) => Promise<boolean>;
  onDismiss: (notificationKey: string) => Promise<void>;
}

export function NotificationsPanel({
  notifications,
  connectedDevice,
  onReply,
  onDismiss,
}: NotificationsPanelProps) {
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [sendingKeys, setSendingKeys] = useState<Record<string, boolean>>({});
  const [sentKeys, setSentKeys] = useState<Record<string, boolean>>({});
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});

  const toggleExpanded = (notificationKey: string) => {
    setExpandedKeys((prev) => ({
      ...prev,
      [notificationKey]: !prev[notificationKey],
    }));
  };

  const handleSendReply = async (notificationKey: string) => {
    const draft = (replyDrafts[notificationKey] ?? "").trim();
    if (!draft || sendingKeys[notificationKey]) {
      return;
    }

    setSendingKeys((prev) => ({ ...prev, [notificationKey]: true }));
    try {
      const ok = await onReply(notificationKey, draft);
      if (ok) {
        setReplyDrafts((prev) => ({ ...prev, [notificationKey]: "" }));
        setSentKeys((prev) => ({ ...prev, [notificationKey]: true }));
        setTimeout(() => {
          setSentKeys((prev) => ({ ...prev, [notificationKey]: false }));
        }, 2000);
      }
    } finally {
      setSendingKeys((prev) => ({ ...prev, [notificationKey]: false }));
    }
  };

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      {/* En-tête du centre de notifications */}
      <div className="rounded-xl bg-[#111319] border border-white/[0.07] p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center text-indigo-400 shrink-0">
            <Bell className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-[14px] font-medium text-zinc-100">
              Notifications du téléphone
            </h2>
            <p className="text-[12px] text-zinc-400">
              {connectedDevice
                ? `Synchronisé avec ${connectedDevice.deviceName}`
                : "Connectez votre téléphone pour recevoir ses notifications ici."}
            </p>
          </div>
        </div>

        <div className="px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.07] text-[11px] font-medium font-mono-tabular text-zinc-300">
          {notifications.length}
        </div>
      </div>

      {/* Liste des notifications ou état vide */}
      {notifications.length === 0 ? (
        <div className="rounded-xl bg-[#111319] border border-white/[0.07] p-10 flex flex-col items-center justify-center text-center space-y-2.5">
          <div className="w-10 h-10 rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-zinc-500">
            <Smartphone className="w-4 h-4" />
          </div>
          <div className="text-[13px] font-medium text-zinc-200">
            Aucune notification pour le moment
          </div>
          <p className="text-[12px] text-zinc-500 max-w-md">
            Les nouveaux messages et alertes de votre téléphone s&apos;afficheront ici
            dès leur arrivée. Vous pourrez y répondre directement depuis votre clavier.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {notifications.map((notif) => {
            const draft = replyDrafts[notif.notificationKey] ?? "";
            const isSending = Boolean(sendingKeys[notif.notificationKey]);
            const isSent = Boolean(sentKeys[notif.notificationKey]);
            const isLongText =
              notif.text.length > 160 || notif.text.split("\n").length > 3;
            const isExpanded = Boolean(expandedKeys[notif.notificationKey]);

            return (
              <div
                key={notif.notificationKey}
                className="rounded-xl bg-[#111319] border border-white/[0.07] p-4 space-y-3 transition hover:border-white/[0.12]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    {notif.iconBase64 ? (
                      <img
                        src={`data:image/png;base64,${notif.iconBase64}`}
                        alt={notif.appName}
                        className="w-9 h-9 rounded-lg object-cover bg-white/[0.05] border border-white/[0.08] shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
                        <Bell className="w-4 h-4" />
                      </div>
                    )}

                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-medium text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded">
                          {notif.appName}
                        </span>
                        <span className="text-[11px] font-mono-tabular text-zinc-500">
                          {notif.timestamp}
                        </span>
                      </div>

                      {notif.title && (
                        <div className="text-[13px] font-medium text-zinc-100 break-words">
                          {notif.title}
                        </div>
                      )}

                      {notif.text && (
                        <div className="space-y-1">
                          <p
                            className={`text-[12px] text-zinc-300 leading-relaxed whitespace-pre-wrap break-words ${
                              isLongText && !isExpanded ? "line-clamp-3" : ""
                            }`}
                          >
                            {notif.text}
                          </p>
                          {isLongText && (
                            <button
                              type="button"
                              onClick={() => toggleExpanded(notif.notificationKey)}
                              className="text-[11px] font-medium text-indigo-400 hover:text-indigo-300 transition cursor-pointer"
                            >
                              {isExpanded ? "Réduire" : "Voir plus"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => onDismiss(notif.notificationKey)}
                    title="Fermer cette notification"
                    className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] transition shrink-0 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {notif.canReply && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      handleSendReply(notif.notificationKey);
                    }}
                    className="flex items-center gap-2 pt-1"
                  >
                    <input
                      type="text"
                      value={draft}
                      onChange={(event) =>
                        setReplyDrafts((prev) => ({
                          ...prev,
                          [notif.notificationKey]: event.target.value,
                        }))
                      }
                      placeholder={`Répondre via ${notif.appName}…`}
                      disabled={!connectedDevice || isSending}
                      className="flex-1 h-8 px-3 rounded-md bg-[#0b0c10] border border-white/[0.08] text-[12px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500/50 disabled:opacity-50"
                    />
                    <button
                      type="submit"
                      disabled={!connectedDevice || !draft.trim() || isSending}
                      className="h-8 px-3 rounded-md bg-indigo-500 hover:bg-indigo-400 disabled:bg-white/[0.05] disabled:text-zinc-500 text-white text-[12px] font-medium flex items-center gap-1.5 transition cursor-pointer disabled:cursor-not-allowed shrink-0"
                    >
                      {isSent ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          Envoyé
                        </>
                      ) : (
                        <>
                          <Send className="w-3.5 h-3.5" />
                          {isSending ? "Envoi…" : "Répondre"}
                        </>
                      )}
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
