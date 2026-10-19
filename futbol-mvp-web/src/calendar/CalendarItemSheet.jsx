import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, cn, fmtTime } from "./api.js";
import { Dialog, Sheet, SheetFooter, toast } from "../design/ui/overlay/index.js";

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
      <div className="text-xs uppercase tracking-wide text-white/60">{label}</div>
      <div className="text-right text-sm text-white/85">{children}</div>
    </div>
  );
}

export default function CalendarItemSheet({ item, onClose, onAfterAction }) {
  return (
    <Sheet
      open={!!item}
      onClose={onClose}
      title={item?.title}
      subtitle={item?.subtitle}
      testId="calendar-item-sheet"
    >
      {item ? <ItemDetail item={item} onClose={onClose} onAfterAction={onAfterAction} /> : null}
    </Sheet>
  );
}

function ItemDetail({ item, onClose, onAfterAction }) {
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    try {
      await apiFetch(`/registrations/${registrationId}/cancel`, { method: "POST" });
      setConfirmOpen(false);
      onAfterAction?.();
      onClose?.();
    } catch (e) {
      toast.error("No se pudo liberar el lugar", e.message || "Probá de nuevo.");
    } finally {
      setBusy(false);
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
  const hasActions =
    cta?.kind === "register" || cta?.kind === "unregister" || eventId || tournamentId || (cta?.kind === "external" && cta.url);

  return (
    <>
      {item.description && (
        <p className="whitespace-pre-line text-sm text-white/80">{item.description}</p>
      )}

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

      {hasActions && (
        <SheetFooter>
          <div className="flex flex-col gap-2">
            {cta?.kind === "register" && (
              <button
                type="button"
                onClick={handleRegister}
                disabled={!!cta.disabled_reason}
                data-testid="calendar-item-register-btn"
                className={cn(
                  "min-h-[44px] rounded-xl px-4 py-3 text-base font-semibold",
                  cta.disabled_reason
                    ? "bg-white/5 text-white/50"
                    : "bg-emerald-500 text-black hover:bg-emerald-400",
                )}
              >
                {cta.label || "Anotarme"}
              </button>
            )}
            {cta?.kind === "unregister" && (
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                data-testid="calendar-item-unregister-btn"
                className="min-h-[44px] rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-base font-semibold text-rose-200 hover:bg-rose-500/20"
              >
                {cta.label || "Cancelar mi lugar"}
              </button>
            )}
            {(eventId || tournamentId) && (
              <button
                type="button"
                onClick={() => handleNavigate(eventId ? `/?event_id=${eventId}` : `/tournaments/${tournamentId}`)}
                className="min-h-[44px] rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-base font-semibold text-white/80 hover:bg-white/10"
              >
                {eventId ? "Ver evento completo" : "Ver torneo"}
              </button>
            )}
            {cta?.kind === "external" && cta.url && (
              <button
                type="button"
                onClick={() => handleNavigate(cta.url)}
                className="min-h-[44px] rounded-xl border border-sky-400/30 bg-sky-500/10 px-4 py-3 text-base font-semibold text-sky-200 hover:bg-sky-500/20"
              >
                {cta.label || "Abrir"}
              </button>
            )}
          </div>
        </SheetFooter>
      )}

      {/* §7.2: bajarse afecta a otros (promueve a la espera), así que va con diálogo. */}
      <Dialog
        open={confirmOpen}
        title="¿Liberás tu lugar?"
        confirmLabel="Sí, liberar mi lugar"
        cancelLabel="Me quedo"
        busy={busy}
        onConfirm={handleUnregister}
        onCancel={() => setConfirmOpen(false)}
      >
        Si después querés volver, entrás al final.
      </Dialog>
    </>
  );
}
