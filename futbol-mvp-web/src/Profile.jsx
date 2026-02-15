import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE = (
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  ""
).trim();

const PLAYER_LEVEL_OPTIONS = [
  { value: "INICIAL", label: "Inicial" },
  { value: "RECREATIVO", label: "Recreativo" },
  { value: "COMPETITIVO", label: "Competitivo" },
];

function getActorId() {
  return localStorage.getItem("actorUserId") || localStorage.getItem("actor_id") || "";
}

function cn(...xs) {
  return xs.filter(Boolean).join(" ");
}

function initials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || "?";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase();
}

async function apiFetch(path, { method = "GET", body } = {}) {
  const actor = getActorId();
  if (!actor) throw new Error("No autenticado.");

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
  const data = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");

  if (!res.ok) {
    const detail = data?.detail ?? data?.message ?? data;
    throw new Error(typeof detail === "string" ? detail : `HTTP ${res.status}`);
  }
  return data;
}

async function apiUpload(path, file) {
  const actor = getActorId();
  if (!actor) throw new Error("No autenticado.");

  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "X-Actor-User-Id": actor },
    body: formData,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.detail || `HTTP ${res.status}`);
  }
  return data;
}

function Toast({ toast, onClose }) {
  if (!toast) return null;
  const bg = toast.kind === "error" ? "bg-red-500/90" : "bg-emerald-500/90";
  return (
    <div className={cn("fixed left-4 right-4 top-4 z-50 rounded-xl px-4 py-3 text-white shadow-lg sm:left-auto sm:right-4", bg)}>
      <div className="font-semibold">{toast.title}</div>
      {toast.text && <div className="text-sm opacity-90">{toast.text}</div>}
      <button onClick={onClose} className="absolute right-2 top-1 text-white/70 hover:text-white">x</button>
    </div>
  );
}

function RoleBadge({ role }) {
  const colors = {
    super_admin: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    admin: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    captain: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  };
  const color = colors[role.toLowerCase()] || "bg-white/10 text-white/70 border-white/20";
  return (
    <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold uppercase", color)}>
      {role}
    </span>
  );
}

function AttributePill({ name, count }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs">
      <span className="font-semibold text-emerald-100">{name}</span>
      <span className="rounded-full bg-black/20 px-2 py-0.5 font-bold text-emerald-200">{count}</span>
    </div>
  );
}

