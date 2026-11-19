import { invoke } from "@tauri-apps/api/core";
import { Smartphone, Sparkles } from "lucide-react";
import type { ConnectedDevice, PendingPairingRequest } from "../types/protocol";

interface AppModalsProps {
  pendingPairing: PendingPairingRequest | null;
  connectedDevice: ConnectedDevice | null;
  disconnectConfirmOpen: boolean;
  commandPaletteOpen: boolean;
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
  onRespondToPairing,
  onCloseDisconnectConfirm,
  onConfirmDisconnect,
  onCloseCommandPalette,
  onOpenMirror,
  onOpenExplorer,
  onRegenerateToken,
  onOpenSettings,
}: AppModalsProps) {
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
    </>
  );
}
