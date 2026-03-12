import { useState } from "react";

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

export default function CreateTournamentModal({ open, busy, onClose, onCreate }) {
  const [form, setForm] = useState({ ...INITIAL });

  if (!open) return null;

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
    setForm({ ...INITIAL });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" onClick={onClose}>
      <div className="fixed inset-0 bg-black/70" />
      <div
        className="relative z-10 w-full max-w-lg rounded-t-2xl sm:rounded-2xl border border-white/10 bg-[#111] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Crear torneo</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-white/60 hover:text-white">✕</button>
        </div>

        <form className="space-y-3" onSubmit={handleSubmit}>
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
            <span className="mt-1 block text-xs text-white/50">{FORMAT_META[form.format]?.tooltip}</span>
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

          <button
            disabled={busy}
            data-testid="create-tournament-submit-btn"
            className="focus-ring w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-40"
          >
            Crear torneo
          </button>
        </form>
      </div>
    </div>
  );
}
