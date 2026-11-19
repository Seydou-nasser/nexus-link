import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  SquarePen,
  User,
  X,
} from "lucide-react";
import type {
  SmsContactDto,
  SmsConversationDto,
  SmsMessageDto,
} from "../types/protocol";

interface MessagesPanelProps {
  deviceId: string | null;
  initialRecipient?: SmsContactDto | null;
  onConsumeInitialRecipient?: () => void;
}

function getInitials(label: string): string {
  const cleaned = label.trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

function formatConversationDate(dateMs: number): string {
  if (!dateMs) return "";
  const date = new Date(dateMs);
  const now = new Date();
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (isSameDay) {
    return date.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return "Hier";
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function formatMessageTime(dateMs: number): string {
  if (!dateMs) return "";
  const date = new Date(dateMs);
  const now = new Date();
  const timeStr = date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (isSameDay) return timeStr;
  return `${date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
  })} ${timeStr}`;
}

export function MessagesPanel({
  deviceId,
  initialRecipient,
  onConsumeInitialRecipient,
}: MessagesPanelProps) {
  const [conversations, setConversations] = useState<SmsConversationDto[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null);
  const [readTimestamps, setReadTimestamps] = useState<Record<number, number>>(
    {},
  );
  const [messages, setMessages] = useState<SmsMessageDto[]>([]);
  const [filterQuery, setFilterQuery] = useState("");
  const [draftText, setDraftText] = useState("");

  // Mode « Nouveau message »
  const [composingNew, setComposingNew] = useState(false);
  const [recipientInput, setRecipientInput] = useState("");
  const [selectedRecipient, setSelectedRecipient] =
    useState<SmsContactDto | null>(null);
  const [contactSuggestions, setContactSuggestions] = useState<SmsContactDto[]>(
    [],
  );

  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const selectedThreadIdRef = useRef<number | null>(selectedThreadId);
  selectedThreadIdRef.current = selectedThreadId;

  const markThreadAsReadLocally = useCallback(
    (threadId: number, dateMs: number) => {
      setReadTimestamps((prev) => {
        const current = prev[threadId] ?? 0;
        const nextTs = Math.max(current, dateMs, Date.now());
        if (current >= dateMs && current > 0) return prev;
        return { ...prev, [threadId]: nextTs };
      });
    },
    [],
  );

  const loadConversations = useCallback(async (silent = false) => {
    if (!silent) setLoadingConversations(true);
    setErrorMessage(null);
    try {
      const list = await invoke<SmsConversationDto[]>("sms_list_conversations", {
        limit: 60,
      });
      setConversations(list);
      if (selectedThreadIdRef.current === null && list.length > 0) {
        setSelectedThreadId(list[0].threadId);
        markThreadAsReadLocally(list[0].threadId, list[0].dateMs);
      }
    } catch (err) {
      setErrorMessage(
        typeof err === "string"
          ? err
          : "Impossible de charger les conversations SMS.",
      );
    } finally {
      if (!silent) setLoadingConversations(false);
    }
  }, [markThreadAsReadLocally]);

  const loadMessages = useCallback(async (threadId: number, silent = false) => {
    if (!silent) setLoadingMessages(true);
    setErrorMessage(null);
    try {
      const list = await invoke<SmsMessageDto[]>("sms_list_messages", {
        threadId,
        limit: 80,
      });
      setMessages(list);
    } catch (err) {
      setErrorMessage(
        typeof err === "string"
          ? err
          : "Impossible de charger cette conversation.",
      );
    } finally {
      if (!silent) setLoadingMessages(false);
    }
  }, []);

  // Chargement initial
  useEffect(() => {
    if (!deviceId) {
      setConversations([]);
      setSelectedThreadId(null);
      setMessages([]);
      return;
    }
    loadConversations();
  }, [deviceId, loadConversations]);

  // Ouvre automatiquement un nouveau message pré-rempli lorsqu'on vient de l'onglet Appels
  useEffect(() => {
    if (!initialRecipient) return;
    setComposingNew(true);
    setSelectedRecipient(initialRecipient);
    setRecipientInput(initialRecipient.phoneNumber);
    onConsumeInitialRecipient?.();
  }, [initialRecipient, onConsumeInitialRecipient]);

  // Charge les messages quand on change de fil
  useEffect(() => {
    if (!deviceId || selectedThreadId === null || composingNew) return;
    loadMessages(selectedThreadId);
  }, [deviceId, selectedThreadId, composingNew, loadMessages]);

  // Défilement automatique vers le dernier message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, selectedThreadId]);

  // Écoute temps réel des nouveaux SMS (WebSocket -> Tauri)
  useEffect(() => {
    if (!deviceId) return;
    const unlistenPromise = listen("nexus://sms-updated", () => {
      loadConversations(true);
      if (selectedThreadIdRef.current !== null) {
        loadMessages(selectedThreadIdRef.current, true);
      }
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [deviceId, loadConversations, loadMessages]);

  // Recherche de contacts pour « Nouveau message »
  useEffect(() => {
    if (!deviceId || !composingNew || selectedRecipient) {
      setContactSuggestions([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const list = await invoke<SmsContactDto[]>("sms_search_contacts", {
          query: recipientInput.trim(),
        });
        setContactSuggestions(list);
      } catch {
        setContactSuggestions([]);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [deviceId, composingNew, recipientInput, selectedRecipient]);

  const filteredConversations = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.contactName.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q) ||
        c.snippet.toLowerCase().includes(q),
    );
  }, [conversations, filterQuery]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.threadId === selectedThreadId) ?? null,
    [conversations, selectedThreadId],
  );

  const handleSendMessage = async () => {
    const body = draftText.trim();
    if (!body || sending) return;

    const targetAddress = composingNew
      ? selectedRecipient?.phoneNumber ?? recipientInput.trim()
      : activeConversation?.address ?? "";
    if (!targetAddress) return;

    setSending(true);
    setErrorMessage(null);
    try {
      await invoke("sms_send", {
        address: targetAddress,
        body,
      });
      setDraftText("");

      if (composingNew) {
        setComposingNew(false);
        setSelectedRecipient(null);
        setRecipientInput("");
        // Recharge les conversations après un court délai le temps qu'Android écrive le SMS
        window.setTimeout(() => {
          loadConversations(true);
        }, 700);
      } else if (selectedThreadId !== null) {
        // Ajoute immédiatement une bulle locale optimiste en attendant SMS_UPDATED
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now(),
            threadId: selectedThreadId,
            address: targetAddress,
            body,
            dateMs: Date.now(),
            isOutgoing: true,
          },
        ]);
        window.setTimeout(() => {
          loadConversations(true);
          if (selectedThreadIdRef.current !== null) {
            loadMessages(selectedThreadIdRef.current, true);
          }
        }, 800);
      }
    } catch (err) {
      setErrorMessage(
        typeof err === "string" ? err : "Impossible d'envoyer le SMS.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="h-full flex gap-4 min-h-0">
      {/* Colonne gauche : Liste des conversations */}
      <aside className="w-[290px] shrink-0 flex flex-col gap-3 border-r border-white/[0.07] pr-3 min-h-0">
        <div className="flex items-center justify-between gap-2 shrink-0">
          <h2 className="text-[15px] font-semibold text-[#f2f5f8]">Messages</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setComposingNew(true);
                setSelectedRecipient(null);
                setRecipientInput("");
                setDraftText("");
              }}
              title="Nouveau message"
              className="h-8 px-2.5 rounded-lg bg-[#005C7D] hover:bg-[#00719a] text-[12px] text-[#f2f5f8] font-medium flex items-center gap-1.5 transition cursor-pointer"
            >
              <SquarePen className="w-3.5 h-3.5 text-[#87CFF9]" />
              Nouveau
            </button>
            <button
              type="button"
              onClick={() => {
                loadConversations();
                if (selectedThreadId !== null && !composingNew) {
                  loadMessages(selectedThreadId);
                }
              }}
              disabled={loadingConversations}
              title="Actualiser les SMS"
              className="w-8 h-8 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] flex items-center justify-center text-[#87CFF9] transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loadingConversations ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>

        <div className="relative shrink-0">
          <Search className="w-3.5 h-3.5 text-[#788896] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Rechercher une conversation…"
            className="w-full h-8 pl-8 pr-2.5 rounded-lg bg-[#14171c] border border-white/[0.08] text-[12px] text-[#f2f5f8] placeholder:text-[#788896] focus:outline-none focus:border-[#87CFF9]/60"
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-0.5">
          {loadingConversations && conversations.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-[#9cb1c2]">
              <Loader2 className="w-5 h-5 animate-spin text-[#87CFF9]" />
              <span className="text-[12px]">Chargement des SMS…</span>
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-1.5 text-center text-[#788896] px-4">
              <MessageSquare className="w-7 h-7 text-[#87CFF9]/40" />
              <p className="text-[12.5px] text-[#b0cadc]">
                Aucune conversation trouvée.
              </p>
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isSelected =
                !composingNew && selectedThreadId === conv.threadId;
              const lastRead = readTimestamps[conv.threadId] ?? 0;
              const effectiveUnread =
                conv.unreadCount > 0 && conv.dateMs > lastRead
                  ? conv.unreadCount
                  : 0;
              return (
                <button
                  key={conv.threadId}
                  type="button"
                  onClick={() => {
                    setComposingNew(false);
                    setSelectedThreadId(conv.threadId);
                    markThreadAsReadLocally(conv.threadId, conv.dateMs);
                  }}
                  className={`relative w-full text-left rounded-xl p-2.5 flex items-center gap-2.5 transition cursor-pointer ${
                    isSelected
                      ? "bg-white/[0.08] border border-[#87CFF9]/30"
                      : "hover:bg-white/[0.04] border border-transparent"
                  }`}
                >
                  <div className="w-9 h-9 rounded-full bg-[#005C7D]/60 border border-[#87CFF9]/30 text-[#87CFF9] text-[12px] font-semibold flex items-center justify-center shrink-0">
                    {getInitials(conv.contactName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12.5px] font-semibold text-[#f2f5f8] truncate">
                        {conv.contactName}
                      </span>
                      <span className="text-[10px] font-mono-tabular text-[#788896] shrink-0">
                        {formatConversationDate(conv.dateMs)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p className="text-[11.5px] text-[#9cb1c2] truncate">
                        {conv.snippet || "…"}
                      </p>
                      {effectiveUnread > 0 && (
                        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#87CFF9] text-[#14171c] text-[10px] font-bold flex items-center justify-center shrink-0">
                          {effectiveUnread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Colonne droite : Fil de discussion OU Nouveau message */}
      <section className="flex-1 min-w-0 flex flex-col gap-3 min-h-0">
        {errorMessage && (
          <div className="rounded-xl bg-rose-500/10 border border-rose-500/25 px-3.5 py-2.5 text-[12px] text-rose-200 flex items-center justify-between gap-3 shrink-0">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-[11px] text-rose-300 hover:underline cursor-pointer shrink-0"
            >
              Fermer
            </button>
          </div>
        )}

        {composingNew ? (
          <>
            <div className="pb-3 border-b border-white/[0.07] space-y-2.5 shrink-0">
              <div className="flex items-center justify-between">
                <h3 className="text-[14px] font-semibold text-[#f2f5f8]">
                  Nouveau message
                </h3>
                <button
                  type="button"
                  onClick={() => setComposingNew(false)}
                  className="w-7 h-7 rounded-lg hover:bg-white/[0.08] text-[#9cb1c2] hover:text-white flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[12px] text-[#788896] shrink-0">À :</span>
                {selectedRecipient ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#005C7D]/60 border border-[#87CFF9]/35 text-[12px] text-[#f2f5f8]">
                    {selectedRecipient.name} ({selectedRecipient.phoneNumber})
                    <button
                      type="button"
                      onClick={() => setSelectedRecipient(null)}
                      className="text-[#87CFF9] hover:text-white cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ) : (
                  <input
                    type="text"
                    autoFocus
                    value={recipientInput}
                    onChange={(e) => setRecipientInput(e.target.value)}
                    placeholder="Nom d'un contact ou numéro de téléphone…"
                    className="flex-1 h-8 px-3 rounded-lg bg-[#14171c] border border-white/[0.1] text-[12.5px] text-[#f2f5f8] placeholder:text-[#788896] focus:outline-none focus:border-[#87CFF9]/60"
                  />
                )}
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-1">
              {!selectedRecipient && contactSuggestions.length > 0 ? (
                contactSuggestions.map((contact, idx) => (
                  <button
                    key={`${contact.phoneNumber}-${idx}`}
                    type="button"
                    onClick={() => setSelectedRecipient(contact)}
                    className="w-full text-left rounded-xl hover:bg-white/[0.05] px-3 py-2 flex items-center gap-3 transition cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-full bg-[#232934] border border-white/[0.08] flex items-center justify-center text-[#87CFF9] shrink-0">
                      <User className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-medium text-[#f2f5f8] truncate">
                        {contact.name}
                      </div>
                      <div className="text-[11px] font-mono-tabular text-[#788896]">
                        {contact.phoneNumber}
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="h-full flex items-center justify-center text-[12.5px] text-[#788896] text-center px-6">
                  {selectedRecipient
                    ? `Écrivez votre SMS pour ${selectedRecipient.name} ci-dessous.`
                    : "Tapez un nom de contact ou directement un numéro de téléphone."}
                </div>
              )}
            </div>
          </>
        ) : activeConversation ? (
          <>
            {/* En-tête de la conversation */}
            <div className="pb-3 border-b border-white/[0.07] flex items-center gap-3 shrink-0">
              <div className="w-9 h-9 rounded-full bg-[#005C7D]/60 border border-[#87CFF9]/30 text-[#87CFF9] text-[12px] font-semibold flex items-center justify-center shrink-0">
                {getInitials(activeConversation.contactName)}
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-[#f2f5f8] truncate">
                  {activeConversation.contactName}
                </div>
                {activeConversation.contactName !==
                  activeConversation.address && (
                  <div className="text-[11px] font-mono-tabular text-[#788896]">
                    {activeConversation.address}
                  </div>
                )}
              </div>
            </div>

            {/* Bulles de messages */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-1">
              {loadingMessages && messages.length === 0 ? (
                <div className="h-full flex items-center justify-center gap-2 text-[#9cb1c2]">
                  <Loader2 className="w-5 h-5 animate-spin text-[#87CFF9]" />
                  <span className="text-[12px]">Chargement du fil…</span>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      msg.isOutgoing ? "items-end" : "items-start"
                    }`}
                  >
                    <div
                      className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap break-words ${
                        msg.isOutgoing
                          ? "bg-[#005C7D] text-[#f2f5f8] rounded-br-sm"
                          : "bg-[#232934] border border-white/[0.07] text-[#e8f0f6] rounded-bl-sm"
                      }`}
                    >
                      {msg.body}
                    </div>
                    <span className="text-[10px] font-mono-tabular text-[#788896] mt-0.5 px-1">
                      {formatMessageTime(msg.dateMs)}
                    </span>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[#788896]">
            <MessageSquare className="w-8 h-8 text-[#87CFF9]/40" />
            <p className="text-[13px] text-[#b0cadc]">
              Sélectionnez une conversation ou créez un nouveau message.
            </p>
          </div>
        )}

        {/* Barre de saisie SMS */}
        {(activeConversation || composingNew) && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="pt-2 border-t border-white/[0.07] flex items-end gap-2 shrink-0"
          >
            <textarea
              rows={1}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder="Écrire un SMS… (Entrée pour envoyer)"
              className="flex-1 min-h-[38px] max-h-28 px-3.5 py-2 rounded-xl bg-[#14171c] border border-white/[0.1] text-[12.5px] text-[#f2f5f8] placeholder:text-[#788896] focus:outline-none focus:border-[#87CFF9]/60 resize-none"
            />
            <button
              type="submit"
              disabled={
                sending ||
                !draftText.trim() ||
                (composingNew &&
                  !selectedRecipient &&
                  !recipientInput.trim())
              }
              className="h-[38px] px-4 rounded-xl bg-[#005C7D] hover:bg-[#00719a] disabled:opacity-40 text-[#f2f5f8] text-[12.5px] font-medium flex items-center gap-1.5 transition cursor-pointer shrink-0"
            >
              {sending ? (
                <Loader2 className="w-4 h-4 animate-spin text-[#87CFF9]" />
              ) : (
                <Send className="w-4 h-4 text-[#87CFF9]" />
              )}
              Envoyer
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
