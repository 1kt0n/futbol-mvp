import Card from "../../../../design/ui/Card.jsx";

export default function StandingsTab({ tournament, standings, rounds }) {
  if (tournament.format !== "ROUND_ROBIN") {
    return (
      <Card data-testid="tournament-standings-tab">
        <h3 className="text-lg font-semibold">Tabla</h3>
        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white/70">
          Esta vista esta disponible principalmente para ROUND_ROBIN. En knockout usa Llaves en la pagina publica.
        </div>
      </Card>
    );
  }

  return (
    <Card data-testid="tournament-standings-tab">
      <h3 className="text-lg font-semibold">Tabla de posiciones</h3>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <caption className="sr-only">Tabla de posiciones del torneo</caption>
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
            {(standings || []).map((r, idx) => (
              <tr key={r.team_id} className={idx === 0 ? "border-b border-emerald-400/30 bg-emerald-500/10" : "border-b border-white/5"}>
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
            ))}
          </tbody>
        </table>
      </div>

      {(standings || []).length === 0 && rounds.length === 0 && (
        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white/60">Genera fixture y carga resultados para ver la tabla.</div>
      )}
    </Card>
  );
}

