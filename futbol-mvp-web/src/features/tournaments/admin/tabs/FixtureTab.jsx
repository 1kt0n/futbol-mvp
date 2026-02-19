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

export default function FixtureTab({ tournament, rounds, busy, onGenerateFixture, onStartMatch, onOpenResult }) {
  return (
    <Card data-testid="tournament-fixture-tab">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Fixture</h3>
          <p className="text-xs text-white/60">Timeline cronologica de partidos</p>
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

      {rounds.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/20 bg-black/20 p-10 text-center">
          <div className="text-lg font-semibold text-white">Aun no hay fixture generado</div>
          <div className="mt-1 text-sm text-white/60">Genera el fixture para comenzar la competencia.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {rounds.map(([round, ms]) => (
            <div key={round} className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="mb-2 text-sm font-semibold text-white">Ronda {round}</div>
              <div className="space-y-2">
                {ms.map((m) => {
                  const canOpenResult = m.status === "LIVE" || m.status === "FINISHED";
                  return (
                    <div key={m.id} data-testid={`match-card-${m.id}`} className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-white">
                          {`${m.home.emoji ? `${m.home.emoji} ` : ""}${m.home.name} vs ${m.away.emoji ? `${m.away.emoji} ` : ""}${m.away.name}`}
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
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

