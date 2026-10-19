// Hojas y diálogos de la pantalla del partido. Compartir, Invitar y la baja van en
// la URL (?sheet=compartir|invitar|baja): el atrás de Android los cierra y, con
// un nombre escrito en Invitar, pregunta antes de descartarlo.

import { useState } from "react";
import { Dialog, Sheet, toast } from "../../design/ui/overlay/index.js";
import { courtPhrase } from "./format.js";
import { firstName } from "./matchLogic.js";
import { whatsAppHref } from "./messages.js";

const BTN_PRIMARY =
  "focus-ring inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-emerald-500 px-4 text-base font-semibold text-black hover:bg-emerald-400 disabled:opacity-50";

export function ShareSheet({ open, onClose, history, link, message }) {
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: "Link copiado." });
    } catch {
      toast({ kind: "error", title: "No pudimos copiar el link. Mantené apretado para copiarlo." });
    }
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      history={history}
      title="Compartí el partido"
      testId="share-sheet"
      footer={
        <a
          href={whatsAppHref(message)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClose}
          data-testid="share-whatsapp-btn"
          className={BTN_PRIMARY}
        >
          Enviar por WhatsApp
        </a>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-white/55">Link del partido</div>
          <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            <code className="min-w-0 flex-1 truncate text-sm" data-testid="share-link">
              {link.replace(/^https?:\/\//, "")}
            </code>
            <button
              type="button"
              onClick={copyLink}
              data-testid="share-copy-btn"
              className="focus-ring min-h-[40px] shrink-0 rounded-lg px-2 text-sm font-semibold text-emerald-300 hover:bg-white/10"
            >
              Copiar link
            </button>
          </div>
          <p className="mt-1.5 text-xs text-white/55">Abre la app y, si hace falta, pide iniciar sesión.</p>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-white/55">Mensaje para el grupo</div>
          <p
            className="mt-1.5 whitespace-pre-wrap rounded-xl border border-white/10 bg-[#0b141a] p-3 text-sm leading-relaxed text-[#e9edef]"
            data-testid="share-message"
          >
            {message}
          </p>
        </div>
      </div>
    </Sheet>
  );
}

export function GuestSheet({
  open,
  onClose,
  history,
  canAdd,
  closedReason,
  limitText,
  guests,
  busy,
  onAdd,
  onRemove,
}) {
  const [name, setName] = useState("");
  const trimmed = name.trim();

  async function submit(e) {
    e.preventDefault();
    if (trimmed.length < 2 || busy) return;
    const ok = await onAdd(trimmed);
    if (ok) setName("");
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        setName("");
        onClose();
      }}
      history={history}
      title="Sumar invitado"
      dismiss="guarded"
      dirty={trimmed.length > 0}
      busy={busy}
      testId="guest-sheet"
    >
      <div className="space-y-4">
        {closedReason ? (
          <p role="status" className="rounded-xl border border-sky-400/30 bg-sky-500/10 px-3 py-2.5 text-sm text-sky-100">
            {closedReason}
          </p>
        ) : null}
        <form onSubmit={submit} className="space-y-2">
          <label htmlFor="guest-name" className="text-xs font-semibold uppercase tracking-wide text-white/55">
            Nombre
          </label>
          <div className="flex gap-2">
            <input
              id="guest-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canAdd}
              maxLength={60}
              autoComplete="off"
              enterKeyHint="done"
              placeholder="Nombre del invitado"
              data-testid="guest-name-input"
              className="min-h-[48px] min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 text-base text-white placeholder:text-white/40 focus:border-emerald-400/60 focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!canAdd || busy || trimmed.length < 2}
              data-testid="guest-submit-btn"
              className="focus-ring min-h-[48px] shrink-0 rounded-xl bg-emerald-500 px-4 text-base font-semibold text-black hover:bg-emerald-400 disabled:opacity-50"
            >
              {busy ? "Sumando…" : "Sumar"}
            </button>
          </div>
          <p className="text-sm text-white/60">{limitText}</p>
        </form>
        {guests.length ? (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-white/55">Mis invitados</div>
            <ul className="space-y-1.5">
              {guests.map((g) => (
                <li key={g.registration_id} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {firstName(g.name)}
                    <span className="text-white/50"> · {g.court ? g.court.name : "en espera"}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemove(g)}
                    data-testid={`guest-remove-${g.registration_id}`}
                    className="focus-ring min-h-[40px] rounded-lg px-2 text-sm text-white/70 underline underline-offset-4 hover:text-white"
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

/**
 * "¿Liberás tu lugar?" (§7.2). Si el navegador frenó la ventana de WhatsApp (iOS
 * después de un await), queda en un paso "Listo" con un botón que la abre con un
 * toque real.
 */
export function LeaveDialog({ open, history, late, taker, busy, doneHref, onConfirm, onCancel }) {
  if (doneHref) {
    return (
      <Dialog
        open={open}
        history={history}
        title="Listo, liberaste tu lugar"
        confirmLabel="Abrir WhatsApp"
        cancelLabel="Cerrar"
        onConfirm={onConfirm}
        onCancel={onCancel}
        testId="leave-dialog"
        confirmTestId="leave-confirm-btn"
        cancelTestId="leave-cancel-btn"
      >
        Avisale al grupo así no quedan cortos.
      </Dialog>
    );
  }
  return (
    <Dialog
      open={open}
      history={history}
      title="¿Liberás tu lugar?"
      confirmLabel={late ? "Liberar y avisar al grupo" : "Sí, liberar mi lugar"}
      cancelLabel="Me quedo"
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
      testId="leave-dialog"
      confirmTestId="leave-confirm-btn"
      cancelTestId="leave-cancel-btn"
    >
      {late ? <span className="mb-2 block">Falta poco para el partido. Avisale al grupo así no quedan cortos.</span> : null}
      {taker ? `Lo toma ${taker}, que está primero en la espera.` : "Tu lugar queda libre para otro."} Si después
      querés volver, entrás al final.
    </Dialog>
  );
}

/** 409 COURT_FULL (§7.4): se ofrece la mejor alternativa o la espera. */
export function CourtFullDialog({ state, busy, onAccept, onWaitlist, onCancel }) {
  if (!state) return null;
  const { courtName, alternative } = state;
  const title = `Justo se llenó ${courtPhrase(courtName)}`;
  if (alternative) {
    const label = `Sí, a ${courtPhrase(alternative.name)}`;
    return (
      <Dialog
        open
        title={title}
        confirmLabel={label.length > 20 ? "Sí, a esa cancha" : label}
        busy={busy}
        onConfirm={onAccept}
        onCancel={onCancel}
        testId="court-full-dialog"
        confirmTestId="court-full-accept-btn"
        cancelTestId="court-full-cancel-btn"
      >
        ¿Te sumamos a {courtPhrase(alternative.name)}, que tiene{" "}
        {alternative.available === 1 ? "1 lugar" : `${alternative.available} lugares`}?
      </Dialog>
    );
  }
  return (
    <Dialog
      open
      title={title}
      confirmLabel="Anotarme en espera"
      busy={busy}
      onConfirm={onWaitlist}
      onCancel={onCancel}
      testId="court-full-dialog"
      confirmTestId="court-full-accept-btn"
      cancelTestId="court-full-cancel-btn"
    >
      El partido quedó completo. Si se libera un lugar, entrás solo.
    </Dialog>
  );
}

/** Sacar a otro (quien organiza, capitán o quien lo invitó). */
export function RemoveDialog({ target, taker, busy, onConfirm, onCancel }) {
  if (!target) return null;
  const { player, court } = target;
  const name = firstName(player.name) || "este jugador";
  let body = "Su lugar queda libre.";
  if (!court) body = "Sale de la lista de espera.";
  else if (taker) body = `Lo toma ${taker}, que está primero en la espera.`;
  return (
    <Dialog
      open
      title={`¿Sacás a ${name} del partido?`}
      confirmLabel="Sí, sacar"
      tone="danger"
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
      testId="remove-dialog"
      confirmTestId="remove-confirm-btn"
      cancelTestId="remove-cancel-btn"
    >
      {body}
    </Dialog>
  );
}
