import Badge from "../../../design/ui/Badge.jsx";

function stageLabel(match) {
  if (!match) return "";
  if (match.stage === "PLAYOFF") return "Playoffs";
  if (match.group_label) return `Grupo ${match.group_label}`;
  return "";
}

export default function MatchDayBanner({ matches, busy, onStartMatch, onOpenResult }) {
  const liveMatch = matches.find((m) => m.status === "LIVE");
  const nextPending = matches.find((m) => m.status === "PENDING" && m.home?.id && m.away?.id);
  const finished = matches.filter((m) => m.status === "FINISHED").length;
  const total = matches.length;
  const progress = total > 0 ? Math.round((finished / total) * 100) : 0;

  return (
    <div className="app-card overflow-hidden p-4">
      {/* Progress bar */}
      <div className="mb-3 flex items-center justify-between text-xs text-white/60">
        <span>{finished} de {total} partidos completados</span>
        <span>{progress}%</span>
      </div>
      <div className="mb-4 h-1.5 w-full rounded-full bg-white/10">
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
      </div>

      {liveMatch ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">En vivo</span>
            {stageLabel(liveMatch) && (
              <span className="text-xs text-white/50">— {stageLabel(liveMatch)}</span>
            )}
          </div>
          <div className="flex items-center justify-center gap-4 text-xl font-bold text-white">
            <span>{liveMatch.home.emoji} {liveMatch.home.name}</span>
            <span className="rounded-lg bg-white/10 px-3 py-1 text-2xl tabular-nums">{liveMatch.home_goals} - {liveMatch.away_goals}</span>
            <span>{liveMatch.away.name} {liveMatch.away.emoji}</span>
          </div>
          <div className="mt-3 flex justify-center gap-2">
            <button
              disabled={busy}
              onClick={() => onOpenResult(liveMatch)}
              className="focus-ring rounded-lg bg-amber-500/20 border border-amber-500/30 px-4 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/30 disabled:opacity-40"
            >
              Cargar resultado
            </button>
          </div>
        </div>
      ) : nextPending ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/50">
            Proximo partido {stageLabel(nextPending) && `— ${stageLabel(nextPending)}`}
          </div>
          <div className="text-lg font-bold text-white">
            {nextPending.home.emoji} {nextPending.home.name} vs {nextPending.away.name} {nextPending.away.emoji}
          </div>
          <button
            disabled={busy}
            data-testid={`match-start-${nextPending.id}`}
            onClick={() => onStartMatch(nextPending.id)}
            className="focus-ring mt-3 rounded-xl bg-emerald-500 px-6 py-2.5 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-40"
          >
            Iniciar partido
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center text-sm text-white/60">
          {finished === total ? "Todos los partidos finalizados" : "No hay partidos pendientes con equipos asignados"}
        </div>
      )}
    </div>
  );
}
