import { useNavigate } from "react-router-dom";

export default function AdminCreateMenu({ open, onClose, onCreateAnnouncement }) {
  const navigate = useNavigate();
  if (!open) return null;

  return (
    <div className="bottom-sheet-overlay" onClick={onClose}>
      <div
        className="bottom-sheet-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
        <div className="text-base font-semibold text-white">Agregar al calendario</div>
        <div className="mt-1 text-xs text-white/60">
          Eligi que tipo de elemento queres crear.
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <button
            onClick={() => {
              onCreateAnnouncement?.();
              onClose?.();
            }}
            className="flex items-start gap-3 rounded-2xl border border-sky-400/30 bg-sky-500/10 p-4 text-left hover:bg-sky-500/20"
          >
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-black/30 text-lg">
              📢
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-white">Anuncio informativo</div>
              <div className="mt-0.5 text-xs text-white/60">
                Fechas importantes, cierres de inscripcion, recordatorios. No requiere anotarse.
              </div>
            </div>
          </button>

          <button
            onClick={() => {
              navigate("/admin?focus=calendar");
              onClose?.();
            }}
            className="flex items-start gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-left hover:bg-emerald-500/20"
          >
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-black/30 text-lg">
              ⚽
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-white">Evento de cancha</div>
              <div className="mt-0.5 text-xs text-white/60">
                Creas un evento con canchas y cupos. Despues marcalo como visible para todos.
              </div>
            </div>
          </button>
        </div>

        <button
          onClick={onClose}
          className="mt-3 w-full rounded-xl px-4 py-2 text-sm text-white/50 hover:text-white"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
