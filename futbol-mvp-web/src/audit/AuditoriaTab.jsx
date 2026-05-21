import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, dayLabelAR } from "./api.js";
import AuditItem from "./AuditItem.jsx";
import AuditFiltersBar from "./AuditFiltersBar.jsx";

const PAGE_SIZE = 50;

function defaultFilters() {
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    categories: [],
    event_id: null,
    actor_user_id_filter: null,
    actor_name_query: "",
    include_system: false,
    datePreset: "30d",
    from: from.toISOString(),
    to: null,
    from_local: "",
    to_local: "",
  };
}

function buildQuery(filters, offset) {
  const params = new URLSearchParams();
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(offset));
  params.set("include_system", filters.include_system ? "true" : "false");
  if (filters.event_id) params.set("event_id", filters.event_id);
  if (filters.actor_user_id_filter) params.set("actor_user_id_filter", filters.actor_user_id_filter);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  for (const c of filters.categories || []) params.append("category", c);
  return params.toString();
}

export default function AuditoriaTab() {
  const [filters, setFilters] = useState(defaultFilters);
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState("");
  const [offset, setOffset] = useState(0);

  const load = useCallback(async (resetOffset = true) => {
    if (resetOffset) {
      setLoading(true);
      setOffset(0);
    } else {
      setLoadingMore(true);
    }
    setErr("");
    try {
      const nextOffset = resetOffset ? 0 : offset + PAGE_SIZE;
      const qs = buildQuery(filters, nextOffset);
      const data = await apiFetch(`/admin/audit?${qs}`);
      const newItems = data.items || [];
      setHasMore(!!data.has_more);
      if (resetOffset) {
        setItems(newItems);
        setOffset(0);
      } else {
        setItems((prev) => [...prev, ...newItems]);
        setOffset(nextOffset);
      }
    } catch (e) {
      setErr(e.message || "No se pudo cargar la auditoría.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [filters, offset]);

  // Reset y recarga cuando cambian filtros
  const categoriesKey = (filters.categories || []).join(",");
  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    categoriesKey,
    filters.event_id,
    filters.actor_user_id_filter,
    filters.include_system,
    filters.from,
    filters.to,
  ]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      const key = dayLabelAR(it.created_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }
    return Array.from(map.entries());
  }, [items]);

  return (
    <div className="space-y-4">
      <AuditFiltersBar
        filters={filters}
        onChange={setFilters}
        onReset={() => setFilters(defaultFilters())}
      />

      {err && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {err}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-white/50">
          Cargando...
        </div>
      ) : grouped.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-white/60">
          Sin actividad para estos filtros.
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([day, group]) => (
            <section key={day}>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/40">
                {day}
              </div>
              <div className="space-y-2">
                {group.map((log) => (
                  <AuditItem key={log.id} log={log} />
                ))}
              </div>
            </section>
          ))}

          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                onClick={() => load(false)}
                disabled={loadingMore}
                className="rounded-xl border border-white/10 bg-white/5 px-5 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 disabled:opacity-50"
              >
                {loadingMore ? "Cargando..." : "Cargar más"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
