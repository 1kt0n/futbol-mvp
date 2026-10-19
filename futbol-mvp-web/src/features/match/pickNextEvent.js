// El partido que abre la pestaña Partido: el próximo (desde hace 3 h en adelante)
// o, si no hay ninguno, el más reciente. Lo usan la Home vieja y la pantalla nueva.

// El backend manda "2026-10-21 21:00:00+00:00"; Safari viejo no parsea el espacio.
export function parseTs(value) {
  const t = new Date(String(value || "").replace(" ", "T")).getTime();
  return Number.isNaN(t) ? null : t;
}

export function pickNextEvent(evts, now = Date.now()) {
  const cutoff = now - 3 * 60 * 60 * 1000;
  const withTs = evts.map((e) => ({ e, t: parseTs(e.starts_at) }));
  const upcoming = withTs.filter((x) => x.t !== null && x.t >= cutoff).sort((a, b) => a.t - b.t);
  if (upcoming.length > 0) return upcoming[0].e;
  const past = withTs.filter((x) => x.t !== null).sort((a, b) => b.t - a.t);
  return (past[0] || withTs[0])?.e || null;
}
