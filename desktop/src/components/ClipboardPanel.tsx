import { Send } from "lucide-react";
import type { ClipboardHistoryEntry } from "../types/protocol";

interface ClipboardPanelProps {
  clipboardDraft: string;
  clipboardHistory: ClipboardHistoryEntry[];
  onChangeDraft: (value: string) => void;
  onSendDraft: () => void;
  formatLocalTime: (raw: string) => string;
}

export function ClipboardPanel({
  clipboardDraft,
  clipboardHistory,
  onChangeDraft,
  onSendDraft,
  formatLocalTime,
}: ClipboardPanelProps) {
  return (
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
          onSendDraft();
        }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          value={clipboardDraft}
          onChange={(e) => onChangeDraft(e.target.value)}
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
          Aucun élément synchronisé pour le moment. Essayez un Ctrl+C !
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
                  {formatLocalTime(entry.timestamp)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
