import { invoke } from "@tauri-apps/api/core";
import { FileUp, FolderOpen } from "lucide-react";
import type { FileTransferRecord } from "../types/protocol";

interface TransfersPanelProps {
  connectedDeviceName: string | null;
  fileTransfers: FileTransferRecord[];
  isDraggingFile: boolean;
  formatFileSize: (bytes: number) => string;
  formatLocalTime: (raw: string) => string;
}

export function TransfersPanel({
  connectedDeviceName,
  fileTransfers,
  isDraggingFile,
  formatFileSize,
  formatLocalTime,
}: TransfersPanelProps) {
  const isConnected = Boolean(connectedDeviceName);

  return (
    <div className="h-full flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div>
          <h2 className="text-[16px] font-semibold text-[#f2f5f8]">
            Transferts de fichiers
          </h2>
          <p className="text-[12px] text-[#b0cadc]">
            Envoyez et recevez des photos, vidéos ou documents instantanément
            sur le Wi-Fi local.
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
            disabled={!isConnected}
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
        disabled={!isConnected}
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
            <strong className="text-[#87CFF9]">{connectedDeviceName}</strong>
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
                      Math.round((transferred / item.fileSize) * 100),
                    )
                  : 0;
              return (
                <div
                  key={item.fileId}
                  onClick={() => {
                    if (canOpen && item.savedPath) {
                      invoke("open_local_file", { path: item.savedPath });
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
                          {item.direction === "SENT" ? "Envoyé" : "Reçu"} •{" "}
                          {isPending && item.fileSize > 0
                            ? `${formatFileSize(transferred)} / ${formatFileSize(item.fileSize)}`
                            : formatFileSize(item.fileSize)}{" "}
                          • {formatLocalTime(item.timestamp)}
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
  );
}
