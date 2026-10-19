import { useState } from "react";
import { Sheet, SheetFooter, useSheetDirty } from "../../../design/ui/overlay/index.js";

function fmt(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function stageLabel(state, format) {
  if (format !== "GROUPS_PLAYOFFS" || !state.stage) return null;
  if (state.stage === "GROUP" && state.group_label) return `Grupo ${state.group_label}`;
  if (state.stage === "PLAYOFF") return "Playoffs";
  return null;
}

export default function MatchResultModal({ open, busy, error, state, format, onChange, onClose, onSave, onFinish }) {
  const context = state ? stageLabel(state, format) : null;
  return (
    <Sheet
      open={open && !!state}
      onClose={onClose}
      title="Cargar resultado"
      subtitle={state ? `${context ? `${context} · ` : ""}Ronda ${state.round} - ${state.status}` : null}
      dismiss="guarded"
      busy={busy}
      testId="result-modal"
      backdropTestId="result-modal-overlay"
    >
      {state ? (
        <MatchResultFields busy={busy} error={error} state={state} onChange={onChange} onSave={onSave} onFinish={onFinish} />
      ) : null}
    </Sheet>
  );
}

// Se monta al abrir: el resultado con el que abrió es la base para saber si hay cambios.
function MatchResultFields({ busy, error, state, onChange, onSave, onFinish }) {
  const [initial] = useState(() => ({ home: state.home_goals, away: state.away_goals }));
  useSheetDirty(Number(state.home_goals) !== Number(initial.home) || Number(state.away_goals) !== Number(initial.away));

  const canSave = state.status === "LIVE" || state.status === "FINISHED";
  const canFinish = state.status === "LIVE";

  return (
    <>
      {error ? (
        <div role="alert" className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

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

      {!canSave && (
        <div className="mt-3 text-xs text-white/60">
          Este partido esta en PENDING. Inicialo primero para poder cargar resultado.
        </div>
      )}

      <SheetFooter>
        <div className="flex gap-2">
          <button type="button" disabled={busy || !canSave} onClick={onSave} data-testid="result-save-btn" className="focus-ring min-h-[44px] flex-1 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-base font-semibold text-amber-200 disabled:opacity-40">
            Guardar resultado
          </button>
          <button type="button" disabled={busy || !canFinish} onClick={onFinish} data-testid="result-finish-btn" className="focus-ring min-h-[44px] flex-1 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-base font-semibold text-sky-200 disabled:opacity-40">
            Finalizar partido
          </button>
        </div>
      </SheetFooter>
    </>
  );
}
