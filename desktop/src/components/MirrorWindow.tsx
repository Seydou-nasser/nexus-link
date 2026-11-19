import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowLeft,
  Home,
  Loader2,
  Minus,
  MoreHorizontal,
  Pin,
  PinOff,
  RefreshCw,
  Smartphone,
  Square,
  X,
} from "lucide-react";
import type { ServerStatus } from "../types/protocol";
import {
  EVENT_KEY_EVENT,
  EVENT_MOUSE_BUTTON,
  EVENT_MOUSE_MOVE,
  EVENT_MOUSE_WHEEL,
  FLAG_ABSOLUTE,
  FLAG_RELATIVE,
  mapDomKeyToVirtualKey,
} from "../utils/mirrorInput";
import "../App.css";

export function MirrorWindow() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState<boolean>(false);
  const [isMaximized, setIsMaximized] = useState<boolean>(false);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [streamEpoch, setStreamEpoch] = useState<number>(1);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const buttonMaskRef = useRef<number>(0);
  const lastMoveSentRef = useRef<number>(0);
  const sendChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const appWindow = getCurrentWindow();

  useEffect(() => {
    invoke<ServerStatus>("get_server_status")
      .then(setStatus)
      .catch(() => {});

    const unlistenPromise = listen<ServerStatus>(
      "nexus://state-updated",
      (event) => {
        setStatus(event.payload);
      },
    );

    const handleGlobalRelease = () => {
      if (buttonMaskRef.current !== 0) {
        buttonMaskRef.current = 0;
        invoke<boolean>("send_mirror_input", {
          eventType: EVENT_MOUSE_BUTTON,
          dxOrCode: 0,
          dyOrMods: 0,
          buttonState: 0,
          flags: FLAG_RELATIVE,
        }).catch(() => {});
      }
    };

    window.addEventListener("pointerup", handleGlobalRelease);
    window.addEventListener("blur", handleGlobalRelease);

    return () => {
      window.removeEventListener("pointerup", handleGlobalRelease);
      window.removeEventListener("blur", handleGlobalRelease);
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const sendInput = (
    eventType: number,
    dxOrCode: number,
    dyOrMods: number,
    btnState: number,
    flags: number,
  ) => {
    sendChainRef.current = sendChainRef.current
      .then(() =>
        invoke<boolean>("send_mirror_input", {
          eventType,
          dxOrCode,
          dyOrMods,
          buttonState: btnState,
          flags,
        }),
      )
      .catch(() => {});
  };

  const triggerNavButton = (bitMask: number) => {
    sendInput(EVENT_MOUSE_BUTTON, 0, 0, bitMask, FLAG_RELATIVE);
    setTimeout(() => {
      sendInput(EVENT_MOUSE_BUTTON, 0, 0, 0, FLAG_RELATIVE);
    }, 30);
  };

  const handleToggleAlwaysOnTop = async () => {
    const next = !isAlwaysOnTop;
    try {
      await appWindow.setAlwaysOnTop(next);
      setIsAlwaysOnTop(next);
    } catch (error) {
      console.error("Impossible de changer l'épinglage :", error);
    }
    setMenuOpen(false);
  };

  const handleClose = async () => {
    await invoke<boolean>("stop_screen_mirror").catch(() => false);
    await appWindow.close().catch(() => {});
  };

  const handleToggleMaximize = async () => {
    await appWindow.toggleMaximize();
    const max = await appWindow.isMaximized();
    setIsMaximized(max);
  };

  const computeNormalized = (clientX: number, clientY: number) => {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const nx = Math.max(
      0,
      Math.min(10000, Math.round(((clientX - rect.left) / rect.width) * 10000)),
    );
    const ny = Math.max(
      0,
      Math.min(10000, Math.round(((clientY - rect.top) / rect.height) * 10000)),
    );
    return { nx, ny };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    if (status?.mirrorState !== "ACTIVE") return;
    e.preventDefault();
    e.currentTarget.focus();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore capture errors
    }

    const pos = computeNormalized(e.clientX, e.clientY);
    if (!pos) return;

    let nextMask = buttonMaskRef.current;
    if (e.button === 0) nextMask |= 0x01;
    else if (e.button === 2) nextMask |= 0x02;
    else if (e.button === 1) nextMask |= 0x04;

    buttonMaskRef.current = nextMask;
    sendInput(EVENT_MOUSE_BUTTON, pos.nx, pos.ny, nextMask, FLAG_ABSOLUTE);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLImageElement>) => {
    if (status?.mirrorState !== "ACTIVE") return;
    const now = performance.now();
    if (now - lastMoveSentRef.current < 8) return;
    lastMoveSentRef.current = now;

    const pos = computeNormalized(e.clientX, e.clientY);
    if (!pos) return;
    sendInput(
      EVENT_MOUSE_MOVE,
      pos.nx,
      pos.ny,
      buttonMaskRef.current,
      FLAG_ABSOLUTE,
    );
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLImageElement>) => {
    if (status?.mirrorState !== "ACTIVE") return;
    const pos = computeNormalized(e.clientX, e.clientY);
    let nextMask = buttonMaskRef.current;
    if (e.button === 0) nextMask &= ~0x01;
    else if (e.button === 2) nextMask &= ~0x02;
    else if (e.button === 1) nextMask &= ~0x04;

    buttonMaskRef.current = nextMask;
    if (pos) {
      sendInput(EVENT_MOUSE_BUTTON, pos.nx, pos.ny, nextMask, FLAG_ABSOLUTE);
    } else {
      sendInput(EVENT_MOUSE_BUTTON, 0, 0, nextMask, FLAG_RELATIVE);
    }
  };

  const handlePointerCancel = () => {
    if (buttonMaskRef.current === 0) return;
    buttonMaskRef.current = 0;
    sendInput(EVENT_MOUSE_BUTTON, 0, 0, 0, FLAG_RELATIVE);
  };

  const handleWheel = (e: React.WheelEvent<HTMLImageElement>) => {
    if (status?.mirrorState !== "ACTIVE") return;
    e.preventDefault();
    const pos = computeNormalized(e.clientX, e.clientY);
    if (pos) {
      sendInput(
        EVENT_MOUSE_MOVE,
        pos.nx,
        pos.ny,
        buttonMaskRef.current,
        FLAG_ABSOLUTE,
      );
    }
    const delta = e.deltaY < 0 ? 2 : -2;
    sendInput(EVENT_MOUSE_WHEEL, 0, delta, buttonMaskRef.current, FLAG_RELATIVE);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLImageElement>) => {
    if (status?.mirrorState !== "ACTIVE") return;
    const mapped = mapDomKeyToVirtualKey(e.key);
    if (!mapped) return;
    e.preventDefault();
    const mods = mapped.shift || e.shiftKey ? 0x02 : 0x00;
    sendInput(EVENT_KEY_EVENT, mapped.vk, mods, 1, FLAG_RELATIVE);
  };

  const isConnected = Boolean(status?.connectedDevice);
  const isWaiting = status?.mirrorState === "WAITING_PERMISSION";
  const isActive = status?.mirrorState === "ACTIVE";
  const isError = status?.mirrorState === "ERROR";

  const streamUrl = status
    ? `http://127.0.0.1:${status.httpPort}/api/v1/screen/stream?token=${encodeURIComponent(
        status.pairingToken,
      )}&epoch=${streamEpoch}`
    : "";

  return (
    <div
      onClick={() => setMenuOpen(false)}
      className="h-screen w-screen flex flex-col bg-[#121318]/95 text-zinc-100 overflow-hidden select-none border border-white/[0.08]"
    >
      {/* Barre de titre compacte style fenêtre dédiée */}
      <header
        data-tauri-drag-region
        className="h-9 w-full flex items-center justify-between bg-[#1b1c22]/95 border-b border-white/[0.07] pl-1 shrink-0 relative z-20"
      >
        {/* Gauche : bouton Retour Android + icône + titre déplaçable */}
        <div
          data-tauri-drag-region
          className="flex items-center gap-1.5 min-w-0 flex-1 pr-2"
        >
          <button
            onClick={() => triggerNavButton(0x02)}
            disabled={!isActive}
            title="Retour Android"
            className="h-7 w-7 rounded flex items-center justify-center text-zinc-300 hover:bg-white/[0.08] disabled:opacity-40 transition shrink-0 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>

          <div
            data-tauri-drag-region
            className="flex items-center gap-1.5 min-w-0"
          >
            <div className="w-4 h-4 rounded flex items-center justify-center bg-sky-500/20 text-sky-400 shrink-0">
              <Smartphone className="w-3 h-3" />
            </div>
            <span
              data-tauri-drag-region
              className="text-[12px] font-medium text-zinc-200 truncate"
            >
              Écran du téléphone
            </span>
          </div>
        </div>

        {/* Droite : menu ···, réduire, agrandir, fermer */}
        <div className="flex items-center h-full shrink-0 relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            title="Options de la fenêtre"
            className="h-full w-9 flex items-center justify-center text-zinc-300 hover:bg-white/[0.08] transition cursor-pointer"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>

          {menuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute right-1 top-9 w-52 rounded-lg bg-[#1d1f27] border border-white/[0.12] shadow-2xl p-1 text-[12px] z-50"
            >
              <button
                onClick={handleToggleAlwaysOnTop}
                className="w-full px-2.5 py-1.5 rounded hover:bg-white/[0.08] flex items-center justify-between text-zinc-200 cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  {isAlwaysOnTop ? (
                    <PinOff className="w-3.5 h-3.5 text-indigo-400" />
                  ) : (
                    <Pin className="w-3.5 h-3.5 text-zinc-400" />
                  )}
                  Toujours au premier plan
                </span>
              </button>

              <button
                disabled={!isActive}
                onClick={() => {
                  triggerNavButton(0x04);
                  setMenuOpen(false);
                }}
                className="w-full px-2.5 py-1.5 rounded hover:bg-white/[0.08] disabled:opacity-40 flex items-center gap-2 text-zinc-200 cursor-pointer"
              >
                <Home className="w-3.5 h-3.5 text-zinc-400" />
                Accueil Android
              </button>

              <button
                disabled={!isActive}
                onClick={() => {
                  setStreamEpoch((v) => v + 1);
                  setMenuOpen(false);
                }}
                className="w-full px-2.5 py-1.5 rounded hover:bg-white/[0.08] disabled:opacity-40 flex items-center gap-2 text-zinc-200 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 text-zinc-400" />
                Actualiser le flux
              </button>
            </div>
          )}

          <button
            onClick={() => appWindow.minimize()}
            title="Réduire"
            className="h-full w-9 flex items-center justify-center text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-100 transition cursor-pointer"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={handleToggleMaximize}
            title={isMaximized ? "Restaurer" : "Agrandir"}
            className="h-full w-9 flex items-center justify-center text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-100 transition cursor-pointer"
          >
            <Square className="w-3 h-3" />
          </button>

          <button
            onClick={handleClose}
            title="Fermer et arrêter la recopie"
            className="h-full w-10 flex items-center justify-center text-zinc-400 hover:bg-rose-600 hover:text-white transition cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Flux vidéo plein cadre */}
      <main className="flex-1 min-h-0 bg-[#0b0c10] flex items-center justify-center overflow-hidden">
        {!isActive ? (
          <div className="flex flex-col items-center justify-center text-center px-6 space-y-3">
            <div className="w-11 h-11 rounded-full bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-zinc-400">
              {isWaiting ? (
                <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
              ) : (
                <Smartphone className="w-5 h-5" />
              )}
            </div>
            <div className="text-[13px] font-medium text-zinc-200">
              {!isConnected && "Téléphone déconnecté"}
              {isConnected &&
                isWaiting &&
                "Autorisation requise sur le téléphone…"}
              {isConnected && isError && "Partage d'écran interrompu"}
              {isConnected &&
                status?.mirrorState === "STOPPED" &&
                "Recopie d'écran arrêtée"}
            </div>
            <p className="text-[12px] text-zinc-500 max-w-xs">
              {isWaiting &&
                "Appuyez sur « Commencer maintenant » sur votre téléphone pour afficher l'écran."}
              {isError &&
                (status?.mirrorError ||
                  "L'autorisation de capture a été refusée ou interrompue.")}
              {isConnected &&
                status?.mirrorState === "STOPPED" &&
                "Cliquez ci-dessous pour relancer la diffusion."}
            </p>
            {isConnected && !isWaiting && (
              <button
                onClick={() => {
                  setStreamEpoch((v) => v + 1);
                  invoke("start_screen_mirror").catch(() => {});
                }}
                className="h-8 px-4 rounded-md bg-indigo-500 hover:bg-indigo-400 text-[12px] font-medium text-white transition cursor-pointer"
              >
                Démarrer
              </button>
            )}
          </div>
        ) : (
          <img
            ref={imgRef}
            src={streamUrl}
            alt="Écran du téléphone Android"
            tabIndex={0}
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onWheel={handleWheel}
            onKeyDown={handleKeyDown}
            className="max-w-full max-h-full w-auto h-auto select-none cursor-touch outline-none"
          />
        )}
      </main>
    </div>
  );
}