export default function Profile() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState(null);

  const [user, setUser] = useState(null);
  const [roles, setRoles] = useState([]);

  const [userRating, setUserRating] = useState(null);
  const [attributesTop, setAttributesTop] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [rankingMessage, setRankingMessage] = useState("");

  const [fullName, setFullName] = useState("");
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [rankingOptIn, setRankingOptIn] = useState(false);
  const [playerLevel, setPlayerLevel] = useState("RECREATIVO");

  useEffect(() => {
    async function loadProfile() {
      try {
        const data = await apiFetch("/me");
        setUser(data.user);
        setRoles(data.roles || []);
        setFullName(data.user.full_name || "");
        setNickname(data.user.nickname || "");
        setEmail(data.user.email || "");
        setRankingOptIn(Boolean(data.user.ranking_opt_in));
        setPlayerLevel(data.user.player_level || "RECREATIVO");

        try {
          const userId = data.user.id || getActorId();
          const [ratingRes, attrsRes, pendingRes] = await Promise.all([
            apiFetch(`/users/${userId}/rating`),
            apiFetch(`/users/${userId}/ratings/attributes`),
            apiFetch("/ratings/pending"),
          ]);

          setUserRating(ratingRes?.participates ? ratingRes : null);
          setAttributesTop(attrsRes?.participates ? attrsRes.top || [] : []);
          setPendingCount(pendingRes.total_pending || 0);
          setRankingMessage(
            ratingRes?.participates
              ? ""
              : ratingRes?.message || "No participas del Perfil de Juego. Si lo activas, podras votar y recibir feedback de tus companeros."
          );
        } catch {
          // rating endpoints are optional for profile render
        }
      } catch (e) {
        setToast({ kind: "error", title: "Error", text: e.message });
        if (e.message.includes("No autenticado")) {
          navigate("/");
        }
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, [navigate]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const data = await apiFetch("/me", {
        method: "PATCH",
        body: {
          full_name: fullName,
          nickname,
          email,
          ranking_opt_in: rankingOptIn,
          player_level: playerLevel,
        },
      });
      setUser(data.user);
      setRankingOptIn(Boolean(data.user.ranking_opt_in));
      setPlayerLevel(data.user.player_level || "RECREATIVO");
      setToast({ kind: "success", title: "Guardado", text: "Perfil actualizado." });

      const userId = data.user.id || getActorId();
      const [ratingRes, attrsRes, pendingRes] = await Promise.all([
        apiFetch(`/users/${userId}/rating`),
        apiFetch(`/users/${userId}/ratings/attributes`),
        apiFetch("/ratings/pending"),
      ]);
      setUserRating(ratingRes?.participates ? ratingRes : null);
      setAttributesTop(attrsRes?.participates ? attrsRes.top || [] : []);
      setPendingCount(pendingRes.total_pending || 0);
      setRankingMessage(
        ratingRes?.participates
          ? ""
          : ratingRes?.message || "No participas del Perfil de Juego. Si lo activas, podras votar y recibir feedback de tus companeros."
      );
    } catch (e) {
      setToast({ kind: "error", title: "Error", text: e.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setToast({ kind: "error", title: "Error", text: "Selecciona una imagen." });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setToast({ kind: "error", title: "Error", text: "La imagen no puede superar 2MB." });
      return;
    }

    setUploading(true);
    try {
      const data = await apiUpload("/me/avatar", file);
      setUser((u) => ({ ...u, avatar_url: data.avatar_url }));
      setToast({ kind: "success", title: "Avatar actualizado" });
    } catch (e) {
      setToast({ kind: "error", title: "Error", text: e.message });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDeleteAvatar() {
    if (!user?.avatar_url) return;
    setUploading(true);
    try {
      await apiFetch("/me/avatar", { method: "DELETE" });
      setUser((u) => ({ ...u, avatar_url: null }));
      setToast({ kind: "success", title: "Avatar eliminado" });
    } catch (e) {
      setToast({ kind: "error", title: "Error", text: e.message });
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <div className="text-white/60">Cargando perfil...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 px-4 py-8">
      <Toast toast={toast} onClose={() => setToast(null)} />

      <div className="mx-auto max-w-lg">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-bold text-white">Mi Perfil</h1>
          <button
            onClick={() => navigate("/")}
            className="self-start rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
          >
            Volver
          </button>
        </div>

        <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <div className="relative">
              {user?.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt="Avatar"
                  className="h-24 w-24 rounded-full object-cover ring-2 ring-white/20"
                />
              ) : (
                <div className="grid h-24 w-24 place-items-center rounded-full bg-white/10 text-2xl font-bold text-white ring-2 ring-white/20">
                  {initials(user?.full_name)}
                </div>
              )}
              {uploading && (
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className={cn(
                  "rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black",
                  "hover:bg-white/90 disabled:opacity-50"
                )}
              >
                {user?.avatar_url ? "Cambiar foto" : "Subir foto"}
              </button>
              {user?.avatar_url && (
                <button
                  onClick={handleDeleteAvatar}
                  disabled={uploading}
                  className="rounded-xl border border-red-500/30 px-4 py-2 text-sm font-semibold text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                >
                  Eliminar foto
                </button>
              )}
              <p className="text-xs text-white/40">JPG, PNG o WebP. Max 2MB.</p>
            </div>
          </div>
        </div>

        {roles.length > 0 && (
          <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">Roles</div>
            <div className="flex flex-wrap gap-2">
              {roles.map((r) => (
                <RoleBadge key={r} role={r} />
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSave} className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-white/70">Nombre completo</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                maxLength={120}
                required
                className={cn(
                  "w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white",
                  "placeholder:text-white/30 focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/10"
                )}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-white/70">Apodo (opcional)</label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={30}
                placeholder="Ej: Messi"
                className={cn(
                  "w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white",
                  "placeholder:text-white/30 focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/10"
                )}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-white/70">Email (opcional)</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={120}
                placeholder="tu@email.com"
                className={cn(
                  "w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white",
                  "placeholder:text-white/30 focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/10"
                )}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-white/70">Telefono</label>
              <input
                type="text"
                value={user?.phone || ""}
                readOnly
                className="w-full cursor-not-allowed rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white/50"
              />
              <p className="mt-1 text-xs text-white/40">El telefono no se puede modificar.</p>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <label className="mb-1 block text-sm font-medium text-white/70">Nivel autodeclarado</label>
              <div className="mb-2 text-xs text-white/50">
                Es tu percepcion personal y no depende del Perfil de Juego.
              </div>
              <select
                value={playerLevel}
                onChange={(e) => setPlayerLevel(e.target.value)}
                className={cn(
                  "w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white",
                  "focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/10"
                )}
              >
                {PLAYER_LEVEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">Participar del ranking</div>
                  <div className="text-xs text-white/50">
                    Si esta apagado, no votas ni recibis votos del Perfil de Juego.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setRankingOptIn((v) => !v)}
                  className={cn(
                    "relative h-7 w-12 rounded-full border transition-colors",
                    rankingOptIn
                      ? "border-emerald-400/40 bg-emerald-500/30"
                      : "border-white/20 bg-white/10"
                  )}
                  aria-pressed={rankingOptIn}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
                      rankingOptIn ? "left-6" : "left-0.5"
                    )}
                  />
                </button>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className={cn(
              "mt-6 w-full rounded-xl bg-white py-3 text-base font-semibold text-black",
              "hover:bg-white/90 disabled:opacity-50"
            )}
          >
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        </form>

        {rankingOptIn && pendingCount > 0 && (
          <div className="mt-6 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-amber-50">Feedback pendiente</div>
                <div className="mt-1 text-xs text-amber-50/70">
                  Tenes {pendingCount} voto{pendingCount !== 1 ? "s" : ""} para completar.
                </div>
              </div>
              <a
                href="/ratings/pending-ui"
                className={cn(
                  "self-start rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-black",
                  "hover:bg-amber-400"
                )}
              >
                Dejar feedback
              </a>
            </div>
          </div>
        )}

        {!rankingOptIn && (
          <div className="mt-6 rounded-2xl border border-sky-400/20 bg-sky-400/10 p-4 text-sm text-sky-100">
            {rankingMessage || "No participas del Perfil de Juego. Si lo activas, podras votar y recibir feedback de tus companeros."}
          </div>
        )}

        {rankingOptIn && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="text-sm font-semibold text-white">Perfil de juego</div>
            <div className="mt-1 text-xs text-white/60">
              Basado en feedback de tus companeros de partido.
            </div>

            <div className="mt-5">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/50">
                Atributos destacados
              </div>
              {attributesTop.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {attributesTop.map((item) => (
                    <AttributePill key={item.attribute} name={item.attribute} count={item.count} />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-white/60">
                  Todavia no hay suficiente feedback para mostrar atributos.
                </div>
              )}
            </div>

            <div className="mt-5 rounded-xl border border-white/10 bg-black/10 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-white/50">
                Indicador colaborativo
              </div>
              {userRating?.participates && userRating.total_votes > 0 ? (
                <div className="mt-2 flex items-center gap-3">
                  <div className="text-2xl font-semibold text-amber-200">
                    <span className="mr-1 text-amber-300">{"\u2605"}</span>
                    {userRating.avg_rating.toFixed(1)}
                  </div>
                  <div className="text-xs text-white/60">
                    Basado en {userRating.total_votes} voto{userRating.total_votes !== 1 ? "s" : ""}.
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-xs text-white/60">
                  Aun no hay votos suficientes para mostrar un indicador.
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
