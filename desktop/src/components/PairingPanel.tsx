import { QrCode, RefreshCw } from "lucide-react";

interface PairingPanelProps {
  deviceName: string;
  qrSvg: string;
  onRegenerateToken: () => void;
}

export function PairingPanel({
  deviceName,
  qrSvg,
  onRegenerateToken,
}: PairingPanelProps) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="w-full max-w-2xl rounded-2xl bg-[#232934]/80 border border-white/[0.08] p-6 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#005C7D]/70 border border-[#87CFF9]/30 flex items-center justify-center text-[#87CFF9]">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-[#f2f5f8]">
                Associer votre téléphone Android
              </h2>
              <p className="text-[12px] text-[#b0cadc]">
                Scannez ce QR Code ou sélectionnez{" "}
                <strong className="text-[#f2f5f8]">{deviceName}</strong> sur
                votre téléphone.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onRegenerateToken}
            className="h-8 px-3 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] flex items-center gap-1.5 text-[12px] text-[#d6e4ee] transition cursor-pointer shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5 text-[#87CFF9]" />
            Actualiser
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6 items-center">
          <div
            className="w-[220px] h-[220px] rounded-2xl bg-white p-3.5 flex items-center justify-center mx-auto shadow-xl"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />

          <div className="space-y-3 text-[13px] text-[#c7d6e2]">
            <div className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[#005C7D] text-[#87CFF9] text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">
                1
              </span>
              <span>
                Connectez votre téléphone au{" "}
                <strong className="text-[#f2f5f8]">même réseau Wi-Fi</strong>{" "}
                que cet ordinateur.
              </span>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[#005C7D] text-[#87CFF9] text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">
                2
              </span>
              <span>
                Ouvrez <strong className="text-[#f2f5f8]">NexusLink</strong> sur
                Android et appuyez sur{" "}
                <strong className="text-[#f2f5f8]">Scanner QR</strong> ou
                choisissez ce PC dans la liste.
              </span>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[#005C7D] text-[#87CFF9] text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">
                3
              </span>
              <span>
                Toutes vos données restent{" "}
                <strong className="text-[#87CFF9]">100 % en local</strong> sans
                aucun passage par Internet.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
