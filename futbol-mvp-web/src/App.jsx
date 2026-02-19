import { useEffect, useMemo, useState } from "react";
import AuthLayout from "./features/auth/AuthLayout.jsx";
import BrandHero from "./features/auth/BrandHero.jsx";
import AuthFlowCard, { InstallPwaButton } from "./features/auth/AuthFlowCard.jsx";

const API_BASE = (
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  ""
).trim(); // default: same-origin
const BRAND_LOGO_URL = "/tercer-tiempo-logo.png";
const PLAYER_LEVEL_LABELS = {
  INICIAL: "Inicial",
  RECREATIVO: "Recreativo",
  COMPETITIVO: "Competitivo",
};
const ATTRIBUTE_LABELS = {
  EQUIPO: "Juego en equipo",
  VISION: "Vision",
  INTENSIDAD: "Intensidad",
  DEFENSA: "Defensa",
  ATAQUE: "Ataque",
  FAIRPLAY: "Fair Play",
};
const PLAYER_CARD_CACHE_TTL_MS = 60_000;

// -------- Actor helpers --------
function getActorId() {
  return (
    localStorage.getItem("actorUserId") ||
    localStorage.getItem("actor_id") ||
    ""
  );
}

function setActorId(v) {
  localStorage.setItem("actorUserId", v);
  localStorage.setItem("actor_id", v); // compat
}

function clearActorId() {
  localStorage.removeItem("actorUserId");
  localStorage.removeItem("actor_id");
  localStorage.removeItem("actor_me");
}

function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(v || "").trim()
  );
}

function cn(...xs) {
  return xs.filter(Boolean).join(" ");
}

