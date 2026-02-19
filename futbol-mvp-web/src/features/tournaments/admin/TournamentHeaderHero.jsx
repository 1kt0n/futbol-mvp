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

export default function TournamentHeaderHero({ tournament, ready, teamsCount, matchesCount, busy, onSaveConfig, onGenerateFixture, onGoLive, onFinish, onArchive }) {
  if (!tournament) return null;

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
            <span>?? {tournament.location_name || "Sin ubicacion"}</span>
            <span>?? {fmt(tournament.starts_at)}</span>
            <span>?? {teamsCount}/{tournament.teams_count} equipos</span>
            <span>? {matchesCount} partidos</span>
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
            <button type="button" onClick={onArchive} data-testid="tournament-status-archived-btn" disabled={busy} className="focus-ring rounded-xl bg-zinc-300 px-3 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-40">
              Archivar
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

