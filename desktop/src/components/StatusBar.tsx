import { Activity, Cpu, Radio, Shield, Wifi } from "lucide-react";
import type { ServerStatus } from "../types/protocol";

interface StatusBarProps {
  status: ServerStatus;
}

export function StatusBar({ status }: StatusBarProps) {
  const primaryIp = status.localIps[0] ?? "127.0.0.1";

  return (
    <footer className="h-6 w-full bg-[#090a0d] border-t border-white/[0.065] px-3 flex items-center justify-between text-[11px] text-zinc-400 select-none shrink-0 font-mono-tabular">
      {/* Indicateurs sockets et découverte à gauche */}
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              status.mdnsActive ? "bg-emerald-400" : "bg-amber-400"
            }`}
          />
          <Radio className="w-3 h-3 text-zinc-500" />
          <span>mDNS _nexuslink._tcp</span>
        </span>

        <span className="text-zinc-700">|</span>

        <span className="flex items-center gap-1.5">
          <Wifi className="w-3 h-3 text-indigo-400" />
          <span>WS :{status.wsPort}</span>
          <span className="text-zinc-600">•</span>
          <span>UDP :{status.udpPort}</span>
          <span className="text-zinc-600">•</span>
          <span>HTTP :{status.httpPort}</span>
        </span>
      </div>

      {/* Télémétrie et sécurité à droite */}
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5 text-zinc-400">
          <Activity className="w-3 h-3 text-emerald-400" />
          <span>
            {status.connectedDevice ? "Latence UDP ~0.8 ms" : "Canal veille"}
          </span>
        </span>

        <span className="text-zinc-700">|</span>

        <span className="flex items-center gap-1.5">
          <Shield className="w-3 h-3 text-zinc-500" />
          <span>IP {primaryIp}</span>
        </span>

        <span className="text-zinc-700">|</span>

        <span className="flex items-center gap-1 text-zinc-500">
          <Cpu className="w-3 h-3" />
          <span>Rust Tokio v1</span>
        </span>
      </div>
    </footer>
  );
}
