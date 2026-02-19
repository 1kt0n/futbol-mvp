import Card from "../../../design/ui/Card.jsx";

function fmt(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

export default function MatchResultModal({ open, busy, state, onChange, onClose, onSave, onFinish }) {
  if (!open || !state) return null;

  const canSave = state.status === "LIVE" || state.status === "FINISHED";
  const canFinish = state.status === "LIVE";

  return (
    <div className="fixed inset-0 z-50 bg-black/70 p-4" role="button" tabIndex={-1} data-testid="result-modal-overlay" onClick={onClose}>
      <Card className="mx-auto mt-20 max-w-xl" data-testid="result-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold text-white">Cargar resultado</div>
            <div className="text-xs text-white/60">
              Ronda {state.round} - {state.status}
            </div>
          </div>
          <button onClick={onClose} className="focus-ring rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/80 hover:bg-white/10">
            Cerrar
          </button>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="text-sm font-semibold text-white">
            {state.home_name} vs {state.away_name}
          </div>
          <div className="mt-1 text-xs text-white/60">
            Inicio: {fmt(state.started_at)} - Fin: {fmt(state.ended_at)}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div>
            <label className="text-xs font-semibold text-white/70" htmlFor="result-home-goals-input">Goles local</label>
            <input id="result-home-goals-input" type="number" min={0} value={state.home_goals} onChange={(e) => onChange("home_goals", Number(e.target.value || 0))} data-testid="result-home-goals-input" className="focus-ring mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white" />
          </div>
          <div className="mt-5 text-sm text-white/60">-</div>
          <div>
            <label className="text-xs font-semibold text-white/70" htmlFor="result-away-goals-input">Goles visitante</label>
            <input id="result-away-goals-input" type="number" min={0} value={state.away_goals} onChange={(e) => onChange("away_goals", Number(e.target.value || 0))} data-testid="result-away-goals-input" className="focus-ring mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white" />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button disabled={busy || !canSave} onClick={onSave} data-testid="result-save-btn" className="focus-ring rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-200 disabled:opacity-40">
            Guardar resultado
          </button>
          <button disabled={busy || !canFinish} onClick={onFinish} data-testid="result-finish-btn" className="focus-ring rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm font-semibold text-sky-200 disabled:opacity-40">
            Finalizar partido
          </button>
        </div>

        {!canSave && (
          <div className="mt-3 text-xs text-white/60">
            Este partido esta en PENDING. Inicialo primero para poder cargar resultado.
          </div>
        )}
      </Card>
    </div>
  );
}

