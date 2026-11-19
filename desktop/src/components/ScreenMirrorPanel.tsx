import { ExternalLink, Loader2, MonitorPlay, Play, Square } from "lucide-react";
import type { ServerStatus } from "../types/protocol";

interface ScreenMirrorPanelProps {
  status: ServerStatus;
  onStartMirror: () => Promise<void>;
  onStopMirror: () => Promise<void>;
  onFocusWindow: () => Promise<void>;
}

export function ScreenMirrorPanel({
  status,
  onStartMirror,
  onStopMirror,
  onFocusWindow,
}: ScreenMirrorPanelProps) {
  const isConnected = Boolean(status.connectedDevice);
  const isWaiting = status.mirrorState === "WAITING_PERMISSION";
  const isActive = status.mirrorState === "ACTIVE";
  const isError = status.mirrorState === "ERROR";

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="rounded-xl bg-[#111319] border border-white/[0.07] p-6 space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center text-indigo-400 shrink-0">
              <MonitorPlay className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-[14px] font-medium text-zinc-100">
                Écran du téléphone dans une fenêtre dédiée
              </h2>
              <p className="text-[12px] text-zinc-400 mt-0.5">
                Projetez l&apos;écran de votre téléphone dans une fenêtre flottante
                indépendante et contrôlez-le directement à la souris et au clavier.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-[#0b0c10] border border-white/[0.06] p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-[12px] text-zinc-300">
            {isWaiting ? (
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400 shrink-0" />
            ) : (
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  isActive
                    ? "bg-emerald-400"
                    : isError
                      ? "bg-rose-400"
                      : "bg-zinc-500"
                }`}
              />
            )}
            <span>
              {!isConnected && "Connectez votre téléphone pour démarrer la recopie."}
              {isConnected &&
                status.mirrorState === "STOPPED" &&
                "Prêt — la fenêtre séparée s'ouvrira automatiquement."}
              {isConnected &&
                isWaiting &&
                "Acceptez la demande de partage d'écran sur votre téléphone…"}
              {isConnected &&
                isActive &&
                `Fenêtre de recopie active${
                  status.mirrorWidth > 0
                    ? ` (${status.mirrorWidth}×${status.mirrorHeight})`
                    : ""
                }`}
              {isConnected &&
                isError &&
                (status.mirrorError || "Impossible de démarrer la capture d'écran.")}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {(isActive || isWaiting) && (
              <button
                onClick={onFocusWindow}
                className="h-8 px-3 rounded-md bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.08] text-[12px] text-zinc-200 flex items-center gap-1.5 transition cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Afficher la fenêtre
              </button>
            )}

            {isActive || isWaiting ? (
              <button
                onClick={onStopMirror}
                className="h-8 px-3.5 rounded-md bg-rose-500 hover:bg-rose-400 text-[12px] font-medium text-white flex items-center gap-1.5 transition cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                Arrêter
              </button>
            ) : (
              <button
                disabled={!isConnected}
                onClick={onStartMirror}
                className="h-8 px-3.5 rounded-md bg-indigo-500 hover:bg-indigo-400 disabled:bg-white/[0.06] disabled:text-zinc-500 text-[12px] font-medium text-white flex items-center gap-1.5 transition cursor-pointer disabled:cursor-not-allowed"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                Ouvrir l&apos;écran du téléphone
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
