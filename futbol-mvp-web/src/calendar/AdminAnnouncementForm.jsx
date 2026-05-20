import { useEffect, useState } from "react";
import { apiFetch, cn } from "./api.js";

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

export default function AdminAnnouncementForm({ open, onClose, onSaved, editing }) {
  const isEdit = !!editing;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [locationName, setLocationName] = useState("");
  const [actionUrl, setActionUrl] = useState("");
  const [actionLabel, setActionLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(editing?.title || "");
    setDescription(editing?.description || "");
    setStartsAt(isoToLocalInput(editing?.starts_at));
    setEndsAt(isoToLocalInput(editing?.ends_at));
    setLocationName(editing?.location_name || "");
    setActionUrl(editing?.action_url || "");
    setActionLabel(editing?.action_label || "");
    setErr("");
  }, [open, editing]);

  if (!open) return null;

  async function handleSave(e) {
    e.preventDefault();
    setErr("");
    if (title.trim().length < 3) {
      setErr("El titulo necesita al menos 3 caracteres.");
      return;
    }
    if (!startsAt) {
      setErr("Indica la fecha y hora.");
      return;
    }

    setBusy(true);
    try {
      const body = {
        title: title.trim(),
        description: description.trim() || null,
        starts_at: startsAt,
        ends_at: endsAt || null,
        location_name: locationName.trim() || null,
        action_url: actionUrl.trim() || null,
        action_label: actionLabel.trim() || null,
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
      onSaved?.();
      onClose?.();
    } catch (e) {
      setErr(e.message || "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSave}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">
            {isEdit ? "Editar anuncio" : "Nuevo anuncio"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-white/50 hover:bg-white/10 hover:text-white"
          >
            Cerrar
          </button>
        </div>

        {err && (
          <div className="mb-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {err}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-white/50">
              Titulo
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={160}
              required
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
              placeholder="Cierre de inscripciones Liga A"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-white/50">
              Descripcion
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1200}
              rows={3}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
              placeholder="Opcional"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-white/50">
                Cuando
              </label>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                required
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-white focus:border-white/30 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-white/50">
                Hasta (opcional)
              </label>
              <input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-white focus:border-white/30 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-white/50">
              Donde (opcional)
            </label>
            <input
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
              maxLength={160}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
              placeholder="Cancha Norte"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-white/50">
                Link (opcional)
              </label>
              <input
                value={actionUrl}
                onChange={(e) => setActionUrl(e.target.value)}
                maxLength={500}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
                placeholder="https://..."
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-white/50">
                Texto del boton
              </label>
              <input
                value={actionLabel}
                onChange={(e) => setActionLabel(e.target.value)}
                maxLength={40}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
                placeholder="Inscribirme"
              />
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy}
            className={cn(
              "rounded-xl bg-emerald-500 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-400",
              busy && "opacity-60",
            )}
          >
            {busy ? "Guardando..." : (isEdit ? "Guardar cambios" : "Crear anuncio")}
          </button>
        </div>
      </form>
    </div>
  );
}
