import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API_BASE = (import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || "").trim();

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

export function useTournamentPublicData({ id, token }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [secondsAgo, setSecondsAgo] = useState(0);
  const timerRef = useRef(null);

  const load = useCallback(async () => {
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
  }, [id, token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!data?.tournament?.status) return undefined;
    let intervalMs = 30000;
    if (data.tournament.status === "LIVE") intervalMs = 8000;
    else if (data.tournament.status === "FINISHED") intervalMs = 25000;

    timerRef.current = setInterval(() => {
      load();
    }, intervalMs);
    return () => clearInterval(timerRef.current);
  }, [data?.tournament?.status, load]);

  useEffect(() => {
    const idTimer = setInterval(() => setSecondsAgo(Math.floor((Date.now() - lastRefresh) / 1000)), 1000);
    return () => clearInterval(idTimer);
  }, [lastRefresh]);

  const rounds = useMemo(() => groupByRound(data?.matches || []), [data?.matches]);
  const nowMatch = useMemo(() => {
    if (!data?.now?.match_id) return null;
    return (data.matches || []).find((m) => m.id === data.now.match_id) || null;
  }, [data]);
  const nextMatch = useMemo(() => (data?.matches || []).find((m) => m.status === "PENDING") || null, [data]);

  return { data, err, loading, rounds, nowMatch, nextMatch, secondsAgo, load };
}

export function fmt(v) {
  if (!v) return "-";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v);
  }
}

