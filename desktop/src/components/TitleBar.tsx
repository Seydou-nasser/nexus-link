import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Search, Square, X, Zap } from "lucide-react";
import type { ServerStatus } from "../types/protocol";

interface TitleBarProps {
  status: ServerStatus;
  onOpenCommandPalette: () => void;
}

export function TitleBar({ status, onOpenCommandPalette }: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState<boolean>(false);
  const appWindow = getCurrentWindow();

  const handleMinimize = async () => {
    await appWindow.minimize();
  };

  const handleToggleMaximize = async () => {
    await appWindow.toggleMaximize();
    const maximized = await appWindow.isMaximized();
    setIsMaximized(maximized);
  };

  const handleCloseToTray = async () => {
    await appWindow.hide();
  };

  const isConnected = Boolean(status.connectedDevice);

  return (
    <header
      data-tauri-drag-region
      className="h-10 w-full flex items-center justify-between bg-[#0a0b0e]/95 border-b border-white/[0.065] pl-3 select-none shrink-0"
    >
      {/* Identité de l'application à gauche */}
      <div data-tauri-drag-region className="flex items-center gap-2.5">
        <div className="w-5 h-5 rounded-md bg-indigo-500/15 border border-indigo-400/30 flex items-center justify-center text-indigo-400">
          <Zap className="w-3.5 h-3.5" />
        </div>
        <span
          data-tauri-drag-region
          className="text-[13px] font-semibold tracking-tight text-zinc-100"
        >
          NexusLink
        </span>
        <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/[0.04] text-zinc-400 border border-white/[0.06]">
          {status.deviceName}
        </span>
        {isConnected && (
          <div className="flex items-center gap-1.5 ml-1 pl-2.5 border-l border-white/[0.06]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981]" />
            <span className="text-[12px] text-zinc-300">
              {status.connectedDevice?.deviceName}
            </span>
          </div>
        )}
      </div>

      {/* Barre de commande rapide centrale */}
      <button
        onClick={onOpenCommandPalette}
        className="h-7 px-3 rounded-md bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.065] flex items-center gap-6 text-[12px] text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
      >
        <span className="flex items-center gap-1.5">
          <Search className="w-3.5 h-3.5 text-zinc-500" />
          Actions rapides…
        </span>
        <kbd className="text-[11px] font-mono-tabular text-zinc-500 bg-white/[0.04] px-1.5 py-0.2 rounded border border-white/[0.06]">
          Ctrl K
        </kbd>
      </button>

      {/* Boutons de fenêtre Windows 11 à droite */}
      <div className="flex items-center h-full">
        <button
          onClick={handleMinimize}
          title="Réduire"
          className="h-full w-11 flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={handleToggleMaximize}
          title={isMaximized ? "Restaurer" : "Agrandir"}
          className="h-full w-11 flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition"
        >
          {isMaximized ? (
            <Copy className="w-3 h-3" />
          ) : (
            <Square className="w-3 h-3" />
          )}
        </button>

        <button
          onClick={handleCloseToTray}
          title="Réduire dans la barre des tâches"
          className="h-full w-11 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-rose-600/90 transition"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
}
