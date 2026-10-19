import { useId, useState } from "react";
import { apiFetch, cn } from "./api.js";
import { Sheet, SheetFooter, useSheetBusy, useSheetClose, useSheetDirty } from "../design/ui/overlay/index.js";

function isoToLocalInput(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

const FIELD =
  "w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-white placeholder:text-white/40 focus:border-white/30 focus:outline-none";
const LABEL = "mb-1 block text-xs font-medium uppercase tracking-wide text-white/60";

function initialValues(editing) {
  return {
    title: editing?.title || "",
    description: editing?.description || "",
    startsAt: isoToLocalInput(editing?.starts_at),
    endsAt: isoToLocalInput(editing?.ends_at),
    locationName: editing?.location_name || "",
    actionUrl: editing?.action_url || "",
    actionLabel: editing?.action_label || "",
  };
}

export default function AdminAnnouncementForm({ open, onClose, onSaved, editing }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? "Editar anuncio" : "Nuevo anuncio"}
      dismiss="guarded"
      testId="announcement-sheet"
    >
      <AnnouncementFields editing={editing} onClose={onClose} onSaved={onSaved} />
    </Sheet>
  );
}

// Se monta al abrir la hoja: el estado arranca de `editing` y se descarta al cerrar.
function AnnouncementFields({ editing, onClose, onSaved }) {
  const isEdit = !!editing;
  const id = useId();
  const [initial] = useState(() => initialValues(editing));
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const requestClose = useSheetClose();
  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }));

  useSheetDirty(Object.keys(initial).some((k) => values[k] !== initial[k]));
  useSheetBusy(busy);

  async function handleSave(e) {
    e.preventDefault();
    setErr("");
    if (values.title.trim().length < 3) {
      setErr("El titulo necesita al menos 3 caracteres.");
      return;
    }
    if (!values.startsAt) {
      setErr("Indica la fecha y hora.");
      return;
    }

    setBusy(true);
    try {
      const body = {
        title: values.title.trim(),
        description: values.description.trim() || null,
        starts_at: values.startsAt,
        ends_at: values.endsAt || null,
        location_name: values.locationName.trim() || null,
        action_url: values.actionUrl.trim() || null,
        action_label: values.actionLabel.trim() || null,
      };
      if (isEdit) {
        await apiFetch(`/admin/calendar/announcements/${editing.id}`, {
          method: "PATCH",
          body,
        });
      } else {
        await apiFetch(`/admin/calendar/announcements`, {
          method: "POST",
          body,
        });
      }
      setBusy(false);
      onSaved?.();
      onClose?.();
    } catch (e) {
      setErr(e.message || "No se pudo guardar.");
      setBusy(false);
    }
  }

  return (
    <form id={`${id}-form`} onSubmit={handleSave}>
      {err && (
        <div role="alert" className="mb-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {err}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label htmlFor={`${id}-title`} className={LABEL}>
            Titulo
          </label>
          <input
            id={`${id}-title`}
            value={values.title}
            onChange={set("title")}
            maxLength={160}
            required
            data-testid="announcement-title-input"
            className={FIELD}
            placeholder="Cierre de inscripciones Liga A"
          />
        </div>

        <div>
          <label htmlFor={`${id}-description`} className={LABEL}>
            Descripcion
          </label>
          <textarea
            id={`${id}-description`}
            value={values.description}
            onChange={set("description")}
            maxLength={1200}
            rows={3}
            className={FIELD}
            placeholder="Opcional"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${id}-starts`} className={LABEL}>
              Cuando
            </label>
            <input
              id={`${id}-starts`}
              type="datetime-local"
              value={values.startsAt}
              onChange={set("startsAt")}
              required
              className={FIELD}
            />
          </div>
          <div>
            <label htmlFor={`${id}-ends`} className={LABEL}>
              Hasta (opcional)
            </label>
            <input
              id={`${id}-ends`}
              type="datetime-local"
              value={values.endsAt}
              onChange={set("endsAt")}
              className={FIELD}
            />
          </div>
        </div>

        <div>
          <label htmlFor={`${id}-location`} className={LABEL}>
            Donde (opcional)
          </label>
          <input
            id={`${id}-location`}
            value={values.locationName}
            onChange={set("locationName")}
            maxLength={160}
            className={FIELD}
            placeholder="Cancha Norte"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${id}-url`} className={LABEL}>
              Link (opcional)
            </label>
            <input
              id={`${id}-url`}
              value={values.actionUrl}
              onChange={set("actionUrl")}
              maxLength={500}
              className={FIELD}
              placeholder="https://..."
            />
          </div>
          <div>
            <label htmlFor={`${id}-label`} className={LABEL}>
              Texto del boton
            </label>
            <input
              id={`${id}-label`}
              value={values.actionLabel}
              onChange={set("actionLabel")}
              maxLength={40}
              className={FIELD}
              placeholder="Inscribirme"
            />
          </div>
        </div>
      </div>

      <SheetFooter>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={requestClose}
            disabled={busy}
            className="min-h-[44px] flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-base font-semibold text-white/80 hover:bg-white/10 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form={`${id}-form`}
            disabled={busy}
            data-testid="announcement-submit-btn"
            className={cn(
              "min-h-[44px] flex-1 rounded-xl bg-emerald-500 px-4 py-3 text-base font-semibold text-black hover:bg-emerald-400",
              busy && "opacity-60",
            )}
          >
            {busy ? "Guardando..." : (isEdit ? "Guardar cambios" : "Crear anuncio")}
          </button>
        </div>
      </SheetFooter>
    </form>
  );
}
