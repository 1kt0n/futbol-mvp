import { useMemo } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Link, useLocation, useParams } from "react-router-dom";
import { cn } from "../../../design/cn.js";
import { fmt, useTournamentPublicData } from "./TournamentPublicDataProvider.jsx";

export default function TournamentPublicPage() {
  const { id } = useParams();
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const token = search.get("token") || "";

  const { data, err, loading, rounds, nowMatch, nextMatch, secondsAgo, load } = useTournamentPublicData({ id, token });

  const pageUrl = useMemo(() => {
    const u = new URL(window.location.href);
    u.pathname = `/tournaments/${id}`;
    return u.toString();
  }, [id]);

  if (!token) {
    return <div className="min-h-screen bg-zinc-950 p-6 text-white">Falta token en la URL.</div>;
  }

  const tvHref = `/tournaments/${id}/tv?token=${encodeURIComponent(token)}`;

  return (
    <main className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-black text-white">
      <div className="mx-auto max-w-6xl px-4 py-5">
        {err && <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{err}</div>}

        <header className="app-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{data?.tournament?.title || "Torneo"}</h1>
              <p className="mt-1 text-sm text-white/60">{data?.tournament?.location_name || "-"} · Estado: {data?.tournament?.status || "-"}</p>
              <p className="mt-1 text-xs text-white/50">Actualizado hace {secondsAgo}s</p>
            </div>
            <div className="flex gap-2">
              <button onClick={load} disabled={loading} className="focus-ring rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold hover:bg-white/10 disabled:opacity-40">{loading ? "..." : "Actualizar"}</button>
              <Link to={tvHref} className="focus-ring rounded-xl bg-amber-400 px-3 py-2 text-sm font-semibold text-black hover:bg-amber-300">Modo TV</Link>
            </div>
          </div>
        </header>

        <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="app-card p-4 lg:col-span-2">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">Ahora / Proximo</div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <article className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                <h2 className="text-xs text-emerald-200/80">EN JUEGO</h2>
                {nowMatch ? (
                  <>
                    <p className="mt-1 text-lg font-semibold">{nowMatch.home.name} {nowMatch.home_goals} - {nowMatch.away_goals} {nowMatch.away.name}</p>
                    <p className="text-xs text-emerald-100/80">Ronda {nowMatch.round}</p>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-white/70">No hay partido LIVE.</p>
                )}
              </article>

              <article className="rounded-xl border border-white/10 bg-black/20 p-3">
                <h2 className="text-xs text-white/60">SIGUIENTE</h2>
                {nextMatch ? (
                  <>
                    <p className="mt-1 text-lg font-semibold">{nextMatch.home.name} vs {nextMatch.away.name}</p>
                    <p className="text-xs text-white/60">Ronda {nextMatch.round}</p>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-white/70">No hay pendientes.</p>
                )}
              </article>
            </div>
          </div>

          <aside className="app-card p-4">
            <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-white/50">Compartir</div>
            <div className="grid place-items-center gap-2">
              <QRCodeSVG value={pageUrl} size={150} bgColor="#09090b" fgColor="#f4f4f5" />
              <p className="text-center text-xs text-white/60">Escanea para ver este torneo</p>
            </div>
          </aside>
        </section>

        {data?.tournament?.format === "ROUND_ROBIN" && (
          <section className="app-card mt-4 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-white/50">Tabla de posiciones</h2>
              {data?.tiebreak_note && <div className="text-xs text-white/50">{data.tiebreak_note}</div>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <caption className="sr-only">Tabla de posiciones</caption>
                <thead>
                  <tr className="border-b border-white/10 text-white/60">
                    <th scope="col" className="p-2 text-left">Equipo</th><th scope="col" className="p-2 text-right">PTS</th><th scope="col" className="p-2 text-right">PJ</th><th scope="col" className="p-2 text-right">PG</th><th scope="col" className="p-2 text-right">PE</th><th scope="col" className="p-2 text-right">PP</th><th scope="col" className="p-2 text-right">GF</th><th scope="col" className="p-2 text-right">GC</th><th scope="col" className="p-2 text-right">DG</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.standings || []).map((r, idx) => (
                    <tr key={r.team_id} className={cn("border-b border-white/5", idx === 0 && "bg-emerald-500/10")}>
                      <td className="p-2">{r.emoji ? `${r.emoji} ` : ""}{r.team_name}</td><td className="p-2 text-right font-semibold">{r.pts}</td><td className="p-2 text-right">{r.pj}</td><td className="p-2 text-right">{r.pg}</td><td className="p-2 text-right">{r.pe}</td><td className="p-2 text-right">{r.pp}</td><td className="p-2 text-right">{r.gf}</td><td className="p-2 text-right">{r.gc}</td><td className="p-2 text-right">{r.dg}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {data?.tournament?.format === "KNOCKOUT" && (
          <section className="app-card mt-4 p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Llaves</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {(data.bracket || []).map((round) => (
                <div key={round.round} className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <h3 className="mb-2 text-sm font-semibold">Ronda {round.round}</h3>
                  <div className="space-y-2">
                    {(round.matches || []).map((m) => (
                      <div key={m.id} className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-xs">
                        <div>{m.home.name} <span className="font-semibold">{m.home_goals}</span></div>
                        <div>{m.away.name} <span className="font-semibold">{m.away_goals}</span></div>
                        <div className="mt-1 text-white/50">{m.status}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="app-card mt-4 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Fixture</h2>
          <div className="space-y-3">
            {rounds.map(([round, ms]) => (
              <div key={round} className="rounded-xl border border-white/10 bg-black/20 p-3">
                <h3 className="mb-2 text-sm font-semibold">Ronda {round}</h3>
                <div className="space-y-1">
                  {ms.map((m) => (
                    <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm">
                      <div>{m.home.name} <span className="font-semibold">{m.home_goals}</span> - <span className="font-semibold">{m.away_goals}</span> {m.away.name}</div>
                      <div className="text-xs text-white/60">{m.status} - {fmt(m.started_at)} - {fmt(m.ended_at)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

