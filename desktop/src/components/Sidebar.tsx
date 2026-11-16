import {
  BatteryCharging,
  Bell,
  FolderSync,
  LayoutGrid,
  MonitorPlay,
  MousePointerClick,
  Smartphone,
  Unplug,
} from "lucide-react";
import type { ConnectedDevice } from "../types/protocol";

export type NavSectionId =
  | "overview"
  | "input"
  | "notifications"
  | "files"
  | "mirror";

interface SidebarProps {
  activeSection: NavSectionId;
  onSelectSection: (section: NavSectionId) => void;
  connectedDevice: ConnectedDevice | null;
  onSimulateDevice: () => void;
  onDisconnectDevice: () => void;
}

interface NavItem {
  id: NavSectionId;
  label: string;
  shortcut: string;
  badge?: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: "overview",
    label: "Liaison & Appareil",
    shortcut: "Alt+1",
    icon: LayoutGrid,
  },
  {
    id: "input",
    label: "Souris & Clavier",
    shortcut: "Alt+2",
    badge: "120Hz",
    icon: MousePointerClick,
  },
  {
    id: "notifications",
    label: "Notifications",
    shortcut: "Alt+3",
    icon: Bell,
  },
  {
    id: "files",
    label: "Fichiers & Presse-papiers",
    shortcut: "Alt+4",
    icon: FolderSync,
  },
  {
    id: "mirror",
    label: "Recopie d'écran",
    shortcut: "Alt+5",
    icon: MonitorPlay,
  },
];

export function Sidebar({
  activeSection,
  onSelectSection,
  connectedDevice,
  onSimulateDevice,
  onDisconnectDevice,
}: SidebarProps) {
  return (
    <aside className="w-56 h-full bg-[#0e1015]/90 border-r border-white/[0.065] flex flex-col justify-between shrink-0">
      {/* Navigation principale */}
      <div className="p-2.5 space-y-4">
        <div>
          <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Poste de contrôle
          </div>
          <nav className="space-y-0.5 mt-0.5">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectSection(item.id)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-[12px] transition cursor-pointer ${
                    isActive
                      ? "bg-white/[0.08] text-zinc-100 font-medium shadow-[inset_2px_0_0_#6366f1]"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.035]"
                  }`}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <Icon
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isActive ? "text-indigo-400" : "text-zinc-500"
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </span>

                  {item.badge ? (
                    <span className="text-[10px] font-mono-tabular px-1.5 py-0.2 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                      {item.badge}
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono-tabular text-zinc-600">
                      {item.shortcut}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Dock inférieur : État matériel du smartphone */}
      <div className="p-2.5 border-t border-white/[0.065] bg-[#0b0c10]/80">
        {connectedDevice ? (
          <div className="rounded-lg bg-[#14161d] border border-white/[0.07] p-2.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-md bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400 shrink-0">
                  <Smartphone className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-zinc-100 truncate">
                    {connectedDevice.deviceName}
                  </div>
                  <div className="text-[10px] font-mono-tabular text-zinc-400 truncate">
                    {connectedDevice.ipAddress}
                  </div>
                </div>
              </div>
              <button
                onClick={onDisconnectDevice}
                title="Déconnecter l'appareil"
                className="p-1.5 rounded hover:bg-rose-500/15 text-zinc-400 hover:text-rose-300 transition cursor-pointer"
              >
                <Unplug className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center justify-between pt-1.5 border-t border-white/[0.05] text-[11px]">
              <span className="flex items-center gap-1.5 text-zinc-300 font-mono-tabular">
                <BatteryCharging className="w-3.5 h-3.5 text-emerald-400" />
                {connectedDevice.batteryLevel}%
              </span>
              <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                LAN Direct
              </span>
            </div>
          </div>
        ) : (
          <div className="rounded-lg bg-[#12141a] border border-white/[0.06] p-2.5 space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-zinc-400">Aucun téléphone actif</span>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400/80" />
            </div>
            <button
              onClick={onSimulateDevice}
              className="w-full py-1.5 px-2.5 rounded bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.08] text-[11px] font-medium text-zinc-200 transition cursor-pointer"
            >
              Simuler Pixel 8 Pro
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
