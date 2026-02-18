import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { cn } from "./App.jsx";

const API_BASE = (import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || "").trim();

function fmt(v) {
  if (!v) return "-";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v);
  }
}

function groupByRound(matches = []) {
  const map = {};
  for (const m of matches) {
    const r = Number(m.round || 0);
    map[r] = map[r] || [];
    map[r].push(m);
  }
  return Object.entries(map)
    .map(([r, ms]) => [Number(r), ms.sort((a, b) => Number(a.sort_order) - Number(b.sort_order))])
    .sort((a, b) => a[0] - b[0]);
}

async function fetchPublic(path) {
  const res = await fetch(`${API_BASE}${path}`);
  const type = res.headers.get("content-type") || "";
  const isJson = type.includes("application/json");
  const payload = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");
  if (!res.ok) {
    const detail = payload?.detail || payload?.message || payload || `HTTP ${res.status}`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return payload;
}

export default function TournamentLive() {
  const { id } = useParams();
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const token = search.get("token") || "";
  const forcedTv = search.get("tv") === "1" || location.pathname.endsWith("/tv");

  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [tvMode, setTvMode] = useState(forcedTv);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [secondsAgo, setSecondsAgo] = useState(0);
  const timerRef = useRef(null);

  const rounds = useMemo(() => groupByRound(data?.matches || []), [data?.matches]);
  const nowMatch = useMemo(() => {
    if (!data?.now?.match_id) return null;
    return (data.matches || []).find((m) => m.id === data.now.match_id) || null;
  }, [data]);
  const nextMatch = useMemo(() => (data?.matches || []).find((m) => m.status === "PENDING") || null, [data]);
  const pageUrl = window.location.href;

  async function load() {
    if (!id || !token) return;
    setLoading(true);
    setErr("");
    try {
      const payload = await fetchPublic(`/public/tournaments/${id}/live?token=${encodeURIComponent(token)}`);
      setData(payload);
      setLastRefresh(Date.now());
      setSecondsAgo(0);
    } catch (e) {
      setErr(e.message || "No se pudo cargar torneo.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  useEffect(() => {
    if (!data?.tournament?.status) return;
    let intervalMs = 30000;
    if (data.tournament.status === "LIVE") intervalMs = 8000;
    else if (data.tournament.status === "FINISHED") intervalMs = 25000;

    timerRef.current = setInterval(() => {
      load();
    }, intervalMs);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.tournament?.status, id, token]);

  useEffect(() => {
    const idTimer = setInterval(() => setSecondsAgo(Math.floor((Date.now() - lastRefresh) / 1000)), 1000);
    return () => clearInterval(idTimer);
  }, [lastRefresh]);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key.toLowerCase() === "f") toggleFullscreen();
      if (e.key.toLowerCase() === "t") setTvMode((v) => !v);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!token) {
    return <div className="min-h-screen bg-black p-6 text-white">Falta token en la URL.</div>;
  }

  return (
    <div className={cn("min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-black text-white", tvMode && "text-lg")}>
      <div className={cn("mx-auto max-w-7xl px-4 py-6", tvMode && "max-w-none px-6 py-4")}>
        {err && <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{err}</div>}

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className={cn("font-bold", tvMode ? "text-4xl" : "text-2xl")}>{data?.tournament?.title || "Torneo"}</div>
            <div className={cn("text-white/60", tvMode ? "text-lg" : "text-sm")}>
              {data?.tournament?.location_name || "-"} - Estado: {data?.tournament?.status || "-"} - Ultima actualizacion hace {secondsAgo}s
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={load} disabled={loading} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold hover:bg-white/10 disabled:opacity-40">{loading ? "..." : "Actualizar"}</button>
            <button onClick={() => setTvMode((v) => !v)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold hover:bg-white/10">{tvMode ? "Salir TV" : "Modo TV"}</button>
            <button onClick={toggleFullscreen} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold hover:bg-white/10">Fullscreen (F)</button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 xl:col-span-2">
            <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-white/50">Ahora / Proximo</div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                <div className="text-xs text-emerald-200/80">EN JUEGO</div>
                {nowMatch ? (
                  <>
                    <div className="mt-1 text-lg font-semibold">
                      {nowMatch.home.name} {nowMatch.home_goals} - {nowMatch.away_goals} {nowMatch.away.name}
                    </div>
                    <div className="text-xs text-emerald-100/80">Ronda {nowMatch.round}</div>
                  </>
                ) : (
                  <div className="mt-1 text-sm text-white/70">No hay partido LIVE.</div>
                )}
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="text-xs text-white/60">SIGUIENTE</div>
                {nextMatch ? (
                  <>
                    <div className="mt-1 text-lg font-semibold">{nextMatch.home.name} vs {nextMatch.away.name}</div>
                    <div className="text-xs text-white/60">Ronda {nextMatch.round}</div>
                  </>
                ) : (
                  <div className="mt-1 text-sm text-white/70">No hay pendientes.</div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-white/50">Compartir</div>
            <div className="grid place-items-center gap-2">
              <QRCodeSVG value={pageUrl} size={tvMode ? 170 : 140} bgColor="#09090b" fgColor="#f4f4f5" />
              <div className="text-center text-xs text-white/60">Escanea para ver en tu celu</div>
            </div>
          </div>
        </div>

        {data?.tournament?.format === "ROUND_ROBIN" && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold uppercase tracking-wide text-white/50">Tabla de posiciones</div>
              {data?.tiebreak_note && <div className="text-xs text-white/50">{data.tiebreak_note}</div>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-white/60">
                    <th className="p-2 text-left">Equipo</th><th className="p-2 text-right">PTS</th><th className="p-2 text-right">PJ</th><th className="p-2 text-right">PG</th><th className="p-2 text-right">PE</th><th className="p-2 text-right">PP</th><th className="p-2 text-right">GF</th><th className="p-2 text-right">GC</th><th className="p-2 text-right">DG</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.standings || []).map((r) => (
                    <tr key={r.team_id} className="border-b border-white/5">
                      <td className="p-2">{r.emoji ? `${r.emoji} ` : ""}{r.team_name}</td><td className="p-2 text-right font-semibold">{r.pts}</td><td className="p-2 text-right">{r.pj}</td><td className="p-2 text-right">{r.pg}</td><td className="p-2 text-right">{r.pe}</td><td className="p-2 text-right">{r.pp}</td><td className="p-2 text-right">{r.gf}</td><td className="p-2 text-right">{r.gc}</td><td className="p-2 text-right">{r.dg}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {data?.tournament?.format === "KNOCKOUT" && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Llaves</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {(data.bracket || []).map((round) => (
                <div key={round.round} className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="mb-2 text-sm font-semibold">Ronda {round.round}</div>
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
          </div>
        )}

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Fixture</div>
          <div className="space-y-3">
            {rounds.map(([round, ms]) => (
              <div key={round} className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="mb-2 text-sm font-semibold">Ronda {round}</div>
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
        </div>
      </div>
    </div>
  );
}
