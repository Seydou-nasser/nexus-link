import { invoke } from "@tauri-apps/api/core";
import {
  Bluetooth,
  Headphones,
  Loader2,
  RefreshCw,
  Smartphone,
  Sparkles,
  X,
} from "lucide-react";
import type {
  BluetoothAudioStatus,
  ConnectedDevice,
  PendingPairingRequest,
} from "../types/protocol";

interface AppModalsProps {
  pendingPairing: PendingPairingRequest | null;
  connectedDevice: ConnectedDevice | null;
  disconnectConfirmOpen: boolean;
  commandPaletteOpen: boolean;
  btAudioModalOpen: boolean;
  btAudioStatus: BluetoothAudioStatus | null;
  btAudioBusy: boolean;
  btAudioError: string | null;
  onCloseBtAudioModal: () => void;
  onRefreshBtAudio: () => void;
  onConnectBtAudioDevice: (deviceId: string) => void;
  onDisconnectBtAudio: () => void;
  onOpenBtAudioModal: () => void;
  onRespondToPairing: (requestId: string, accepted: boolean) => void;
  onCloseDisconnectConfirm: () => void;
  onConfirmDisconnect: () => void;
  onCloseCommandPalette: () => void;
  onOpenMirror: () => void;
  onOpenExplorer: () => void;
  onRegenerateToken: () => void;
  onOpenSettings: () => void;
}

