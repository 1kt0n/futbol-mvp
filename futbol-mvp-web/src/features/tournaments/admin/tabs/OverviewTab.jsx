import Card from "../../../../design/ui/Card.jsx";
import Badge from "../../../../design/ui/Badge.jsx";

function fmt(v) {
  if (!v) return "-";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v);
  }
}

export default function OverviewTab({ tournament, teams, matches, standings, nextMatch }) {
  const totalPlayers = teams.reduce((acc, t) => acc + (t.members?.length || 0), 0);
  const estimatedMinutes = (matches?.length || 0) * Number(tournament?.minutes_per_match || 0);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3" data-testid="tournament-overview-tab">
      <Card className="xl:col-span-2">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Resumen del torneo</h3>
          <Badge value={tournament?.status || "DRAFT"} />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="text-xs text-white/60">Equipos</div><div className="mt-1 text-xl font-semibold">{teams.length}/{tournament?.teams_count || 0}</div></div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="text-xs text-white/60">Partidos</div><div className="mt-1 text-xl font-semibold">{matches.length}</div></div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="text-xs text-white/60">Jugadores</div><div className="mt-1 text-xl font-semibold">{totalPlayers}</div></div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="text-xs text-white/60">Duracion</div><div className="mt-1 text-xl font-semibold">{estimatedMinutes}m</div></div>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white/70">
          <div>?? {tournament?.location_name || "Sin ubicacion"}</div>
          <div className="mt-1">?? {fmt(tournament?.starts_at)}</div>
          <div className="mt-1">?? Formato: {tournament?.format || "-"}</div>
        </div>
      </Card>

      <Card>
        <h3 className="text-base font-semibold">Proximo partido</h3>
        {!nextMatch ? (
          <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white/60">No hay partidos pendientes.</div>
        ) : (
          <div className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3">
            <div className="text-xs uppercase tracking-wide text-emerald-200/90">Ronda {nextMatch.round}</div>
            <div className="mt-1 text-sm font-semibold text-white">{nextMatch.home.name} vs {nextMatch.away.name}</div>
            <div className="mt-1 text-xs text-white/60">Estado: {nextMatch.status}</div>
          </div>
        )}

        <h4 className="mt-4 text-sm font-semibold text-white/90">Mini tabla</h4>
        <div className="mt-2 space-y-1">
          {(standings || []).slice(0, 5).map((row, idx) => (
            <div key={row.team_id} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-xs">
              <div>{idx + 1}. {row.emoji ? `${row.emoji} ` : ""}{row.team_name}</div>
              <div className="font-semibold">{row.pts} pts</div>
            </div>
          ))}
          {(!standings || standings.length === 0) && (
            <div className="rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-xs text-white/60">La tabla aparecera cuando exista fixture y resultados.</div>
          )}
        </div>
      </Card>
    </div>
  );
}

