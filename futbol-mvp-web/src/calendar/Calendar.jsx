import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, cn } from "./api.js";
import CalendarItem from "./CalendarItem.jsx";
import CalendarItemSheet from "./CalendarItemSheet.jsx";
import AdminCreateMenu from "./AdminCreateMenu.jsx";
import AdminAnnouncementForm from "./AdminAnnouncementForm.jsx";

function getActorId() {
  return localStorage.getItem("actorUserId") || localStorage.getItem("actor_id") || "";
}

export default function Calendar() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("upcoming"); // "upcoming" | "past"
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [openItem, setOpenItem] = useState(null);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [announcementFormOpen, setAnnouncementFormOpen] = useState(false);

  const isAdmin = !!data?.is_admin;

  const load = useCallback(async () => {
    setErr("");
    setLoading(true);
    try {
      const includePast = tab === "past";
      const res = await apiFetch(`/me/calendar?include_past=${includePast}`);
      setData(res);
    } catch (e) {
      setErr(e.message || "No se pudo cargar el calendario.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    if (!getActorId()) {
      navigate("/");
      return;
    }
    load();
  }, [load, navigate]);

  const groupedByDay = useMemo(() => {
    const items = data?.items || [];
    const map = new Map();
    for (const it of items) {
      const key = it.day_label || "Sin fecha";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }
    return Array.from(map.entries()); // preserves order
  }, [data]);

  return (
    <div className="page-enter min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 px-4 py-6">
      <div className="mx-auto max-w-lg">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-white">Mi Calendario</h1>
          <button
            onClick={() => navigate("/")}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
          >
            Volver
          </button>
        </div>

        {/* Tabs */}
        <div className="mb-5 inline-flex rounded-xl border border-white/10 bg-white/5 p-1">
          {[
            { key: "upcoming", label: "Proximos" },
            { key: "past", label: "Pasados" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "rounded-lg px-4 py-1.5 text-sm font-semibold transition",
                tab === t.key
                  ? "bg-white text-black"
                  : "text-white/70 hover:text-white",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {err && (
          <div className="mb-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {err}
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-white/50">
            Cargando...
          </div>
        ) : groupedByDay.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <div className="space-y-5 pb-24">
            {groupedByDay.map(([day, items]) => (
              <section key={day}>
                <div className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/40">
                  {day}
                </div>
                <div className="space-y-2">
                  {items.map((it) => (
                    <CalendarItem
                      key={`${it.type}:${it.source_id}`}
                      item={it}
                      onClick={setOpenItem}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* Admin FAB */}
      {isAdmin && (
        <button
          onClick={() => setAdminMenuOpen(true)}
          aria-label="Agregar al calendario"
          className="fixed bottom-6 right-6 grid h-14 w-14 place-items-center rounded-full bg-emerald-500 text-2xl font-bold text-white shadow-2xl shadow-emerald-500/40 hover:bg-emerald-400"
        >
          +
        </button>
      )}

      {/* Sheets / Modals */}
      <CalendarItemSheet
        item={openItem}
        onClose={() => setOpenItem(null)}
        onAfterAction={load}
      />
      <AdminCreateMenu
        open={adminMenuOpen}
        onClose={() => setAdminMenuOpen(false)}
        onCreateAnnouncement={() => setAnnouncementFormOpen(true)}
      />
      <AdminAnnouncementForm
        open={announcementFormOpen}
        onClose={() => setAnnouncementFormOpen(false)}
        onSaved={load}
      />
    </div>
  );
}

function EmptyState({ tab }) {
  if (tab === "past") {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
        <div className="mb-2 text-3xl">📭</div>
        <div className="text-sm font-semibold text-white">Sin historial reciente</div>
        <div className="mt-1 text-xs text-white/50">
          Aca van a aparecer los partidos y eventos pasados.
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
      <div className="mb-2 text-3xl">📅</div>
      <div className="text-sm font-semibold text-white">No tenes nada agendado</div>
      <div className="mt-1 text-xs text-white/50">
        Cuando te anotes a un evento o a un torneo, lo vas a ver aca.
      </div>
    </div>
  );
}
