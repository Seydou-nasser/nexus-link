import { ShieldCheck, Wifi } from "lucide-react";
import type { ServerStatus } from "../types/protocol";

interface StatusBarProps {
  status: ServerStatus;
}

export function StatusBar({ status }: StatusBarProps) {
  const isReady = status.mdnsActive && status.wsListening;

  return (
    <footer className="h-7 w-full bg-[#090a0d] border-t border-white/[0.065] px-3 flex items-center justify-between text-[12px] text-zinc-400 select-none shrink-0">
      {/* État de disponibilité à gauche */}
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isReady ? "bg-emerald-400" : "bg-amber-400"
            }`}
          />
          <Wifi className="w-3 h-3 text-zinc-500" />
          <span>
            {isReady
              ? "Prêt sur votre réseau Wi-Fi"
              : "Initialisation du réseau…"}
          </span>
        </span>
      </div>

      {/* Sécurité et état de connexion à droite */}
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5 text-zinc-400">
          <ShieldCheck className="w-3 h-3 text-emerald-400" />
          <span>Connexion locale privée</span>
        </span>

        {status.connectedDevice && (
          <>
            <span className="text-zinc-700">|</span>
            <span className="text-zinc-400">
              Relié à {status.connectedDevice.deviceName}
            </span>
          </>
        )}
      </div>
    </footer>
  );
}
