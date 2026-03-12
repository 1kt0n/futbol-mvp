import Card from "../../../../design/ui/Card.jsx";

function StandingsTable({ standings, advance }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] text-sm">
        <caption className="sr-only">Tabla de posiciones</caption>
        <thead>
          <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-white/60">
            <th scope="col" className="p-2 text-left">Pos</th>
            <th scope="col" className="p-2 text-left">Equipo</th>
            <th scope="col" className="p-2 text-right">PJ</th>
            <th scope="col" className="p-2 text-right">PG</th>
            <th scope="col" className="p-2 text-right">PE</th>
            <th scope="col" className="p-2 text-right">PP</th>
            <th scope="col" className="p-2 text-right">GF</th>
            <th scope="col" className="p-2 text-right">GC</th>
            <th scope="col" className="p-2 text-right">DG</th>
            <th scope="col" className="p-2 text-right font-semibold">PTS</th>
          </tr>
        </thead>
        <tbody>
          {(standings || []).map((r, idx) => {
            const qualifies = advance != null && idx < advance;
            return (
              <tr key={r.team_id} className={qualifies ? "border-b border-emerald-400/30 bg-emerald-500/10" : idx === 0 ? "border-b border-emerald-400/30 bg-emerald-500/10" : "border-b border-white/5"}>
                <td className="p-2 font-semibold">{idx + 1}</td>
                <td className="p-2">{r.emoji ? `${r.emoji} ` : ""}{r.team_name}</td>
                <td className="p-2 text-right">{r.pj}</td>
                <td className="p-2 text-right">{r.pg}</td>
                <td className="p-2 text-right">{r.pe}</td>
                <td className="p-2 text-right">{r.pp}</td>
                <td className="p-2 text-right">{r.gf}</td>
                <td className="p-2 text-right">{r.gc}</td>
                <td className="p-2 text-right">{r.dg}</td>
                <td className="p-2 text-right font-bold">{r.pts}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const GP_CONFIG = {
  4: { advance: 1 }, 6: { advance: 2 }, 8: { advance: 2 },
  10: { advance: 2 }, 12: { advance: 2 }, 16: { advance: 2 },
};

export default function StandingsTab({ tournament, standings, groupStandings, rounds }) {
  const fmt = tournament?.format;

  if (fmt === "GROUPS_PLAYOFFS") {
    const advance = GP_CONFIG[Number(tournament?.teams_count)]?.advance ?? 2;

    return (
      <Card data-testid="tournament-standings-tab">
        <h3 className="text-lg font-semibold">Tabla de posiciones</h3>
        {groupStandings && Object.keys(groupStandings).length > 0 ? (
          <div className="mt-3 space-y-4">
            {Object.entries(groupStandings).sort(([a], [b]) => a.localeCompare(b)).map(([group, gs]) => (
              <div key={group}>
                <div className="mb-2 text-sm font-semibold text-emerald-300">Grupo {group}</div>
                <StandingsTable standings={gs} advance={advance} />
              </div>
            ))}
            <div className="text-xs text-white/50">Los {advance} primeros de cada grupo clasifican a playoffs.</div>
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white/60">
            Genera fixture y carga resultados para ver la tabla por grupos.
          </div>
        )}
      </Card>
    );
  }

  if (fmt === "KNOCKOUT") {
    return (
      <Card data-testid="tournament-standings-tab">
        <h3 className="text-lg font-semibold">Llaves</h3>
        {rounds.length === 0 ? (
          <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white/60">
            Genera fixture para ver las llaves de eliminacion directa.
          </div>
        ) : (
          <div className="mt-3 flex gap-4 overflow-x-auto pb-2">
            {rounds.map(([round, ms]) => (
              <div key={round} className="flex-shrink-0">
                <div className="mb-2 text-xs font-semibold text-white/60 uppercase">
                  {ms.length === 1 ? "Final" : ms.length === 2 ? "Semifinal" : `Ronda ${round}`}
                </div>
                <div className="space-y-2">
                  {ms.map((m) => (
                    <div key={m.id} className="rounded-lg border border-white/10 bg-black/20 p-2 text-xs min-w-[160px]">
                      <div className={m.status === "FINISHED" && Number(m.home_goals) > Number(m.away_goals) ? "font-bold text-emerald-300" : "text-white"}>
                        {m.home?.name || "TBD"} {m.status === "FINISHED" ? m.home_goals : ""}
                      </div>
                      <div className={m.status === "FINISHED" && Number(m.away_goals) > Number(m.home_goals) ? "font-bold text-emerald-300" : "text-white"}>
                        {m.away?.name || "TBD"} {m.status === "FINISHED" ? m.away_goals : ""}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    );
  }

  // ROUND_ROBIN (default)
  return (
    <Card data-testid="tournament-standings-tab">
      <h3 className="text-lg font-semibold">Tabla de posiciones</h3>
      <div className="mt-3">
        <StandingsTable standings={standings} />
      </div>
      {(standings || []).length === 0 && rounds.length === 0 && (
        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white/60">Genera fixture y carga resultados para ver la tabla.</div>
      )}
    </Card>
  );
}
