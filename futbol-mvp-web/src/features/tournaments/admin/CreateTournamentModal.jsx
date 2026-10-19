import { useId, useState } from "react";
import { Sheet, SheetFooter, useSheetDirty } from "../../../design/ui/overlay/index.js";

const FORMATS = ["ROUND_ROBIN", "KNOCKOUT", "GROUPS_PLAYOFFS"];

const FORMAT_META = {
  ROUND_ROBIN: { label: "Todos contra todos", tooltip: "Cada equipo juega contra todos una vez. El primero en puntos gana." },
  KNOCKOUT: { label: "Eliminacion directa", tooltip: "El que pierde queda afuera. El ganador avanza a la siguiente ronda." },
  GROUPS_PLAYOFFS: { label: "Grupos + playoffs", tooltip: "Fase de grupos (todos contra todos) y luego eliminacion directa." },
};

const KNOCKOUT_COUNTS = [4, 8, 16];

const GP_CONFIGS = [
  { value: 4, label: "4 equipos — 2 grupos de 2" },
  { value: 6, label: "6 equipos — 2 grupos de 3" },
  { value: 8, label: "8 equipos — 2 grupos de 4" },
  { value: 10, label: "10 equipos — 2 grupos de 5" },
  { value: 12, label: "12 equipos — 4 grupos de 3" },
  { value: 16, label: "16 equipos — 4 grupos de 4" },
];

const INITIAL = {
  title: "",
  location_name: "",
  starts_at: "",
  format: "ROUND_ROBIN",
  teams_count: 4,
  minutes_per_match: 20,
};

export default function CreateTournamentModal({ open, busy, error, onClose, onCreate }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Crear torneo"
      dismiss="guarded"
      busy={busy}
      testId="create-tournament-sheet"
    >
      <CreateTournamentForm busy={busy} error={error} onCreate={onCreate} />
    </Sheet>
  );
}

// Se monta al abrir la hoja: cerrar descarta lo cargado y, si la API falla, queda todo como estaba.
function CreateTournamentForm({ busy, error, onCreate }) {
  const formId = useId();
  const [form, setForm] = useState({ ...INITIAL });
  useSheetDirty(Object.keys(INITIAL).some((k) => String(form[k]) !== String(INITIAL[k])));

  function handleFormatChange(e) {
    const fmt = e.target.value;
    let tc = form.teams_count;
    if (fmt === "KNOCKOUT" && !KNOCKOUT_COUNTS.includes(Number(tc))) tc = 4;
    if (fmt === "GROUPS_PLAYOFFS" && !GP_CONFIGS.some((c) => c.value === Number(tc))) tc = 8;
    setForm((p) => ({ ...p, format: fmt, teams_count: tc }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    onCreate({
      ...form,
      location_name: form.location_name || null,
      starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
      teams_count: Number(form.teams_count),
      minutes_per_match: Number(form.minutes_per_match),
    });
  }

  return (
    <form id={formId} className="space-y-3" onSubmit={handleSubmit}>
      {error ? (
        <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <label className="block text-xs font-semibold text-white/70">
        Nombre del torneo
        <input
          required
          placeholder="Ej: Torneo Viernes Noche"
          data-testid="create-tournament-title-input"
          value={form.title}
          onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
          className="focus-ring mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs font-semibold text-white/70">
          Ubicacion
          <input
            placeholder="Ej: El poli"
            data-testid="create-tournament-location-input"
            value={form.location_name}
            onChange={(e) => setForm((p) => ({ ...p, location_name: e.target.value }))}
            className="focus-ring mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
          />
        </label>
        <label className="block text-xs font-semibold text-white/70">
          Inicio
          <input
            type="datetime-local"
            data-testid="create-tournament-starts-at-input"
            value={form.starts_at}
            onChange={(e) => setForm((p) => ({ ...p, starts_at: e.target.value }))}
            className="focus-ring mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
          />
        </label>
      </div>

      <label className="block text-xs font-semibold text-white/70">
        Formato
        <select
          data-testid="create-tournament-format-select"
          value={form.format}
          onChange={handleFormatChange}
          className="focus-ring mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
        >
          {FORMATS.map((f) => (
            <option key={f} value={f}>{FORMAT_META[f].label}</option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-white/60">{FORMAT_META[form.format]?.tooltip}</span>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs font-semibold text-white/70">
          Cantidad de equipos
          {form.format === "GROUPS_PLAYOFFS" ? (
            <select
              data-testid="create-tournament-teams-count-input"
              value={form.teams_count}
              onChange={(e) => setForm((p) => ({ ...p, teams_count: e.target.value }))}
              className="focus-ring mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            >
              {GP_CONFIGS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          ) : form.format === "KNOCKOUT" ? (
            <select
              data-testid="create-tournament-teams-count-input"
              value={form.teams_count}
              onChange={(e) => setForm((p) => ({ ...p, teams_count: e.target.value }))}
              className="focus-ring mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            >
              {KNOCKOUT_COUNTS.map((c) => (
                <option key={c} value={c}>{c} equipos</option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              min={2}
              max={16}
              data-testid="create-tournament-teams-count-input"
              value={form.teams_count}
              onChange={(e) => setForm((p) => ({ ...p, teams_count: e.target.value }))}
              className="focus-ring mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            />
          )}
        </label>
        <label className="block text-xs font-semibold text-white/70">
          Minutos por partido
          <input
            type="number"
            min={5}
            max={120}
            data-testid="create-tournament-minutes-input"
            value={form.minutes_per_match}
            onChange={(e) => setForm((p) => ({ ...p, minutes_per_match: e.target.value }))}
            className="focus-ring mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
          />
        </label>
      </div>

      <SheetFooter>
        <button
          type="submit"
          form={formId}
          disabled={busy}
          data-testid="create-tournament-submit-btn"
          className="focus-ring min-h-[44px] w-full rounded-xl bg-emerald-500 px-4 py-3 text-base font-bold text-black hover:bg-emerald-400 disabled:opacity-40"
        >
          Crear torneo
        </button>
      </SheetFooter>
    </form>
  );
}
