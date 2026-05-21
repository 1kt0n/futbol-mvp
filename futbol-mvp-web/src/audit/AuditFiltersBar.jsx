import { useEffect, useState } from "react";
import { apiFetch, cn } from "./api.js";
import { CATEGORIES, categoryLabel } from "./actionTemplates.jsx";

const DATE_PRESETS = [
  { key: "today", label: "Hoy" },
  { key: "7d", label: "7 días" },
  { key: "30d", label: "30 días" },
  { key: "custom", label: "Custom" },
];

function presetToRange(preset) {
  const now = new Date();
  if (preset === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { from: start.toISOString(), to: null };
  }
  if (preset === "7d") {
    const start = new Date(now);
    start.setDate(now.getDate() - 7);
    return { from: start.toISOString(), to: null };
  }
  if (preset === "30d") {
    const start = new Date(now);
    start.setDate(now.getDate() - 30);
    return { from: start.toISOString(), to: null };
  }
  return { from: null, to: null };
}

export default function AuditFiltersBar({ filters, onChange, onReset }) {
  const [events, setEvents] = useState([]);
  const [actors, setActors] = useState([]);
  const [actorQuery, setActorQuery] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch("/admin/events?include_finalized=true&limit=200");
        setEvents(r.events || []);
      } catch {
        setEvents([]);
      }
    })();
    (async () => {
      try {
        const r = await apiFetch("/admin/audit/actors");
        setActors(r.items || []);
      } catch {
        setActors([]);
      }
    })();
  }, []);

  function toggleCategory(cat) {
    const set = new Set(filters.categories || []);
    if (set.has(cat)) set.delete(cat);
    else set.add(cat);
    onChange({ ...filters, categories: Array.from(set) });
  }

  function setDatePreset(preset) {
    const { from, to } = presetToRange(preset);
    onChange({
      ...filters,
      datePreset: preset,
      from: preset === "custom" ? filters.from : from,
      to: preset === "custom" ? filters.to : to,
    });
  }

  const filteredActors = actorQuery
    ? actors.filter((a) => a.name?.toLowerCase().includes(actorQuery.toLowerCase()))
    : actors;

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3">
      {/* Categorías */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-white/40">
          Categorías
        </span>
        {CATEGORIES.map((cat) => {
          const active = (filters.categories || []).includes(cat);
          return (
            <button
              key={cat}
              onClick={() => toggleCategory(cat)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-semibold transition",
                active
                  ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-200"
                  : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10",
              )}
            >
              {categoryLabel(cat)}
            </button>
          );
        })}
      </div>

      {/* Fila evento + actor + sistema */}
      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-white/40">
            Evento
          </label>
          <select
            value={filters.event_id || ""}
            onChange={(e) => onChange({ ...filters, event_id: e.target.value || null })}
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
          >
            <option value="">Todos los eventos</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>{ev.title}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-white/40">
            Actor
          </label>
          <input
            list="audit-actors-list"
            value={filters.actor_name_query ?? actorQuery}
            onChange={(e) => {
              const q = e.target.value;
              setActorQuery(q);
              const match = actors.find((a) => a.name === q);
              onChange({
                ...filters,
                actor_user_id_filter: match?.id || null,
                actor_name_query: q,
              });
            }}
            placeholder="Buscar por nombre..."
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
          />
          <datalist id="audit-actors-list">
            {filteredActors.map((a) => (
              <option key={a.id} value={a.name} />
            ))}
          </datalist>
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-white/40">
            Sistema
          </label>
          <label className="flex h-[38px] items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3">
            <input
              type="checkbox"
              checked={!!filters.include_system}
              onChange={(e) => onChange({ ...filters, include_system: e.target.checked })}
            />
            <span className="text-xs text-white/70">Incluir acciones AUTO</span>
          </label>
        </div>
      </div>

      {/* Fechas */}
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/40">
          Rango
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {DATE_PRESETS.map((p) => {
            const active = (filters.datePreset || "30d") === p.key;
            return (
              <button
                key={p.key}
                onClick={() => setDatePreset(p.key)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-semibold transition",
                  active
                    ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-200"
                    : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10",
                )}
              >
                {p.label}
              </button>
            );
          })}
          {filters.datePreset === "custom" && (
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                type="datetime-local"
                value={filters.from_local || ""}
                onChange={(e) => {
                  const v = e.target.value;
                  onChange({
                    ...filters,
                    from_local: v,
                    from: v ? new Date(v).toISOString() : null,
                  });
                }}
                className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-white"
              />
              <span className="text-xs text-white/40">→</span>
              <input
                type="datetime-local"
                value={filters.to_local || ""}
                onChange={(e) => {
                  const v = e.target.value;
                  onChange({
                    ...filters,
                    to_local: v,
                    to: v ? new Date(v).toISOString() : null,
                  });
                }}
                className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-white"
              />
            </div>
          )}
          <button
            onClick={() => {
              setActorQuery("");
              onReset();
            }}
            className="ml-auto rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/60 hover:bg-white/10"
          >
            Limpiar
          </button>
        </div>
      </div>
    </div>
  );
}
