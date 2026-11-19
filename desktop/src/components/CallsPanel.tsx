import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  CheckCircle2,
  Delete,
  Loader2,
  MessageSquare,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  PhoneOutgoing,
  RefreshCw,
  Search,
} from "lucide-react";
import type { CallLogEntryDto } from "../types/protocol";

type CallFilter = "ALL" | "MISSED" | "INCOMING" | "OUTGOING";

interface CallsPanelProps {
  deviceId: string | null;
  onStartSms: (contactName: string, phoneNumber: string) => void;
}

const DIALPAD_KEYS: { digit: string; letters: string }[] = [
  { digit: "1", letters: "" },
  { digit: "2", letters: "ABC" },
  { digit: "3", letters: "DEF" },
  { digit: "4", letters: "GHI" },
  { digit: "5", letters: "JKL" },
  { digit: "6", letters: "MNO" },
  { digit: "7", letters: "PQRS" },
  { digit: "8", letters: "TUV" },
  { digit: "9", letters: "WXYZ" },
  { digit: "*", letters: "" },
  { digit: "0", letters: "+" },
  { digit: "#", letters: "" },
];

function formatCallDuration(durationSec: number, callType: string): string {
  if (callType === "MISSED") return "Manqué";
  if (callType === "REJECTED") return "Rejeté";
  if (durationSec <= 0) return "Non répondu";
  const hours = Math.floor(durationSec / 3600);
  const minutes = Math.floor((durationSec % 3600) / 60);
  const seconds = durationSec % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatCallDate(dateMs: number): string {
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

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return `Hier ${timeStr}`;

  return `${date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
  })} ${timeStr}`;
}

function renderCallTypeIcon(callType: CallLogEntryDto["callType"]) {
  switch (callType) {
    case "MISSED":
      return <PhoneMissed className="w-4 h-4 text-rose-400 shrink-0" />;
    case "REJECTED":
      return <PhoneOff className="w-4 h-4 text-amber-300 shrink-0" />;
    case "OUTGOING":
      return <PhoneOutgoing className="w-4 h-4 text-[#87CFF9] shrink-0" />;
    default:
      return <PhoneIncoming className="w-4 h-4 text-emerald-400 shrink-0" />;
  }
}

export function CallsPanel({ deviceId, onStartSms }: CallsPanelProps) {
  const [calls, setCalls] = useState<CallLogEntryDto[]>([]);
  const [filter, setFilter] = useState<CallFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [dialInput, setDialInput] = useState("");

  const [loading, setLoading] = useState(false);
  const [dialing, setDialing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dialFeedback, setDialFeedback] = useState<string | null>(null);

  const loadHistory = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setErrorMessage(null);
    try {
      const list = await invoke<CallLogEntryDto[]>("calls_list_history", {
        limit: 100,
      });
      setCalls(list);
    } catch (err) {
      setErrorMessage(
        typeof err === "string"
          ? err
          : "Impossible de charger le journal d'appels.",
      );
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!deviceId) {
      setCalls([]);
      return;
    }
    loadHistory();
  }, [deviceId, loadHistory]);

  // Actualisation temps réel dès qu'un appel est passé ou reçu
  useEffect(() => {
    if (!deviceId) return;
    const unlistenPromise = listen("nexus://calls-updated", () => {
      loadHistory(true);
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [deviceId, loadHistory]);

  useEffect(() => {
    if (!dialFeedback) return;
    const timer = window.setTimeout(() => setDialFeedback(null), 3200);
    return () => window.clearTimeout(timer);
  }, [dialFeedback]);

  const filteredCalls = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return calls.filter((entry) => {
      if (filter === "MISSED" && entry.callType !== "MISSED") return false;
      if (filter === "INCOMING" && entry.callType !== "INCOMING") return false;
      if (filter === "OUTGOING" && entry.callType !== "OUTGOING") return false;
      if (!q) return true;
      return (
        entry.contactName.toLowerCase().includes(q) ||
        entry.number.toLowerCase().includes(q)
      );
    });
  }, [calls, filter, searchQuery]);

  const handleDial = async (rawNumber: string, label?: string) => {
    const number = rawNumber.trim();
    if (!number || number === "Numéro masqué" || dialing) return;
    setDialing(true);
    setErrorMessage(null);
    try {
      await invoke("calls_dial_number", { number });
      setDialFeedback(`Appel lancé vers ${label || number} sur votre téléphone.`);
    } catch (err) {
      setErrorMessage(
        typeof err === "string" ? err : "Impossible de lancer l'appel.",
      );
    } finally {
      setDialing(false);
    }
  };

  return (
    <div className="h-full flex gap-5 min-h-0">
      {/* Colonne gauche : Historique des appels */}
      <section className="flex-1 min-w-0 flex flex-col gap-3 min-h-0">
        <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div>
            <h2 className="text-[15px] font-semibold text-[#f2f5f8]">
              Journal d&apos;appels
            </h2>
            <p className="text-[11.5px] text-[#788896]">
              {filteredCalls.length} appel{filteredCalls.length > 1 ? "s" : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-lg bg-[#14171c] border border-white/[0.08] p-0.5 text-[11.5px]">
              {(
                [
                  { id: "ALL", label: "Tous" },
                  { id: "MISSED", label: "Manqués" },
                  { id: "INCOMING", label: "Entrants" },
                  { id: "OUTGOING", label: "Sortants" },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilter(item.id)}
                  className={`h-7 px-2.5 rounded-md transition cursor-pointer ${
                    filter === item.id
                      ? "bg-white/[0.1] text-[#87CFF9] font-medium"
                      : "text-[#9cb1c2] hover:text-[#f2f5f8]"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => loadHistory()}
              disabled={loading}
              className="h-8 px-2.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[12px] text-[#d6e4ee] flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-[#87CFF9] ${loading ? "animate-spin" : ""}`}
              />
              Actualiser
            </button>
          </div>
        </div>

        <div className="relative shrink-0">
          <Search className="w-3.5 h-3.5 text-[#788896] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher un nom ou un numéro…"
            className="w-full h-8 pl-8 pr-2.5 rounded-lg bg-[#14171c] border border-white/[0.08] text-[12px] text-[#f2f5f8] placeholder:text-[#788896] focus:outline-none focus:border-[#87CFF9]/60"
          />
        </div>

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

        <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1">
          {loading && calls.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-[#9cb1c2]">
              <Loader2 className="w-5 h-5 animate-spin text-[#87CFF9]" />
              <span className="text-[12.5px]">Chargement du journal…</span>
            </div>
          ) : filteredCalls.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-[#788896]">
              <Phone className="w-7 h-7 text-[#87CFF9]/40" />
              <p className="text-[12.5px] text-[#b0cadc]">
                Aucun appel à afficher.
              </p>
            </div>
          ) : (
            filteredCalls.map((entry) => {
              const isCallable = entry.number !== "Numéro masqué";
              return (
                <div
                  key={entry.id}
                  className="group rounded-xl bg-[#232934]/65 hover:bg-[#232934] border border-white/[0.06] hover:border-white/[0.11] px-3.5 py-2.5 flex items-center justify-between gap-3 transition"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#14171c] border border-white/[0.08] flex items-center justify-center shrink-0">
                      {renderCallTypeIcon(entry.callType)}
                    </div>
                    <div className="min-w-0">
                      <div
                        className={`text-[13px] font-medium truncate ${
                          entry.callType === "MISSED"
                            ? "text-rose-300"
                            : "text-[#f2f5f8]"
                        }`}
                      >
                        {entry.contactName}
                      </div>
                      <div className="text-[11px] text-[#788896] flex items-center gap-1.5 truncate">
                        {entry.contactName !== entry.number && (
                          <>
                            <span className="font-mono-tabular">
                              {entry.number}
                            </span>
                            <span>•</span>
                          </>
                        )}
                        <span>
                          {formatCallDuration(entry.durationSec, entry.callType)}
                        </span>
                        <span>•</span>
                        <span className="font-mono-tabular">
                          {formatCallDate(entry.dateMs)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {isCallable && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          onStartSms(entry.contactName, entry.number)
                        }
                        title="Envoyer un SMS"
                        className="w-8 h-8 rounded-lg hover:bg-white/[0.08] text-[#b0cadc] hover:text-[#87CFF9] flex items-center justify-center transition cursor-pointer"
                      >
                        <MessageSquare className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        disabled={dialing}
                        onClick={() =>
                          handleDial(entry.number, entry.contactName)
                        }
                        title="Appeler sur le téléphone"
                        className="w-8 h-8 rounded-lg bg-[#005C7D]/60 hover:bg-[#005C7D] text-[#87CFF9] flex items-center justify-center transition cursor-pointer disabled:opacity-40"
                      >
                        <PhoneCall className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Colonne droite : Pavé numérique */}
      <aside className="w-[270px] shrink-0 border-l border-white/[0.07] pl-5 flex flex-col justify-center gap-4">
        <div className="space-y-2">
          <div className="text-[12px] font-semibold uppercase tracking-wider text-[#788896]">
            Composer un numéro
          </div>
          <div className="relative flex items-center">
            <input
              type="text"
              value={dialInput}
              onChange={(e) => setDialInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleDial(dialInput);
                }
              }}
              placeholder="Entrez un numéro…"
              className="w-full h-11 pl-3.5 pr-9 rounded-xl bg-[#14171c] border border-white/[0.1] text-[16px] font-mono-tabular text-[#f2f5f8] placeholder:text-[#788896] focus:outline-none focus:border-[#87CFF9]/60"
            />
            {dialInput && (
              <button
                type="button"
                onClick={() => setDialInput((prev) => prev.slice(0, -1))}
                title="Effacer"
                className="absolute right-2.5 text-[#9cb1c2] hover:text-white cursor-pointer"
              >
                <Delete className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {DIALPAD_KEYS.map((key) => (
            <button
              key={key.digit}
              type="button"
              onClick={() => setDialInput((prev) => prev + key.digit)}
              className="h-12 rounded-xl bg-[#232934]/80 hover:bg-[#2b3340] active:bg-[#005C7D]/60 border border-white/[0.07] flex flex-col items-center justify-center transition cursor-pointer"
            >
              <span className="text-[16px] font-semibold text-[#f2f5f8] leading-none">
                {key.digit}
              </span>
              {key.letters && (
                <span className="text-[9px] tracking-widest text-[#788896] mt-0.5">
                  {key.letters}
                </span>
              )}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={!dialInput.trim() || dialing}
          onClick={() => handleDial(dialInput)}
          className="h-10 rounded-xl bg-[#005C7D] hover:bg-[#00719a] disabled:opacity-40 text-[#f2f5f8] text-[13px] font-medium flex items-center justify-center gap-2 transition cursor-pointer"
        >
          {dialing ? (
            <Loader2 className="w-4 h-4 animate-spin text-[#87CFF9]" />
          ) : (
            <PhoneCall className="w-4 h-4 text-[#87CFF9]" />
          )}
          Appeler sur le téléphone
        </button>

        <p className="text-[11px] text-[#788896] text-center leading-snug">
          L&apos;appel démarre instantanément sur votre téléphone Android.
        </p>
      </aside>

      {/* Toast discret de confirmation d'appel */}
      {dialFeedback && (
        <div className="fixed bottom-5 right-5 z-40 rounded-xl bg-[#1b2028]/95 border border-emerald-500/35 shadow-2xl backdrop-blur-md px-3.5 py-2.5 flex items-center gap-2.5 text-[12.5px] text-[#f2f5f8]">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{dialFeedback}</span>
        </div>
      )}
    </div>
  );
}
