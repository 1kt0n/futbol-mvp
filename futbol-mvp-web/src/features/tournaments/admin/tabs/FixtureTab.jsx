import Card from "../../../../design/ui/Card.jsx";
import Badge from "../../../../design/ui/Badge.jsx";

function fmt(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function MatchCard({ m, busy, onStartMatch, onOpenResult }) {
  const canOpenResult = m.status === "LIVE" || m.status === "FINISHED";
  return (
    <div data-testid={`match-card-${m.id}`} className="rounded-xl border border-white/10 bg-black/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-white">
          {`${m.home?.emoji ? `${m.home.emoji} ` : ""}${m.home?.name || "TBD"} vs ${m.away?.emoji ? `${m.away.emoji} ` : ""}${m.away?.name || "TBD"}`}
        </div>
        <Badge value={m.status} />
      </div>
      <div className="mt-1 text-xs text-white/60">Marcador: {m.home_goals}-{m.away_goals} | Inicio: {fmt(m.started_at)} | Fin: {fmt(m.ended_at)}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button disabled={busy || m.status !== "PENDING"} data-testid={`match-start-${m.id}`} onClick={() => onStartMatch(m.id)} className="focus-ring rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200 disabled:opacity-40">Iniciar</button>
        <button disabled={busy || !canOpenResult} data-testid={`match-open-result-${m.id}`} onClick={() => onOpenResult(m)} className="focus-ring rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-200 disabled:opacity-40" title={canOpenResult ? "Cargar o editar resultado" : "Primero inicia el partido"}>
          {m.status === "FINISHED" ? "Editar resultado" : "Cargar resultado"}
        </button>
      </div>
    </div>
  );
}

function RoundRobinFixture({ rounds, busy, onStartMatch, onOpenResult }) {
  return (
    <div className="space-y-3">
      {rounds.map(([round, ms]) => (
        <div key={round} className="rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="mb-2 text-sm font-semibold text-white">Ronda {round}</div>
          <div className="space-y-2">
            {ms.map((m) => <MatchCard key={m.id} m={m} busy={busy} onStartMatch={onStartMatch} onOpenResult={onOpenResult} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function KnockoutFixture({ rounds, busy, onStartMatch, onOpenResult }) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {rounds.map(([round, ms]) => (
        <div key={round} className="flex-shrink-0 min-w-[240px]">
          <div className="mb-2 text-sm font-semibold text-white/60 uppercase">
            {ms.length === 1 ? "Final" : ms.length === 2 ? "Semifinal" : `Ronda ${round}`}
          </div>
          <div className="space-y-2">
            {ms.map((m) => <MatchCard key={m.id} m={m} busy={busy} onStartMatch={onStartMatch} onOpenResult={onOpenResult} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function GroupsPlayoffsFixture({ matches, busy, onStartMatch, onOpenResult }) {
  const groupMatches = matches.filter((m) => m.stage === "GROUP");
  const playoffMatches = matches.filter((m) => m.stage === "PLAYOFF");

  // Group matches by group_label
  const groups = {};
  for (const m of groupMatches) {
    const g = m.group_label || "?";
    groups[g] = groups[g] || [];
    groups[g].push(m);
  }

  // Playoff matches by round
  const playoffRounds = {};
  for (const m of playoffMatches) {
    const r = Number(m.round || 0);
    playoffRounds[r] = playoffRounds[r] || [];
    playoffRounds[r].push(m);
  }
  const sortedPlayoffRounds = Object.entries(playoffRounds)
    .map(([r, ms]) => [Number(r), ms.sort((a, b) => a.sort_order - b.sort_order)])
    .sort((a, b) => a[0] - b[0]);

  const allGroupFinished = groupMatches.length > 0 && groupMatches.every((m) => m.status === "FINISHED");

  return (
    <div className="space-y-6">
      {/* Group stage */}
      <div>
        <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-emerald-300">Fase de Grupos</h4>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([group, ms]) => {
            // Group matches by round within the group
            const byRound = {};
            for (const m of ms) {
              const r = Number(m.round || 0);
              byRound[r] = byRound[r] || [];
              byRound[r].push(m);
            }
            const sortedRounds = Object.entries(byRound)
              .map(([r, rms]) => [Number(r), rms.sort((a, b) => a.sort_order - b.sort_order)])
              .sort((a, b) => a[0] - b[0]);

            return (
              <div key={group} className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="mb-2 text-sm font-semibold text-emerald-300">Grupo {group}</div>
                <div className="space-y-3">
                  {sortedRounds.map(([round, rms]) => (
                    <div key={round}>
                      <div className="mb-1 text-xs text-white/50">Ronda {round}</div>
                      <div className="space-y-2">
                        {rms.map((m) => <MatchCard key={m.id} m={m} busy={busy} onStartMatch={onStartMatch} onOpenResult={onOpenResult} />)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Playoffs */}
      <div>
        <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-amber-300">Playoffs</h4>
        {playoffMatches.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/20 bg-black/20 p-4 text-center text-sm text-white/50">
            Los playoffs se generaran con el fixture.
          </div>
        ) : !allGroupFinished ? (
          <div className="space-y-2 opacity-50">
            <div className="rounded-xl border border-dashed border-white/20 bg-black/20 p-3 text-center text-xs text-white/50">
              Pendiente — los playoffs se activan al terminar la fase de grupos.
            </div>
            <div className="flex gap-4 overflow-x-auto pb-2">
              {sortedPlayoffRounds.map(([round, ms]) => (
                <div key={round} className="flex-shrink-0 min-w-[240px]">
                  <div className="mb-2 text-xs font-semibold text-white/40 uppercase">
                    {ms.length === 1 ? "Final" : ms.length === 2 ? "Semifinal" : `Ronda`}
                  </div>
                  <div className="space-y-2">
                    {ms.map((m) => (
                      <div key={m.id} className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-white/40">
                        {m.home?.name || "TBD"} vs {m.away?.name || "TBD"}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-2">
            {sortedPlayoffRounds.map(([round, ms]) => (
              <div key={round} className="flex-shrink-0 min-w-[240px]">
                <div className="mb-2 text-sm font-semibold text-white/60 uppercase">
                  {ms.length === 1 ? "Final" : ms.length === 2 ? "Semifinal" : `Ronda`}
                </div>
                <div className="space-y-2">
                  {ms.map((m) => <MatchCard key={m.id} m={m} busy={busy} onStartMatch={onStartMatch} onOpenResult={onOpenResult} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function FixtureTab({ tournament, matches, rounds, busy, onGenerateFixture, onStartMatch, onOpenResult }) {
  const fmt2 = tournament?.format;

  return (
    <Card data-testid="tournament-fixture-tab">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Fixture</h3>
          <p className="text-xs text-white/60">
            {fmt2 === "GROUPS_PLAYOFFS" ? "Fase de grupos + playoffs" : fmt2 === "KNOCKOUT" ? "Eliminacion directa" : "Timeline cronologica de partidos"}
          </p>
        </div>
        <button
          disabled={busy || tournament.status !== "DRAFT"}
          data-testid="tournament-generate-fixture-btn"
          onClick={onGenerateFixture}
          className="focus-ring rounded-xl bg-amber-400 px-3 py-2 text-sm font-semibold text-black hover:bg-amber-300 disabled:opacity-40"
        >
          Generar Fixture
        </button>
      </div>

      {(!matches || matches.length === 0) ? (
        <div className="rounded-2xl border border-dashed border-white/20 bg-black/20 p-10 text-center">
          <div className="text-lg font-semibold text-white">Aun no hay fixture generado</div>
          <div className="mt-1 text-sm text-white/60">Genera el fixture para comenzar la competencia.</div>
        </div>
      ) : fmt2 === "GROUPS_PLAYOFFS" ? (
        <GroupsPlayoffsFixture matches={matches} busy={busy} onStartMatch={onStartMatch} onOpenResult={onOpenResult} />
      ) : fmt2 === "KNOCKOUT" ? (
        <KnockoutFixture rounds={rounds} busy={busy} onStartMatch={onStartMatch} onOpenResult={onOpenResult} />
      ) : (
        <RoundRobinFixture rounds={rounds} busy={busy} onStartMatch={onStartMatch} onOpenResult={onOpenResult} />
      )}
    </Card>
  );
}
