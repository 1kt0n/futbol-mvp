import { useEffect, useMemo, useState } from "react";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").trim(); // default: same-origin

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

function CourtCard({ court, courts, busy, eventStatus, onRegisterSelf, onCancel, onMove }) {
  const pct = court.capacity > 0 ? Math.round((court.occupied / court.capacity) * 100) : 0;
  const fullnessTone = pct >= 100 ? "bad" : pct >= 80 ? "warn" : "good";
  const canRegister = eventStatus === "OPEN" && court.is_open;

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl shadow-black/10">
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
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/10 px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-2xl bg-white/10 text-xs font-bold text-white">
                    {initials(p.name)}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white">{p.name}</div>
                    <div className="text-xs text-white/50">{p.type === "USER" ? "Jugador" : "Invitado"}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    disabled={busy}
                    defaultValue=""
                    onChange={(e) => {
                      const toCourtId = e.target.value;
                      if (toCourtId) onMove(p.registration_id, toCourtId);
                      e.target.value = "";
                    }}
                    className={cn(
                      "rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white",
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
                    onClick={() => onCancel(p.registration_id)}
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
  const [data, setData] = useState(null);

  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const [selectedCourtId, setSelectedCourtId] = useState("");
  const [guestName, setGuestName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  // Multi-event support
  const [openEvents, setOpenEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState("");

  const canUse = useMemo(() => actorUserId.trim().length > 0, [actorUserId]);



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

  async function load(eventId) {
    setErr("");
    setBusy(true);
    try {
      const evts = await loadEventsList();
      const targetId = eventId || selectedEventId || (evts.length > 0 ? evts[0].id : null);
      if (targetId) {
        await loadEventDetail(targetId);
      } else {
        setData(null);
      }
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

  // Fetch is_admin status
  useEffect(() => {
    async function checkAdmin() {
      if (!canUse) {
        setIsAdmin(false);
        return;
      }
      try {
        const me = await apiFetch('/me');
        setIsAdmin(me.is_admin || false);
      } catch {
        setIsAdmin(false);
      }
    }
    checkAdmin();
  }, [canUse]);

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

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // -------- Login screen --------
  if (!canUse) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-black text-white">
        <div className="mx-auto max-w-md px-4 py-10">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/20">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold">Fútbol MVP</div>
                <div className="mt-1 text-sm text-white/60">
                  Entrá con tu celular y un PIN (4 o 6 dígitos).
                </div>
              </div>
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-white/10 text-lg">⚽</div>
            </div>

            {/* Tabs */}
            <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-black/10 p-1">
              <button
                onClick={() => setLoginMode("login")}
                className={cn(
                  "rounded-2xl px-3 py-2 text-sm font-semibold",
                  loginMode === "login" ? "bg-white text-black" : "text-white/80 hover:bg-white/10"
                )}
              >
                Ingresar
              </button>
              <button
                onClick={() => setLoginMode("register")}
                className={cn(
                  "rounded-2xl px-3 py-2 text-sm font-semibold",
                  loginMode === "register" ? "bg-white text-black" : "text-white/80 hover:bg-white/10"
                )}
              >
                Crear cuenta
              </button>
            </div>

            {/* Form */}
            <div className="mt-5 space-y-3">
              {loginMode === "register" ? (
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-white/50">
                    Nombre y apellido
                  </label>
                  <input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Ej: Milton Clavijo"
                    className={cn(
                      "mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white",
                      "placeholder:text-white/30",
                      "focus:outline-none focus:ring-2 focus:ring-white/20"
                    )}
                  />
                </div>
              ) : null}

              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-white/50">
                  Celular
                </label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Ej: 5491122334455"
                  inputMode="tel"
                  className={cn(
                    "mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white",
                    "placeholder:text-white/30",
                    "focus:outline-none focus:ring-2 focus:ring-white/20"
                  )}
                />
                <div className="mt-2 text-xs text-white/40">
                  Tip: puede ser con o sin +, espacios o guiones (el backend lo normaliza).
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-white/50">
                  PIN (4 o 6 dígitos)
                </label>
                <input
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D+/g, "").slice(0, 6))}
                  placeholder="••••"
                  inputMode="numeric"
                  className={cn(
                    "mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white",
                    "placeholder:text-white/30",
                    "focus:outline-none focus:ring-2 focus:ring-white/20"
                  )}
                />
              </div>

              <button
                onClick={loginMode === "login" ? onPinLogin : onPinRegister}
                disabled={
                  busy ||
                  !phone.trim() ||
                  !(/^\d{4}$|^\d{6}$/.test(pin.trim())) ||
                  (loginMode === "register" && fullName.trim().length < 3)
                }
                className={cn(
                  "mt-1 w-full rounded-2xl px-4 py-3 text-sm font-semibold",
                  "bg-white text-black hover:bg-white/90",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {busy ? "Validando..." : loginMode === "login" ? "Entrar" : "Crear y entrar"}
              </button>

              {err ? (
                <Banner kind="error" title="Error" onClose={() => setErr("")}>
                  {err}
                </Banner>
              ) : null}

              {/* Escape hatch para debug: actor manual */}
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-white/50">
                  Debug (Actor ID manual)
                </div>
                <div className="mt-1 text-xs text-white/45">
                  Si necesitás, podés seguir pegando el Actor ID como antes.
                </div>
                <input
                  value={actorDraft}
                  onChange={(e) => setActorDraft(e.target.value)}
                  placeholder="UUID actor..."
                  className={cn(
                    "mt-3 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white",
                    "placeholder:text-white/30",
                    "focus:outline-none focus:ring-2 focus:ring-white/20"
                  )}
                />
                <button
                  onClick={onSaveActor}
                  disabled={busy || actorDraft.trim().length === 0}
                  className={cn(
                    "mt-3 w-full rounded-2xl px-4 py-3 text-sm font-semibold",
                    "border border-white/10 bg-white/5 text-white hover:bg-white/10",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                >
                  {busy ? "Validando..." : "Guardar Actor ID"}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 text-center text-xs text-white/30">
            Work in progress • Futbol MVP
          </div>
        </div>
      </div>
    );
  }

  // -------- Main screen --------
  const event = data?.event;
  const courts = data?.courts || [];
  const totalCap = courts.reduce((a, c) => a + (c.capacity || 0), 0);
  const totalOcc = courts.reduce((a, c) => a + (c.occupied || 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-black text-white">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-3xl bg-white/10 text-xl">⚽</div>
            <div>
              <div className="text-xl font-semibold">Fútbol MVP</div>
              <div className="mt-0.5 text-sm text-white/60">
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
                className={cn(
                  "rounded-xl border border-amber-400/30 bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-300",
                  "hover:bg-amber-500/30"
                )}
              >
                Panel Admin
              </a>
            )}
            <button
              onClick={load}
              disabled={busy}
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

        {openEvents.length > 1 && (
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">Eventos disponibles</div>
            <div className="flex flex-wrap gap-2">
              {openEvents.map((ev) => (
                <button
                  key={ev.id}
                  onClick={() => selectEvent(ev.id)}
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
                  <div className="truncate text-lg font-semibold text-white">{event.title}</div>
                  <div className="mt-1 text-sm text-white/60">{event.location_name}</div>
                  <div className="mt-1 text-sm text-white/60">Empieza: {fmtStart(event.starts_at)}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
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
              <div className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
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

        <div className="pb-10" />
      </div>
    </div>
  );
}