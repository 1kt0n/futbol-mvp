// Pantalla Avisos (rediseño UX, iteración 1b): reemplaza el desplegable de la
// campana del inicio. Arriba van los votos pendientes; después, los avisos.

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../../calendar/api.js";
import { cn } from "../../design/cn.js";
import { AVISOS_CHANGED_EVENT } from "../../shell/events.js";

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const weekday = d.toLocaleDateString("es-AR", { weekday: "short" }).replace(".", "");
  return `${weekday} ${d.getDate()}/${d.getMonth() + 1}`;
}

function ActionLink({ url, children, className }) {
  if (!url) return null;
  // Las rutas internas navegan dentro de la app; las externas abren aparte.
  if (url.startsWith("/")) {
    return (
      <Link to={url} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

export default function AvisosPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/notifications");
      setData(res || {});
      setErr("");
    } catch (e) {
      setErr(e.message || "No pudimos cargar los avisos.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function dismiss(id) {
    setBusyId(id);
    try {
      await apiFetch(`/notifications/${id}/dismiss`, { method: "POST" });
      await load();
      window.dispatchEvent(new Event(AVISOS_CHANGED_EVENT));
    } catch (e) {
      setErr(e.message || "No pudimos descartar el aviso.");
    } finally {
      setBusyId(null);
    }
  }

  const items = data?.items || [];
  const votos = items.find((n) => n.kind === "PENDING_RATINGS");
  const avisos = items.filter((n) => n.kind !== "PENDING_RATINGS");

  return (
    <div className="page-enter min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-black text-white">
      <div className="mx-auto max-w-lg px-4 py-6">
        <h1 className="text-2xl font-semibold">Avisos</h1>

        {err && (
          <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            <span>{err}</span>
            <button
              type="button"
              onClick={load}
              className="focus-ring shrink-0 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white hover:bg-white/10"
            >
              Reintentar
            </button>
          </div>
        )}

        {!data && !err && <p className="mt-6 text-sm text-white/60">Cargando avisos…</p>}

        {votos && (
          <section className="mt-5 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-200/80">Votos pendientes</div>
            <p className="mt-1 text-base font-semibold text-white">{votos.title}</p>
            {votos.message && <p className="mt-1 whitespace-pre-line text-sm text-white/70">{votos.message}</p>}
            <Link
              to={votos.action_url || "/ratings/pending-ui"}
              className="focus-ring mt-3 inline-flex min-h-[44px] items-center rounded-xl bg-emerald-500 px-4 text-base font-semibold text-black hover:bg-emerald-400"
            >
              Votar ahora
            </Link>
          </section>
        )}

        {data && avisos.length === 0 && !votos && (
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 px-4 py-8 text-center">
            <p className="text-base font-semibold">Estás al día.</p>
            <p className="mt-1 text-sm text-white/60">Cuando haya novedades del grupo, te aparecen acá.</p>
          </div>
        )}

        {avisos.length > 0 && (
          <ul className="mt-5 space-y-3">
            {avisos.map((n) => (
              <li key={n.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-base font-semibold text-white">{n.title}</p>
                  {n.created_at && <span className="shrink-0 text-xs text-white/50">{fmtDate(n.created_at)}</span>}
                </div>
                {n.message && <p className="mt-1 whitespace-pre-line text-sm text-white/70">{n.message}</p>}
                {(n.action_url || n.dismissible) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <ActionLink
                      url={n.action_url}
                      className="focus-ring inline-flex min-h-[40px] items-center rounded-xl border border-amber-400/30 bg-amber-500/20 px-3 text-sm font-semibold text-amber-100 hover:bg-amber-500/30"
                    >
                      Abrir
                    </ActionLink>
                    {n.dismissible && (
                      <button
                        type="button"
                        onClick={() => dismiss(n.id)}
                        disabled={busyId === n.id}
                        className={cn(
                          "focus-ring inline-flex min-h-[40px] items-center rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white/80 hover:bg-white/10",
                          "disabled:opacity-40"
                        )}
                      >
                        {busyId === n.id ? "Descartando…" : "Descartar"}
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
