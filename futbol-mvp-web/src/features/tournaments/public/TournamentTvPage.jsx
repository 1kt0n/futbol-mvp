import { useEffect, useMemo, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useLocation, useParams } from "react-router-dom";
import { cn } from "../../../design/cn.js";
import { useTournamentPublicData } from "./TournamentPublicDataProvider.jsx";

export default function TournamentTvPage() {
  const { id } = useParams();
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const token = search.get("token") || "";

  const { data, err, loading, nowMatch, nextMatch, load } = useTournamentPublicData({ id, token });

  const lastScoresRef = useRef({});
  const pulseSetRef = useRef(new Set());

  const pageUrl = useMemo(() => {
    const u = new URL(window.location.href);
    u.pathname = `/tournaments/${id}`;
    u.searchParams.set("token", token);
    return u.toString();
  }, [id, token]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key.toLowerCase() === "f") {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
        else document.exitFullscreen?.();
      }
      if (e.key.toLowerCase() === "r") {
        load();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [load]);

  useEffect(() => {
    const next = {};
    const pulse = new Set();
    for (const m of data?.matches || []) {
      const key = m.id;
      const score = `${m.home_goals}-${m.away_goals}`;
      if (lastScoresRef.current[key] && lastScoresRef.current[key] !== score) pulse.add(key);
      next[key] = score;
    }
    lastScoresRef.current = next;
    pulseSetRef.current = pulse;
  }, [data]);

  if (!token) {
    return <div className="min-h-screen bg-black p-6 text-white">Falta token en la URL.</div>;
  }

  return (
    <main className="min-h-screen overflow-hidden bg-black text-white" data-testid="tournament-tv-page">
      <div className="mx-auto grid h-screen max-w-[1800px] grid-rows-[auto_1fr] gap-4 p-4">
        {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{err}</div>}
        <header className="flex items-center justify-between rounded-3xl border border-white/15 bg-zinc-900/90 px-6 py-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight">{data?.tournament?.title || "Torneo"}</h1>
            <p className="text-lg text-white/70">{data?.tournament?.location_name || "-"} · {data?.tournament?.status || "-"}</p>
          </div>
          <div className="text-right text-sm text-white/60">
            <p>F: Fullscreen</p>
            <p>R: Refrescar</p>
            <p>{loading ? "Actualizando..." : "En vivo"}</p>
          </div>
        </header>

        <section className="grid min-h-0 grid-cols-[1.25fr_1fr_220px] gap-4">
          <article className="min-h-0 rounded-3xl border border-white/15 bg-zinc-900/80 p-4">
            <h2 className="mb-3 text-xl font-semibold">Tabla</h2>
            <div className="h-[calc(100%-2.25rem)] overflow-hidden">
              <table className="w-full text-lg">
                <thead>
                  <tr className="border-b border-white/10 text-white/60">
                    <th className="p-2 text-left">Equipo</th>
                    <th className="p-2 text-right">PTS</th>
                    <th className="p-2 text-right">PJ</th>
                    <th className="p-2 text-right">DG</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.standings || []).slice(0, 10).map((r) => (
                    <tr key={r.team_id} className="border-b border-white/5">
                      <td className="p-2">{r.emoji ? `${r.emoji} ` : ""}{r.team_name}</td>
                      <td className="p-2 text-right font-semibold">{r.pts}</td>
                      <td className="p-2 text-right">{r.pj}</td>
                      <td className="p-2 text-right">{r.dg}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(!data?.standings || data.standings.length === 0) && (
                <div className="mt-4 text-lg text-white/60">Sin tabla disponible para este formato.</div>
              )}
            </div>
          </article>

          <article className="flex min-h-0 flex-col gap-4">
            <div className="rounded-3xl border border-emerald-400/30 bg-emerald-500/10 p-4">
              <h2 className="text-lg uppercase tracking-wide text-emerald-100/90">Partido actual</h2>
              {nowMatch ? (
                <div className={cn("mt-2 rounded-2xl p-3", pulseSetRef.current.has(nowMatch.id) && "animate-pulse bg-emerald-400/15")}>
                  <div className="text-2xl font-semibold">{nowMatch.home.name}</div>
                  <div className="my-2 text-4xl font-bold">{nowMatch.home_goals} - {nowMatch.away_goals}</div>
                  <div className="text-2xl font-semibold">{nowMatch.away.name}</div>
                  <div className="mt-2 text-sm text-emerald-100/70">Ronda {nowMatch.round}</div>
                </div>
              ) : (
                <div className="mt-2 rounded-2xl bg-black/20 p-3 text-lg text-white/70">No hay partido LIVE.</div>
              )}
            </div>

            <div className="rounded-3xl border border-white/15 bg-zinc-900/80 p-4">
              <h2 className="text-lg uppercase tracking-wide text-white/70">Proximo</h2>
              {nextMatch ? (
                <div className="mt-2">
                  <div className="text-2xl font-semibold">{nextMatch.home.name}</div>
                  <div className="my-2 text-2xl font-bold text-white/80">vs</div>
                  <div className="text-2xl font-semibold">{nextMatch.away.name}</div>
                  <div className="mt-2 text-sm text-white/60">Ronda {nextMatch.round}</div>
                </div>
              ) : (
                <div className="mt-2 text-lg text-white/70">Sin pendientes.</div>
              )}
            </div>
          </article>

          <aside className="rounded-3xl border border-white/15 bg-zinc-900/80 p-3">
            <div className="grid h-full place-items-end">
              <div className="grid place-items-center gap-2">
                <QRCodeSVG value={pageUrl} size={180} bgColor="#0a0a0a" fgColor="#f4f4f5" />
                <p className="text-center text-xs text-white/60">Escaneame</p>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

