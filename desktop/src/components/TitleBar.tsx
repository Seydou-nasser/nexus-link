import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Smartphone, Square, X } from "lucide-react";

export function TitleBar() {
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

  return (
    <header
      data-tauri-drag-region
      className="h-9 w-full flex items-center justify-between bg-[#14171c]/95 pl-3.5 select-none shrink-0"
    >
      {/* Identité minimale à gauche façon Mobile connecté */}
      <div data-tauri-drag-region className="flex items-center gap-2">
        <div className="w-4 h-4 rounded flex items-center justify-center bg-[#005C7D] text-[#87CFF9]">
          <Smartphone className="w-2.5 h-2.5" />
        </div>
        <span
          data-tauri-drag-region
          className="text-[12px] font-medium tracking-tight text-[#f2f5f8]"
        >
          NexusLink
        </span>
      </div>

      {/* Boutons de fenêtre Windows 11 à droite */}
      <div className="flex items-center h-full">
        <button
          onClick={handleMinimize}
          title="Réduire"
          className="h-full w-11 flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition cursor-pointer"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={handleToggleMaximize}
          title={isMaximized ? "Restaurer" : "Agrandir"}
          className="h-full w-11 flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition cursor-pointer"
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
          className="h-full w-11 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-rose-600/90 transition cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
}
