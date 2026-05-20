import { useNavigate } from "react-router-dom";
import { apiFetch, cn, fmtTime } from "./api.js";

function formatLongDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString([], {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function Row({ label, children }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/5 py-2 last:border-b-0">
      <div className="text-xs uppercase tracking-wide text-white/40">{label}</div>
      <div className="text-right text-sm text-white/85">{children}</div>
    </div>
  );
}

export default function CalendarItemSheet({ item, onClose, onAfterAction }) {
  const navigate = useNavigate();
  if (!item) return null;

  const eventId = item.type === "event" ? item.source_id : null;
  const tournamentId = item.type === "tournament_match" ? item.tournament?.id : null;
  const registrationId = item.participation?.registration_id || null;

  function handleRegister() {
    // El calendario no conoce las canchas disponibles; mandamos al usuario
    // a la pagina del evento donde puede elegir.
    if (!eventId) return;
    navigate(`/?event_id=${eventId}`);
    onClose?.();
  }

  async function handleUnregister() {
    if (!registrationId) return;
    if (!window.confirm("¿Cancelar tu lugar?")) return;
    try {
      await apiFetch(`/registrations/${registrationId}/cancel`, { method: "POST" });
      onAfterAction?.();
      onClose?.();
    } catch (e) {
      alert(e.message || "No se pudo cancelar.");
    }
  }

  function handleNavigate(url) {
    if (!url) return;
    if (url.startsWith("http://") || url.startsWith("https://")) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      navigate(url);
    }
    onClose?.();
  }

  const cta = item.cta || {};
  const time = fmtTime(item.starts_at);
  const longDate = formatLongDate(item.starts_at);

  return (
    <div className="bottom-sheet-overlay" onClick={onClose}>
      <div
        className="bottom-sheet-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />

        <div className="px-1">
          <div className="text-lg font-semibold text-white">{item.title}</div>
          {item.subtitle && (
            <div className="mt-0.5 text-sm text-white/60">{item.subtitle}</div>
          )}
          {item.description && (
            <p className="mt-3 whitespace-pre-line text-sm text-white/80">{item.description}</p>
          )}
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-3">
          <Row label="Cuando">{longDate}{time ? ` · ${time}` : ""}</Row>
          {item.location_name && <Row label="Donde">{item.location_name}</Row>}
          {item.type === "event" && item.counts?.capacity_total > 0 && (
            <Row label="Cupo">
              {item.counts.occupied_total}/{item.counts.capacity_total}
            </Row>
          )}
          {item.type === "tournament_match" && item.tournament?.name && (
            <Row label="Torneo">{item.tournament.name}</Row>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-2">
          {cta?.kind === "register" && (
            <button
              onClick={handleRegister}
              disabled={!!cta.disabled_reason}
              className={cn(
                "rounded-xl px-4 py-3 text-sm font-semibold",
                cta.disabled_reason
                  ? "bg-white/5 text-white/40"
                  : "bg-emerald-500 text-white hover:bg-emerald-400",
              )}
            >
              {cta.label || "Anotarme"}
            </button>
          )}
          {cta?.kind === "unregister" && (
            <button
              onClick={handleUnregister}
              className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-200 hover:bg-rose-500/20"
            >
              {cta.label || "Cancelar mi lugar"}
            </button>
          )}
          {(eventId || tournamentId) && (
            <button
              onClick={() => handleNavigate(eventId ? `/?event_id=${eventId}` : `/tournaments/${tournamentId}`)}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/80 hover:bg-white/10"
            >
              {eventId ? "Ver evento completo" : "Ver torneo"}
            </button>
          )}
          {cta?.kind === "external" && cta.url && (
            <button
              onClick={() => handleNavigate(cta.url)}
              className="rounded-xl border border-sky-400/30 bg-sky-500/10 px-4 py-3 text-sm font-semibold text-sky-200 hover:bg-sky-500/20"
            >
              {cta.label || "Abrir"}
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-white/50 hover:text-white"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

