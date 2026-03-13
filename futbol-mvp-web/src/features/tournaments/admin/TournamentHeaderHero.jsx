import Badge from "../../../design/ui/Badge.jsx";
import Card from "../../../design/ui/Card.jsx";
import { cn } from "../../../App.jsx";

function fmt(v) {
  if (!v) return "Sin fecha";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v);
  }
}

const DRAFT_STEPS = [
  { key: "config", label: "Config", tab: "overview" },
  { key: "teams", label: "Equipos", tab: "teams" },
  { key: "fixture", label: "Fixture", tab: "fixture" },
  { key: "publish", label: "Publicar", tab: "overview" },
];

function stageIndex(stage) {
  if (!stage || stage === "config") return 0;
  if (stage === "teams") return 1;
  if (stage === "fixture") return 2;
  if (stage === "publish") return 3;
  return 0;
}

export default function TournamentHeaderHero({ tournament, ready, teamsCount, matchesCount, busy, draftStage, onSaveConfig, onGenerateFixture, onGoLive, onFinish, onArchive, onReopen, onDelete, onTabChange }) {
  if (!tournament) return null;

  const currentIdx = stageIndex(draftStage);

  return (
    <Card className="sticky top-3 z-20 overflow-hidden bg-gradient-to-br from-zinc-900/95 via-zinc-900/80 to-zinc-800/70">
      <div className="absolute -right-14 -top-14 h-44 w-44 rounded-full bg-emerald-500/10 blur-3xl" aria-hidden="true" />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge value={tournament.status} />
            {ready && tournament.status === "DRAFT" && <Badge value="READY" />}
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-white" data-testid="tournament-hero-title">{tournament.title}</h2>
          <div className="mt-2 flex flex-wrap gap-4 text-sm text-white/70">
            <span>📍 {tournament.location_name || "Sin ubicacion"}</span>
            <span>📅 {fmt(tournament.starts_at)}</span>
            <span>👥 {teamsCount}/{tournament.teams_count} equipos</span>
            <span>⚽ {matchesCount} partidos</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {tournament.status === "DRAFT" && (
            <>
              <button
                type="button"
                onClick={onSaveConfig}
                data-testid="tournament-save-config-btn"
                disabled={busy}
                className="focus-ring rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold hover:bg-white/10 disabled:opacity-40"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={onGenerateFixture}
                data-testid="tournament-hero-generate-fixture-btn"
                disabled={busy || teamsCount < Number(tournament.teams_count || 0)}
                title={teamsCount < Number(tournament.teams_count || 0) ? "Completa equipos para generar fixture" : "Generar fixture"}
                className={cn(
                  "focus-ring rounded-xl px-3 py-2 text-sm font-semibold disabled:opacity-40",
                  teamsCount < Number(tournament.teams_count || 0)
                    ? "border border-white/10 bg-white/5"
                    : "bg-amber-400 text-black hover:bg-amber-300"
                )}
              >
                Generar Fixture
              </button>
            </>
          )}

          {tournament.status === "DRAFT" && ready && (
            <button
              type="button"
              onClick={onGoLive}
              data-testid="tournament-status-live-btn"
              disabled={busy}
              className="focus-ring rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-40"
            >
              Pasar a LIVE
            </button>
          )}

          {tournament.status === "LIVE" && (
            <button type="button" onClick={onFinish} data-testid="tournament-status-finished-btn" disabled={busy} className="focus-ring rounded-xl bg-sky-400 px-3 py-2 text-sm font-semibold text-black hover:bg-sky-300 disabled:opacity-40">
              Finalizar
            </button>
          )}

          {tournament.status === "FINISHED" && (
            <>
              <button type="button" onClick={onReopen} data-testid="tournament-status-reopen-btn" disabled={busy} className="focus-ring rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/20 disabled:opacity-40">
                Reabrir
              </button>
              <button type="button" onClick={onArchive} data-testid="tournament-status-archived-btn" disabled={busy} className="focus-ring rounded-xl bg-zinc-300 px-3 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-40">
                Archivar
              </button>
            </>
          )}

          {(tournament.status === "DRAFT" || tournament.status === "ARCHIVED") && (
            <button type="button" onClick={onDelete} data-testid="tournament-delete-btn" disabled={busy} className="focus-ring rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-40">
              Eliminar
            </button>
          )}
        </div>
      </div>

      {/* Draft stepper navigation */}
      {tournament.status === "DRAFT" && onTabChange && (
        <div className="relative mt-4 flex items-center gap-1 border-t border-white/10 pt-3">
          {DRAFT_STEPS.map((step, idx) => {
            const done = idx < currentIdx;
            const active = idx === currentIdx;
            return (
              <button
                key={step.key}
                type="button"
                onClick={() => onTabChange(step.tab)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                  active ? "bg-emerald-500/20 text-emerald-300" :
                  done ? "text-emerald-400/70 hover:bg-white/5" :
                  "text-white/40 hover:bg-white/5"
                )}
              >
                <span className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                  active ? "bg-emerald-500 text-black" :
                  done ? "bg-emerald-500/30 text-emerald-300" :
                  "bg-white/10 text-white/40"
                )}>
                  {done ? "✓" : idx + 1}
                </span>
                <span className="hidden sm:inline">{step.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