function fmtStart(startsAt) {
  try {
    const d = new Date(startsAt);
    if (Number.isNaN(d.getTime())) return String(startsAt);
    return d.toLocaleString([], {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(startsAt);
  }
}

function initials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || "?";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase();
}

// -------- API --------
async function apiFetch(path, { method = "GET", body, actorOverride } = {}) {
  const actor = String(actorOverride ?? getActorId()).trim();
  if (!actor) throw new Error("Falta Actor ID (X-Actor-User-Id).");

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      "X-Actor-User-Id": actor,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const data = isJson
    ? await res.json().catch(() => null)
    : await res.text().catch(() => "");

  if (!res.ok) {
    const detail = data?.detail ?? data?.message ?? data;
    const msg =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((x) => x?.msg).filter(Boolean).join(" | ") || `HTTP ${res.status}`
          : `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data;
}

async function apiFetchPublic(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");

  if (!res.ok) {
    const detail = data?.detail ?? data?.message ?? data;
    const msg =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((x) => x?.msg).filter(Boolean).join(" | ") || `HTTP ${res.status}`
          : `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data;
}

// -------- UI pieces --------
function Banner({ kind = "info", title, children, onClose }) {
  const tone = {
    info: {
      wrap: "border-white/10 bg-white/5",
      dot: "bg-white/60",
      title: "text-white",
      text: "text-white/70",
    },
    error: {
      wrap: "border-rose-500/30 bg-rose-500/10",
      dot: "bg-rose-400",
      title: "text-rose-100",
      text: "text-rose-100/80",
    },
    success: {
      wrap: "border-emerald-400/30 bg-emerald-400/10",
      dot: "bg-emerald-300",
      title: "text-emerald-50",
      text: "text-emerald-50/80",
    },
    warn: {
      wrap: "border-amber-400/30 bg-amber-400/10",
      dot: "bg-amber-300",
      title: "text-amber-50",
      text: "text-amber-50/80",
    },
  }[kind];

  return (
    <div
      className={cn(
        "mt-4 rounded-2xl border px-4 py-3 shadow-lg shadow-black/10",
        tone.wrap
      )}
      role={kind === "error" ? "alert" : undefined}
    >
      <div className="flex items-start gap-3">
        <div className={cn("mt-1 h-2 w-2 rounded-full", tone.dot)} />
        <div className="min-w-0 flex-1">
          {title ? (
            <div className={cn("text-sm font-semibold", tone.title)}>{title}</div>
          ) : null}
          <div className={cn("mt-1 text-sm", tone.text)}>{children}</div>
        </div>
        {onClose ? (
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xs text-white/70 hover:bg-white/10"
          >
            Cerrar
          </button>
        ) : null}
      </div>
    </div>
  );
}

function StatPill({ label, value, tone = "neutral" }) {
  const map = {
    neutral: "border-white/10 bg-white/5 text-white/80",
    good: "border-emerald-400/20 bg-emerald-400/10 text-emerald-50",
    warn: "border-amber-400/20 bg-amber-400/10 text-amber-50",
    bad: "border-rose-400/20 bg-rose-400/10 text-rose-50",
  };

  return (
    <div className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs", map[tone])}>
      <span className="text-white/60">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function PlayerCardModal({ open, onClose, loading, error, selectedPlayer, cardData }) {
  if (!open) return null;

  const name = cardData?.full_name || cardData?.guest_name || selectedPlayer?.name || "Jugador";
  const avatarUrl = selectedPlayer?.avatar_url || null;
  const isGuest = (cardData?.subject_type || selectedPlayer?.type) === "GUEST";
  const level = cardData?.player_level || selectedPlayer?.player_level || null;

  let message = "";
  if (!cardData?.participates) {
    if (cardData?.reason === "VIEWER_OPT_OUT") {
      message = "Para ver perfiles de juego tenes que activar 'Participar del perfil de juego' en tu perfil.";
    } else if (cardData?.reason === "TARGET_OPT_OUT") {
      message = "Este jugador no participa del Perfil de Juego.";
    } else if (cardData?.reason === "GUEST" || isGuest) {
      message = "Invitado (sin perfil).";
    } else if (!loading && !error) {
      message = "Perfil no disponible en este momento.";
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="button"
      tabIndex={-1}
    >
      <div
        className={cn(
          "fixed bottom-0 left-0 right-0 rounded-t-3xl border border-white/10 bg-zinc-950/95 p-4 shadow-2xl shadow-black/40",
          "max-h-[85vh] overflow-y-auto",
          "sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:right-auto sm:w-[420px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between">
          <div className="flex items-center gap-3">
            {avatarUrl ? (
              <img src={avatarUrl} alt={name} className="h-12 w-12 rounded-full object-cover" />
            ) : (
              <div className="grid h-12 w-12 place-items-center rounded-full bg-white/10 text-sm font-bold text-white">
                {initials(name)}
              </div>
            )}
            <div>
              <div className="text-base font-semibold text-white">{name}</div>
              {isGuest ? (
                <span className="mt-1 inline-flex rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-white/80">
                  Invitado
                </span>
              ) : level ? (
                <span className="mt-1 inline-flex rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-white/80">
                  {PLAYER_LEVEL_LABELS[level] || level}
                </span>
              ) : null}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white"
          >
            X
          </button>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/70">
            Cargando perfil...
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        {!loading && !error && cardData?.participates ? (
          <div className="space-y-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-white/50">Perfil de juego</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(cardData?.top_attributes || []).length > 0 ? (
                  cardData.top_attributes.map((attr) => (
                    <span
                      key={`${attr.code}-${attr.count}`}
                      className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-200"
                    >
                      {ATTRIBUTE_LABELS[attr.code] || attr.code}
                      <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-white/80">{attr.count}</span>
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-white/60">Todavia no hay atributos suficientes.</span>
                )}
              </div>

              <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
                <span className="font-semibold text-amber-200">
                  {`⭐ ${Number(cardData?.rating?.avg ?? 0).toFixed(1)}`}
                </span>
                <span className="ml-2 text-white/60">
                  {`${cardData?.rating?.votes ?? 0} voto${(cardData?.rating?.votes ?? 0) === 1 ? "" : "s"}`}
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {!loading && !error && !cardData?.participates && message ? (
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/70">
            {message}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CourtCard({ court, courts, busy, eventStatus, onRegisterSelf, onCancel, onMove, onPlayerClick }) {
  const pct = court.capacity > 0 ? Math.round((court.occupied / court.capacity) * 100) : 0;
  const fullnessTone = pct >= 100 ? "bad" : pct >= 80 ? "warn" : "good";
  const canRegister = eventStatus === "OPEN" && court.is_open;

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl shadow-black/10" data-testid={`court-card-${court.court_id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-white">{court.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StatPill label="Ocupación" value={`${court.occupied}/${court.capacity}`} tone={fullnessTone} />
            <StatPill label="Disponibles" value={court.available} tone={court.available > 0 ? "good" : "bad"} />
            {!court.is_open && (
              <StatPill label="Estado" value={court.occupied >= court.capacity ? "Llena" : "Cerrada"} tone="bad" />
            )}
          </div>
        </div>

        <button
          disabled={busy || !canRegister}
          onClick={() => onRegisterSelf(court.court_id)}
          data-testid={`court-register-${court.court_id}`}
          className={cn(
            "shrink-0 rounded-2xl px-4 py-2 text-sm font-semibold",
            "bg-white text-black hover:bg-white/90",
            "disabled:cursor-not-allowed disabled:opacity-40"
          )}
        >
          Anotarme
        </button>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-black/20">
        <div
          className={cn(
            "h-full rounded-full",
            pct >= 100 ? "bg-rose-400" : pct >= 80 ? "bg-amber-300" : "bg-emerald-300"
          )}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wide text-white/50">Jugadores</div>
          <div className="text-xs text-white/40">Orden: por llegada</div>
        </div>

        <div className="mt-3 space-y-2">
          {court.players.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-white/60">
              Todavía no hay jugadores en esta cancha.
            </div>
          ) : (
            court.players.map((p) => (
              <div
                key={p.registration_id}
                data-testid={`player-row-${p.registration_id}`}
                className="flex cursor-pointer flex-col gap-2 rounded-2xl border border-white/10 bg-black/10 px-3 py-2 transition-colors hover:bg-black/25 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                role="button"
                tabIndex={0}
                onClick={() => onPlayerClick?.(court.court_id, p)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onPlayerClick?.(court.court_id, p);
                  }
                }}
              >
                <div className="flex items-center gap-3">
                  {p.avatar_url ? (
                    <img
                      src={p.avatar_url}
                      alt={p.name}
                      className="h-9 w-9 flex-shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-white/10 text-xs font-bold text-white">
                      {initials(p.name)}
                    </div>
                  )}
                  <div>
                    <div className="text-sm font-semibold text-white">{p.name}</div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-white/50">
                      <span>{p.type === "USER" ? "Jugador" : "Invitado"}</span>
                      {p.type === "USER" && p.player_level && (
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-white/80">
                          {PLAYER_LEVEL_LABELS[p.player_level] || p.player_level}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 pl-12 sm:pl-0">
                  <select
                    disabled={busy}
                    defaultValue=""
                    data-testid={`player-move-select-${p.registration_id}`}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      const toCourtId = e.target.value;
                      if (toCourtId) onMove(p.registration_id, toCourtId);
                      e.target.value = "";
                    }}
                    className={cn(
                      "flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white sm:flex-initial",
                      "focus:outline-none focus:ring-2 focus:ring-white/20",
                      "disabled:opacity-40"
                    )}
                    title="Mover (requiere Admin/Capitán)"
                  >
                    <option value="">Mover…</option>
                    {courts
                      .filter((x) => x.court_id !== court.court_id)
                      .map((x) => (
                        <option key={x.court_id} value={x.court_id}>
                          {x.name}
                        </option>
                      ))}
                  </select>

                  <button
                    disabled={busy}
                    data-testid={`player-cancel-${p.registration_id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onCancel(p.registration_id);
                    }}
                    className={cn(
                      "rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs font-semibold text-white",
                      "hover:bg-white/10",
                      "disabled:opacity-40"
                    )}
                    title="Baja (requiere Admin/Capitán)"
                  >
                    Baja
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// =========================
// EXPORTS FOR ADMIN PANEL
// =========================
export { cn, apiFetch, Banner, StatPill };

// =========================
// APP
// =========================
export default function App() {

  const [loginMode, setLoginMode] = useState("login"); // "login" | "register"
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [fullName, setFullName] = useState("");

  const [actorUserId, setActorUserId] = useState(getActorId());
  const [actorDraft, setActorDraft] = useState(getActorId());
  const [authHydrating, setAuthHydrating] = useState(true);
  const [data, setData] = useState(null);

  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const [selectedCourtId, setSelectedCourtId] = useState("");
  const [guestName, setGuestName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  // Multi-event support
  const [openEvents, setOpenEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState("");

  // Pending ratings
  const [pendingRatingsCount, setPendingRatingsCount] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [notificationsUnread, setNotificationsUnread] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationBusyId, setNotificationBusyId] = useState(null);
  const [playerCardsByCourt, setPlayerCardsByCourt] = useState({});
  const [playerCardOpen, setPlayerCardOpen] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [playerCardLoading, setPlayerCardLoading] = useState(false);
  const [playerCardError, setPlayerCardError] = useState("");

  const canUse = useMemo(() => actorUserId.trim().length > 0, [actorUserId]);

  useEffect(() => {
    const t = setTimeout(() => setAuthHydrating(false), 320);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (canUse) setAuthHydrating(false);
  }, [canUse]);



  async function onPinLogin() {
    setErr("");
    const p = phone.trim();
    const pi = pin.trim();

    if (!p) return setErr("Ingresá tu celular.");
    if (!/^\d{4}$|^\d{6}$/.test(pi)) return setErr("PIN inválido. Usá 4 o 6 dígitos.");

    setBusy(true);
    try {
      const r = await apiFetchPublic(`/auth/pin/login`, {
        method: "POST",
        body: { phone: p, pin: pi },
      });

      const actor = String(r.actor_user_id || "").trim();
      if (!actor) throw new Error("Login inválido (sin actor_user_id).");

      // guarda sesión
      setActorId(actor);
      localStorage.setItem("actor_me", JSON.stringify(r.me || null));

      // setea estado y carga
      setActorUserId(actor);
      setToast({ kind: "success", title: "Bienvenido", text: r.me?.full_name || "Login OK" });

      await load();
    } catch (e) {
      setErr(e.message || "No se pudo iniciar sesión.");
    } finally {
      setBusy(false);
    }
  }

  async function onPinRegister() {
    setErr("");
    const name = fullName.trim();
    const p = phone.trim();
    const pi = pin.trim();

    if (name.length < 3) return setErr("Ingresá tu nombre y apellido.");
    if (!p) return setErr("Ingresá tu celular.");
    if (!/^\d{4}$|^\d{6}$/.test(pi)) return setErr("PIN inválido. Usá 4 o 6 dígitos.");

    setBusy(true);
    try {
      const r = await apiFetchPublic(`/auth/pin/register`, {
        method: "POST",
        body: { full_name: name, phone: p, pin: pi },
      });

      const actor = String(r.actor_user_id || "").trim();
      if (!actor) throw new Error("Registro inválido (sin actor_user_id).");

      setActorId(actor);
      localStorage.setItem("actor_me", JSON.stringify(r.me || null));

      setActorUserId(actor);
      setToast({ kind: "success", title: "Cuenta creada", text: r.me?.full_name || "Registro OK" });

      await load();
    } catch (e) {
      setErr(e.message || "No se pudo registrar.");
    } finally {
      setBusy(false);
    }
  }

  async function loadEventsList() {
    try {
      const res = await apiFetch(`/events/open`);
      const evts = res.events || [];
      setOpenEvents(evts);
      return evts;
    } catch {
      setOpenEvents([]);
      return [];
    }
  }

  async function loadEventDetail(eventId) {
    setErr("");
    setBusy(true);
    try {
      const d = await apiFetch(`/events/active${eventId ? `?event_id=${eventId}` : ""}`);
      setData(d);
      if (d?.event?.id) setSelectedEventId(d.event.id);
      if (!selectedCourtId && d?.courts?.[0]?.court_id) setSelectedCourtId(d.courts[0].court_id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function load(eventIdOverride) {
    setErr("");
    setBusy(true);
    try {
      const evts = await loadEventsList();
      // Determine which event to load:
      // 1. Explicit override passed to function
      // 2. URL query param (?event_id=...)
      // 3. First event from fresh list (most common case on refresh)
      // 4. Fall back to nothing
      let targetId = null;
      if (typeof eventIdOverride === "string" && eventIdOverride) {
        targetId = eventIdOverride;
      } else {
        const queryId = new URLSearchParams(window.location.search).get("event_id") || "";
        if (queryId) targetId = queryId;
      }
      if (!targetId && evts.length > 0) {
        // Check if current selectedEventId is still in the list
        const currentStillExists = selectedEventId && evts.some(e => e.id === selectedEventId);
        targetId = currentStillExists ? selectedEventId : evts[0].id;
      }
      if (targetId) {
        await loadEventDetail(targetId);
      } else {
        setData(null);
      }
      await refreshNotifications();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function selectEvent(eventId) {
    setSelectedEventId(eventId);
    setSelectedCourtId("");
    loadEventDetail(eventId);
  }

  useEffect(() => {
    if (canUse) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUse]);

  // Fetch current user info (admin status, avatar, etc.)
  useEffect(() => {
    async function fetchCurrentUser() {
      if (!canUse) {
        setIsAdmin(false);
        setCurrentUser(null);
        return;
      }
      try {
        const me = await apiFetch('/me');
        setIsAdmin(me.is_admin || false);
        setCurrentUser(me.user || null);
      } catch {
        setIsAdmin(false);
        setCurrentUser(null);
      }
    }
    fetchCurrentUser();
  }, [canUse]);

  // Fetch notifications (informative + pending ratings)
  useEffect(() => {
    async function fetchNotifications() {
      if (!canUse) {
        setNotifications([]);
        setNotificationsUnread(0);
        setPendingRatingsCount(0);
        return;
      }
      try {
        const res = await apiFetch("/notifications");
        setNotifications(res.items || []);
        setNotificationsUnread(res.unread_count || 0);
        setPendingRatingsCount(res.pending_ratings_count || 0);
      } catch {
        setNotifications([]);
        setNotificationsUnread(0);
        setPendingRatingsCount(0);
      }
    }
    fetchNotifications();
  }, [canUse]);

  async function refreshNotifications() {
    if (!canUse) return;
    try {
      const res = await apiFetch("/notifications");
      setNotifications(res.items || []);
      setNotificationsUnread(res.unread_count || 0);
      setPendingRatingsCount(res.pending_ratings_count || 0);
    } catch {
      // no-op
    }
  }

  async function dismissNotification(notificationId) {
    setNotificationBusyId(notificationId);
    try {
      await apiFetch(`/notifications/${notificationId}/dismiss`, { method: "POST" });
      await refreshNotifications();
    } catch (e) {
      setErr(e.message || "No se pudo descartar la notificacion.");
    } finally {
      setNotificationBusyId(null);
    }
  }

  async function onSaveActor() {
    const candidate = actorDraft.trim();

    setErr("");
    if (!candidate) {
      setErr("Pegá tu Actor ID.");
      return;
    }
    if (!isUuid(candidate)) {
      setErr("Formato inválido. Pegá un UUID válido.");
      return;
    }

    setBusy(true);
    try {
      // Validación: si /events/active responde, lo damos por válido.
      await apiFetch("/events/active", { actorOverride: candidate });

      setActorId(candidate);
      setActorUserId(candidate); // canUse => true
      await load();
    } catch (e) {
      clearActorId();
      setErr(e.message || "Actor ID inválido o sin acceso.");
    } finally {
      setBusy(false);
    }
  }

  async function registerSelf(courtId) {
    setErr("");
    setBusy(true);
    try {
      await apiFetch(`/events/${data.event.id}/register`, {
        method: "POST",
        body: { court_id: courtId },
      });
      setToast({ kind: "success", title: "Anotado", text: "Tu inscripción fue registrada." });
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function registerGuest() {
    setErr("");
    setBusy(true);
    try {
      await apiFetch(`/events/${data.event.id}/guests`, {
        method: "POST",
        body: { guest_name: guestName, court_id: selectedCourtId },
      });
      setGuestName("");
      setToast({ kind: "success", title: "Invitado confirmado", text: "Quedó registrado en la cancha." });
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelReg(registrationId) {
    setErr("");
    setBusy(true);
    try {
      await apiFetch(`/registrations/${registrationId}/cancel`, { method: "POST" });
      setToast({ kind: "success", title: "Listo", text: "Se dio de baja la inscripción." });
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function moveReg(registrationId, toCourtId) {
    setErr("");
    setBusy(true);
    try {
      await apiFetch(`/registrations/${registrationId}/move`, {
        method: "POST",
        body: { to_court_id: toCourtId },
      });
      setToast({ kind: "success", title: "Movido", text: "La inscripción cambió de cancha." });
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadPlayerCardsForCourt(courtId, { force = false } = {}) {
    if (!event?.id || !courtId) return null;

    const cached = playerCardsByCourt[courtId];
    const now = Date.now();
    if (!force && cached && now - cached.fetchedAt < PLAYER_CARD_CACHE_TTL_MS) {
      return cached;
    }

    setPlayerCardLoading(true);
    setPlayerCardError("");
    try {
      const res = await apiFetch(`/events/${event.id}/courts/${courtId}/player-cards`);
      const cards = res?.cards || [];
      const cardsByRegistration = {};
      cards.forEach((card) => {
        cardsByRegistration[card.registration_id] = card;
      });

      const next = {
        fetchedAt: now,
        viewerOptIn: !!res?.viewer?.ranking_opt_in,
        cardsByRegistration,
      };
      setPlayerCardsByCourt((prev) => ({ ...prev, [courtId]: next }));
      return next;
    } catch (e) {
      setPlayerCardError(e.message || "No se pudo cargar el perfil del jugador.");
      return null;
    } finally {
      setPlayerCardLoading(false);
    }
  }

  async function handleOpenPlayerCard(courtId, player) {
    setSelectedPlayer({
      court_id: courtId,
      registration_id: player.registration_id,
      type: player.type,
      name: player.name,
      player_level: player.player_level || null,
      avatar_url: player.avatar_url || null,
    });
    setPlayerCardError("");
    setPlayerCardOpen(true);
    await loadPlayerCardsForCourt(courtId);
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    setPlayerCardsByCourt({});
    setPlayerCardOpen(false);
    setSelectedPlayer(null);
    setPlayerCardLoading(false);
    setPlayerCardError("");
  }, [data?.event?.id]);

  // -------- Login screen --------
  if (!canUse) {
    if (authHydrating) {
      return (
        <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-black px-4 py-8 text-white">
          <div className="mx-auto max-w-6xl">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.05fr_1fr]">
              <div className="app-card h-80 animate-pulse bg-white/[0.06]" />
              <div className="app-card h-80 animate-pulse bg-white/[0.06]" />
            </div>
          </div>
        </div>
      );
    }

    return (
      <AuthLayout
        hero={<BrandHero />}
        card={
          <AuthFlowCard
            busy={busy}
            err={err}
            clearError={() => setErr("")}
            loginMode={loginMode}
            setLoginMode={setLoginMode}
            phone={phone}
            setPhone={setPhone}
            pin={pin}
            setPin={setPin}
            fullName={fullName}
            setFullName={setFullName}
            onLogin={onPinLogin}
            onRegister={onPinRegister}
            actorDraft={actorDraft}
            setActorDraft={setActorDraft}
            onSaveActor={onSaveActor}
          />
        }
        footer="Work in progress • Tercer Tiempo FC (Canchas)"
      />
    );
  }

  // -------- Main screen --------
  const event = data?.event;
  const courts = data?.courts || [];
  const totalCap = courts.reduce((a, c) => a + (c.capacity || 0), 0);
  const totalOcc = courts.reduce((a, c) => a + (c.occupied || 0), 0);
  const selectedCardData = selectedPlayer
    ? playerCardsByCourt[selectedPlayer.court_id]?.cardsByRegistration?.[selectedPlayer.registration_id] || null
    : null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-black text-white">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <img
              src={BRAND_LOGO_URL}
              alt="Tercer Tiempo FC"
              className="h-12 w-12 rounded-3xl bg-white/10 object-cover p-1"
            />
            <div>
              <div className="text-xl font-semibold">Tercer Tiempo FC (Canchas)</div>
              <div className="mt-0.5 break-all text-xs text-white/60 sm:text-sm">
                Actor: <code className="text-white/80">{actorUserId}</code>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatPill
              label="Total"
              value={`${totalOcc}/${totalCap}`}
              tone={totalOcc >= totalCap && totalCap > 0 ? "warn" : "neutral"}
            />
            {isAdmin && (
              <a
                href="/admin"
                target="_blank"
                rel="noopener noreferrer"
                data-testid="open-admin-panel"
                className={cn(
                  "rounded-xl border border-amber-400/30 bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-300",
                  "hover:bg-amber-500/30"
                )}
              >
                Panel Admin
              </a>
            )}
            <InstallPwaButton />
                        <div className="relative">
              <button
                onClick={() => setNotificationsOpen((v) => !v)}
                title="Notificaciones"
                className="relative rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white hover:bg-white/10"
              >
                <span className="text-lg">{"\u{1F514}"}</span>
                {notificationsUnread > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                    {notificationsUnread}
                  </span>
                )}
              </button>

              {notificationsOpen && (
                <div className="fixed left-3 right-3 top-24 z-50 max-h-[72vh] overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/95 p-3 shadow-2xl shadow-black/30 backdrop-blur sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-80 sm:max-h-none">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-semibold text-white">Notificaciones</div>
                    <button
                      onClick={() => setNotificationsOpen(false)}
                      className="rounded-lg px-2 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white"
                    >
                      Cerrar
                    </button>
                  </div>

                  {notifications.length === 0 ? (
                    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-4 text-sm text-white/60">
                      No hay notificaciones.
                    </div>
                  ) : (
                    <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1 sm:max-h-80">
                      {notifications.map((n) => (
                        <div key={n.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                          <div className="text-sm font-semibold text-white">{n.title}</div>
                          <div className="mt-1 whitespace-pre-line text-xs text-white/70">{n.message}</div>
                          <div className="mt-2 flex items-center gap-2">
                            {n.action_url && (
                              <a
                                href={n.action_url}
                                className="rounded-lg border border-amber-400/30 bg-amber-500/20 px-2 py-1 text-xs font-semibold text-amber-200 hover:bg-amber-500/30"
                              >
                                Abrir
                              </a>
                            )}
                            {n.dismissible && (
                              <button
                                onClick={() => dismissNotification(n.id)}
                                disabled={notificationBusyId === n.id}
                                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70 hover:bg-white/10 disabled:opacity-40"
                              >
                                {notificationBusyId === n.id ? "..." : "Descartar"}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            {currentUser && (
              <a
                href="/profile"
                title="Mi Perfil"
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2 py-1 hover:bg-white/10"
              >
                {currentUser.avatar_url ? (
                  <img
                    src={currentUser.avatar_url}
                    alt="Avatar"
                    className="h-8 w-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-xs font-bold text-white">
                    {initials(currentUser.full_name)}
                  </div>
                )}
                <span className="hidden text-sm font-medium text-white/80 sm:inline">
                  {currentUser.nickname || currentUser.full_name?.split(" ")[0] || "Perfil"}
                </span>
              </a>
            )}
            <button
              onClick={load}
              disabled={busy}
              data-testid="app-refresh-btn"
              className={cn(
                "rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white",
                "hover:bg-white/10",
                "disabled:cursor-not-allowed disabled:opacity-40"
              )}
            >
              {busy ? "Actualizando…" : "Actualizar"}
            </button>
          </div>
        </div>

        {toast ? (
          <Banner kind={toast.kind} title={toast.title} onClose={() => setToast(null)}>
            {toast.text}
          </Banner>
        ) : null}

        {err ? (
          <Banner kind="error" title="Error" onClose={() => setErr("")}>
            {err}
          </Banner>
        ) : null}

        {pendingRatingsCount > 0 && (
          <Banner kind="warn" title="Votos pendientes">
            Tenés {pendingRatingsCount} voto{pendingRatingsCount !== 1 ? "s" : ""} pendiente{pendingRatingsCount !== 1 ? "s" : ""}.{" "}
            <a href="/ratings/pending-ui" className="underline font-semibold">Votar ahora</a>
          </Banner>
        )}

        {openEvents.length > 0 && (
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">Eventos disponibles</div>
            <div className="flex flex-wrap gap-2">
              {openEvents.map((ev) => (
                <button
                  key={ev.id}
                  onClick={() => selectEvent(ev.id)}
                  data-testid={`app-event-select-${ev.id}`}
                  className={cn(
                    "rounded-xl px-3 py-2 text-sm font-semibold transition-colors",
                    ev.id === selectedEventId
                      ? "bg-white text-black"
                      : "border border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                  )}
                >
                  {ev.title}
                  <span className={cn(
                    "ml-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                    ev.status === "OPEN" ? "bg-emerald-400/20 text-emerald-300" : "bg-amber-400/20 text-amber-300"
                  )}>
                    {ev.status === "OPEN" ? "Abierto" : "Cerrado"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!event ? (
          <Banner kind="info" title="Sin evento abierto">
            No hay evento OPEN en este momento.
          </Banner>
        ) : (
          <>
            <div className="mt-5 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/10">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="truncate text-lg font-semibold text-white" data-testid="event-active-title">{event.title}</div>
                  <div className="mt-1 text-sm text-white/60">{event.location_name}</div>
                  <div className="mt-1 text-sm text-white/60">Empieza: {fmtStart(event.starts_at)}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2" data-testid="event-active-header">
                  <StatPill
                    label="Estado"
                    value={event.status === "OPEN" ? "Abierto" : event.status === "CLOSED" ? "Cerrado" : event.status}
                    tone={event.status === "OPEN" ? "good" : "warn"}
                  />
                  <StatPill label="Canchas" value={courts.length} />
                </div>
              </div>
            </div>

            {event.status === "CLOSED" && (
              <div className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200" data-testid="event-closed-banner">
                Este evento esta cerrado para nuevas inscripciones. Contacta al administrador para cambios.
              </div>
            )}

            <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
              {courts.map((c) => (
                <CourtCard
                  key={c.court_id}
                  court={c}
                  courts={courts}
                  busy={busy}
                  eventStatus={event.status}
                  onRegisterSelf={registerSelf}
                  onCancel={cancelReg}
                  onMove={moveReg}
                  onPlayerClick={handleOpenPlayerCard}
                />
              ))}
            </div>

            {event.status === "OPEN" && (
              <div className="mt-5 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/10">
                <div>
                  <div className="text-base font-semibold">Anotar invitado</div>
                  <div className="mt-1 text-sm text-white/60">Máximo 5 invitados por actor. Sin sobrecupo.</div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="md:col-span-1">
                    <label className="text-xs font-semibold uppercase tracking-wide text-white/50">Nombre</label>
                    <input
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      placeholder="Ej: Franco"
                      data-testid="guest-name-input"
                      className={cn(
                        "mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white",
                        "placeholder:text-white/30",
                        "focus:outline-none focus:ring-2 focus:ring-white/20"
                      )}
                    />
                  </div>

                  <div className="md:col-span-1">
                    <label className="text-xs font-semibold uppercase tracking-wide text-white/50">Cancha</label>
                    <select
                      value={selectedCourtId}
                      onChange={(e) => setSelectedCourtId(e.target.value)}
                      data-testid="guest-court-select"
                      className={cn(
                        "mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white",
                        "focus:outline-none focus:ring-2 focus:ring-white/20"
                      )}
                    >
                      {courts.map((c) => (
                        <option key={c.court_id} value={c.court_id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-1 md:flex md:items-end">
                    <button
                      disabled={busy || guestName.trim().length < 2}
                      onClick={registerGuest}
                      data-testid="guest-submit-btn"
                      className={cn(
                        "w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black",
                        "hover:bg-white/90",
                        "disabled:cursor-not-allowed disabled:opacity-40"
                      )}
                    >
                      Confirmar invitado
                    </button>
                  </div>
                </div>

                <div className="mt-3 text-xs text-white/45">
                  Nota: mover/baja se muestran, pero el backend bloquea si no sos Admin/Capitán.
                </div>
              </div>
            )}
          </>
        )}

        <PlayerCardModal
          open={playerCardOpen}
          onClose={() => setPlayerCardOpen(false)}
          loading={playerCardLoading}
          error={playerCardError}
          selectedPlayer={selectedPlayer}
          cardData={selectedCardData}
        />

        <div className="pb-10" />
      </div>
    </div>
  );
}

