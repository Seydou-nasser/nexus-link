import { Monitor, Smartphone } from "lucide-react";

export type ScreenEdge = "LEFT" | "RIGHT" | "BOTTOM";

interface InputControlPanelProps {
  pcDeviceName: string;
  selectedEdge: ScreenEdge;
  edgeResistanceMs: number;
  requireCtrlKey: boolean;
  onChangeEdge: (edge: ScreenEdge) => void;
  onChangeResistance: (ms: number) => void;
  onChangeRequireCtrl: (requireCtrl: boolean) => void;
}

export function InputControlPanel({
  pcDeviceName,
  selectedEdge,
  edgeResistanceMs,
  requireCtrlKey,
  onChangeEdge,
  onChangeResistance,
  onChangeRequireCtrl,
}: InputControlPanelProps) {
  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div>
        <h2 className="text-[16px] font-semibold text-[#f2f5f8]">
          Souris &amp; Clavier partagés
        </h2>
        <p className="text-[12px] text-[#b0cadc]">
          Indiquez de quel côté est posé votre téléphone pour y faire glisser
          naturellement votre souris (appuyez sur{" "}
          <kbd className="px-1.5 py-0.5 rounded bg-white/[0.08] text-[#87CFF9] text-[11px]">
            Échap
          </kbd>{" "}
          pour revenir immédiatement sur le PC).
        </p>
      </div>

      {/* Schéma visuel interactif */}
      <div className="h-56 rounded-2xl bg-[#14171c] border border-white/[0.07] flex items-center justify-center p-6">
        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={() => onChangeEdge("LEFT")}
            className={`w-14 h-28 rounded-xl border flex flex-col items-center justify-center gap-1 transition cursor-pointer ${
              selectedEdge === "LEFT"
                ? "bg-[#005C7D]/50 border-[#87CFF9] text-[#87CFF9] shadow-[0_0_20px_rgba(135,207,249,0.2)]"
                : "bg-white/[0.02] border-dashed border-white/[0.14] text-[#788896] hover:text-[#d6e4ee]"
            }`}
          >
            <Smartphone className="w-4 h-4" />
            <span className="text-[10px]">Gauche</span>
          </button>

          <div className="flex flex-col items-center gap-3">
            <div className="w-56 h-32 rounded-xl bg-[#232934] border border-white/[0.14] flex flex-col items-center justify-center">
              <Monitor className="w-6 h-6 text-[#87CFF9] mb-1" />
              <span className="text-[12px] font-medium text-[#f2f5f8]">
                {pcDeviceName}
              </span>
              <span className="text-[10px] text-[#788896]">
                Écran de l&apos;ordinateur
              </span>
            </div>

            <button
              type="button"
              onClick={() => onChangeEdge("BOTTOM")}
              className={`w-28 h-10 rounded-xl border flex items-center justify-center gap-1.5 transition cursor-pointer ${
                selectedEdge === "BOTTOM"
                  ? "bg-[#005C7D]/50 border-[#87CFF9] text-[#87CFF9] shadow-[0_0_20px_rgba(135,207,249,0.2)]"
                  : "bg-white/[0.02] border-dashed border-white/[0.14] text-[#788896] hover:text-[#d6e4ee]"
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span className="text-[10px]">Bas</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => onChangeEdge("RIGHT")}
            className={`w-14 h-28 rounded-xl border flex flex-col items-center justify-center gap-1 transition cursor-pointer ${
              selectedEdge === "RIGHT"
                ? "bg-[#005C7D]/50 border-[#87CFF9] text-[#87CFF9] shadow-[0_0_20px_rgba(135,207,249,0.2)]"
                : "bg-white/[0.02] border-dashed border-white/[0.14] text-[#788896] hover:text-[#d6e4ee]"
            }`}
          >
            <Smartphone className="w-4 h-4" />
            <span className="text-[10px]">Droite</span>
          </button>
        </div>
      </div>

      {/* Réglages anti-franchissement */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl bg-[#232934]/75 border border-white/[0.07] p-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-[12.5px] font-medium text-[#f2f5f8]">
              Résistance au bord
            </div>
            <div className="text-[11px] text-[#788896]">
              Évite de basculer sur le téléphone par erreur
            </div>
          </div>
          <select
            value={edgeResistanceMs}
            onChange={(e) => onChangeResistance(Number(e.target.value))}
            className="bg-[#14171c] border border-white/[0.12] rounded-lg px-2.5 py-1.5 text-[11.5px] text-[#f2f5f8] outline-none"
          >
            <option value={0}>Aucune</option>
            <option value={120}>Douce</option>
            <option value={250}>Ferme</option>
          </select>
        </div>

        <div className="rounded-xl bg-[#232934]/75 border border-white/[0.07] p-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-[12.5px] font-medium text-[#f2f5f8]">
              Maintenir la touche Ctrl
            </div>
            <div className="text-[11px] text-[#788896]">
              Passe sur le téléphone uniquement avec Ctrl
            </div>
          </div>
          <input
            type="checkbox"
            checked={requireCtrlKey}
            onChange={(e) => onChangeRequireCtrl(e.target.checked)}
            className="w-4 h-4 accent-[#87CFF9] cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
}