export function AppModals({
  pendingPairing,
  connectedDevice,
  disconnectConfirmOpen,
  commandPaletteOpen,
  btAudioModalOpen,
  btAudioStatus,
  btAudioBusy,
  btAudioError,
  onCloseBtAudioModal,
  onRefreshBtAudio,
  onConnectBtAudioDevice,
  onDisconnectBtAudio,
  onOpenBtAudioModal,
  onRespondToPairing,
  onCloseDisconnectConfirm,
  onConfirmDisconnect,
  onCloseCommandPalette,
  onOpenMirror,
  onOpenExplorer,
  onRegenerateToken,
  onOpenSettings,
}: AppModalsProps) {
  const connectedNameLower = connectedDevice?.deviceName?.toLowerCase() ?? "";
  const sortedBtDevices = [...(btAudioStatus?.devices ?? [])].sort((a, b) => {
    const aActive = btAudioStatus?.active && btAudioStatus.activeDeviceId === a.id ? 2 : 0;
    const bActive = btAudioStatus?.active && btAudioStatus.activeDeviceId === b.id ? 2 : 0;
    const aMatch =
      connectedNameLower &&
      (a.name.toLowerCase().includes(connectedNameLower) ||
        connectedNameLower.includes(a.name.toLowerCase()))
        ? 1
        : 0;
    const bMatch =
      connectedNameLower &&
      (b.name.toLowerCase().includes(connectedNameLower) ||
        connectedNameLower.includes(b.name.toLowerCase()))
        ? 1
        : 0;
    return bActive + bMatch - (aActive + aMatch);
  });

  return (
    <>
      {/* Boîte de confirmation d'association manuelle (sans QR Code) */}
      {pendingPairing && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#1b2028] border border-white/[0.12] shadow-2xl p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#005C7D] border border-[#87CFF9]/30 flex items-center justify-center text-[#87CFF9]">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-[#f2f5f8]">
                  Demande de connexion
                </h3>
                <p className="text-[12.5px] text-[#b0cadc]">
                  <strong className="text-[#f2f5f8]">
                    {pendingPairing.deviceName}
                  </strong>{" "}
                  souhaite se connecter à cet ordinateur.
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-[#14171c] border border-white/[0.08] p-4 text-center space-y-1.5">
              <div className="text-[12px] text-[#b0cadc]">
                Vérifiez que ce code correspond à celui affiché sur votre
                téléphone
              </div>
              <div className="text-3xl font-bold tracking-[0.28em] font-mono-tabular text-[#87CFF9] py-1">
                {pendingPairing.verificationCode}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() =>
                  onRespondToPairing(pendingPairing.requestId, false)
                }
                className="h-9 px-4 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[13px] text-[#d6e4ee] transition cursor-pointer"
              >
                Refuser
              </button>
              <button
                type="button"
                onClick={() =>
                  onRespondToPairing(pendingPairing.requestId, true)
                }
                className="h-9 px-4 rounded-lg bg-[#005C7D] hover:bg-[#00719a] text-[13px] font-medium text-[#f2f5f8] transition cursor-pointer"
              >
                Autoriser
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale de confirmation de déconnexion */}
      {disconnectConfirmOpen && connectedDevice && (
        <div
          onClick={onCloseDisconnectConfirm}
          className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-[#1b2028] border border-white/[0.12] shadow-2xl p-6 space-y-5"
          >
            <div className="space-y-1.5">
              <h3 className="text-[15px] font-semibold text-[#f2f5f8]">
                Déconnecter l&apos;appareil ?
              </h3>
              <p className="text-[13px] text-[#b0cadc]">
                Voulez-vous vraiment déconnecter et dissocier{" "}
                <strong className="text-[#f2f5f8]">
                  {connectedDevice.deviceName}
                </strong>{" "}
                de cet ordinateur ?
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onCloseDisconnectConfirm}
                className="h-9 px-4 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[13px] text-[#d6e4ee] transition cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={onConfirmDisconnect}
                className="h-9 px-4 rounded-lg bg-rose-500 hover:bg-rose-400 text-[13px] font-medium text-white transition cursor-pointer"
              >
                Déconnecter
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Palette de commandes rapides (Ctrl+K) */}
      {commandPaletteOpen && (
        <div
          onClick={onCloseCommandPalette}
          className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-start justify-center pt-20 z-50"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-xl bg-[#1b2028] border border-white/[0.12] shadow-2xl overflow-hidden"
          >
            <div className="px-3.5 py-2.5 border-b border-white/[0.07] flex items-center justify-between text-[12px] text-[#d6e4ee]">
              <span className="flex items-center gap-2 font-medium">
                <Sparkles className="w-3.5 h-3.5 text-[#87CFF9]" />
                Actions rapides NexusLink
              </span>
              <kbd className="text-[10px] font-mono-tabular text-[#788896]">
                Échap
              </kbd>
            </div>
            <div className="p-1.5 space-y-0.5 text-[12px]">
              <button
                type="button"
                onClick={() => {
                  onOpenMirror();
                  onCloseCommandPalette();
                }}
                disabled={!connectedDevice}
                className="w-full px-3 py-2 rounded-lg hover:bg-white/[0.06] disabled:opacity-40 flex items-center justify-between text-[#f2f5f8] cursor-pointer"
              >
                <span>Ouvrir l&apos;écran du téléphone</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onOpenExplorer();
                  onCloseCommandPalette();
                }}
                disabled={!connectedDevice}
                className="w-full px-3 py-2 rounded-lg hover:bg-white/[0.06] disabled:opacity-40 flex items-center justify-between text-[#f2f5f8] cursor-pointer"
              >
                <span>Ouvrir l&apos;Explorateur de fichiers</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  invoke("pick_and_send_files");
                  onCloseCommandPalette();
                }}
                disabled={!connectedDevice}
                className="w-full px-3 py-2 rounded-lg hover:bg-white/[0.06] disabled:opacity-40 flex items-center justify-between text-[#f2f5f8] cursor-pointer"
              >
                <span>Envoyer des fichiers vers le téléphone</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onRegenerateToken();
                  onCloseCommandPalette();
                }}
                className="w-full px-3 py-2 rounded-lg hover:bg-white/[0.06] flex items-center justify-between text-[#f2f5f8] cursor-pointer"
              >
                <span>Générer un nouveau QR Code d&apos;association</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onOpenBtAudioModal();
                  onCloseCommandPalette();
                }}
                className="w-full px-3 py-2 rounded-lg hover:bg-white/[0.06] flex items-center justify-between text-[#f2f5f8] cursor-pointer"
              >
                <span>Audio du téléphone sur PC (Bluetooth)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onOpenSettings();
                  onCloseCommandPalette();
                }}
                className="w-full px-3 py-2 rounded-lg hover:bg-white/[0.06] flex items-center justify-between text-[#f2f5f8] cursor-pointer"
              >
                <span>Ouvrir les paramètres</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale de sélection d'appareil Audio Bluetooth (A2DP Sink) */}
      {btAudioModalOpen && (
        <div
          onClick={onCloseBtAudioModal}
          className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-[#1b2028] border border-white/[0.12] shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${
                    btAudioStatus?.active
                      ? "bg-[#005C7D]/70 border-[#87CFF9]/45 text-[#87CFF9]"
                      : "bg-white/[0.05] border-white/[0.1] text-[#b0cadc]"
                  }`}
                >
                  <Headphones className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold text-[#f2f5f8]">
                    Audio du téléphone sur PC
                  </h3>
                  <p className="text-[12px] text-[#9cb1c2]">
                    Choisissez l&apos;appareil Bluetooth dont vous souhaitez
                    diffuser le son sur ce PC.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onCloseBtAudioModal}
                title="Fermer"
                className="w-7 h-7 rounded-lg hover:bg-white/[0.08] flex items-center justify-center text-[#9cb1c2] hover:text-white transition cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span
                className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium ${
                  btAudioStatus?.active
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-white/[0.06] text-[#9cb1c2]"
                }`}
              >
                {btAudioStatus?.active
                  ? `Actif • ${btAudioStatus.activeDeviceName ?? "Bluetooth"}`
                  : "Aucun flux audio actif"}
              </span>

              <button
                type="button"
                disabled={btAudioBusy}
                onClick={onRefreshBtAudio}
                className="h-7 px-2.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[11.5px] text-[#d6e4ee] flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3 h-3 text-[#87CFF9] ${btAudioBusy ? "animate-spin" : ""}`}
                />
                Actualiser
              </button>
            </div>

            {btAudioError && (
              <div className="rounded-xl bg-rose-500/15 border border-rose-500/30 px-3.5 py-2.5 text-[12px] text-rose-200 leading-snug">
                {btAudioError}
              </div>
            )}

            {sortedBtDevices.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {sortedBtDevices.map((device) => {
                  const isThisActive =
                    btAudioStatus?.active &&
                    btAudioStatus.activeDeviceId === device.id;
                  const isConnectedPhone =
                    Boolean(connectedNameLower) &&
                    (device.name.toLowerCase().includes(connectedNameLower) ||
                      connectedNameLower.includes(device.name.toLowerCase()));

                  return (
                    <div
                      key={device.id}
                      className={`rounded-xl px-3.5 py-2.5 border flex items-center justify-between gap-3 ${
                        isThisActive
                          ? "bg-[#005C7D]/35 border-[#87CFF9]/40"
                          : "bg-[#14171c]/80 border-white/[0.07]"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Bluetooth
                          className={`w-4 h-4 shrink-0 ${
                            isThisActive ? "text-[#87CFF9]" : "text-[#788896]"
                          }`}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[13px] font-medium text-[#f2f5f8] truncate">
                              {device.name}
                            </span>
                            {isConnectedPhone && (
                              <span className="px-1.5 py-0.5 rounded bg-[#005C7D]/70 text-[#87CFF9] text-[10px] font-medium shrink-0">
                                Wi-Fi
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-[#788896]">
                            {isThisActive
                              ? "Diffusion audio en cours sur ce PC"
                              : "Périphérique Bluetooth jumelé"}
                          </div>
                        </div>
                      </div>

                      {isThisActive ? (
                        <button
                          type="button"
                          disabled={btAudioBusy}
                          onClick={onDisconnectBtAudio}
                          className="h-8 px-3 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-[12px] font-medium flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 shrink-0"
                        >
                          {btAudioBusy && (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          )}
                          Couper
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={btAudioBusy}
                          onClick={() => onConnectBtAudioDevice(device.id)}
                          className="h-8 px-3 rounded-lg bg-[#005C7D] hover:bg-[#00719a] text-[#f2f5f8] text-[12px] font-medium flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 shrink-0"
                        >
                          {btAudioBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#87CFF9]" />
                          ) : (
                            <Headphones className="w-3.5 h-3.5 text-[#87CFF9]" />
                          )}
                          Connecter
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl bg-[#14171c]/80 border border-white/[0.07] px-4 py-4 text-[12px] text-[#9cb1c2] leading-relaxed">
                Aucun appareil Bluetooth compatible détecté. Jumelez
                d&apos;abord votre téléphone dans{" "}
                <strong className="text-[#f2f5f8]">
                  Paramètres Windows → Bluetooth et appareils
                </strong>
                , puis cliquez sur{" "}
                <strong className="text-[#f2f5f8]">Actualiser</strong>.
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={onCloseBtAudioModal}
                className="h-9 px-4 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[13px] text-[#d6e4ee] transition cursor-pointer"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
