import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE = (
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  ""
).trim();

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

// Toast component
function Toast({ toast, onClose }) {
  if (!toast) return null;
  const bg = toast.kind === "error" ? "bg-red-500/90" : "bg-emerald-500/90";
  return (
    <div className={cn("fixed top-4 right-4 z-50 rounded-xl px-4 py-3 text-white shadow-lg", bg)}>
      <div className="font-semibold">{toast.title}</div>
      {toast.text && <div className="text-sm opacity-90">{toast.text}</div>}
      <button onClick={onClose} className="absolute top-1 right-2 text-white/70 hover:text-white">×</button>
    </div>
  );
}

// Role badge component
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

export default function Profile() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState(null);

  const [user, setUser] = useState(null);
  const [roles, setRoles] = useState([]);

  // Rating data
  const [userRating, setUserRating] = useState(null);
  const [userComments, setUserComments] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [commentsTotal, setCommentsTotal] = useState(0);

  // Form state
  const [fullName, setFullName] = useState("");
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");

  // Load user data
  useEffect(() => {
    async function loadProfile() {
      try {
        const data = await apiFetch("/me");
        setUser(data.user);
        setRoles(data.roles || []);
        setFullName(data.user.full_name || "");
        setNickname(data.user.nickname || "");
        setEmail(data.user.email || "");

        // Load rating data
        try {
          const userId = data.user.id || getActorId();
          const [ratingRes, commentsRes, pendingRes] = await Promise.all([
            apiFetch(`/users/${userId}/rating`),
            apiFetch(`/users/${userId}/ratings/comments?page=1&page_size=10`),
            apiFetch("/ratings/pending"),
          ]);
          setUserRating(ratingRes);
          setUserComments(commentsRes.items || []);
          setCommentsTotal(commentsRes.total || 0);
          setPendingCount(pendingRes.total_pending || 0);
        } catch {
          // Rating data is optional, don't fail the whole profile
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

  // Auto-hide toast
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
        body: { full_name: fullName, nickname, email },
      });
      setUser(data.user);
      setToast({ kind: "success", title: "Guardado", text: "Perfil actualizado." });
    } catch (e) {
      setToast({ kind: "error", title: "Error", text: e.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate client-side
    if (!file.type.startsWith("image/")) {
      setToast({ kind: "error", title: "Error", text: "Seleccioná una imagen." });
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
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Mi Perfil</h1>
          <button
            onClick={() => navigate("/")}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
          >
            ← Volver
          </button>
        </div>

        {/* Avatar Section */}
        <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            {/* Avatar */}
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

            {/* Avatar Actions */}
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
              <p className="text-xs text-white/40">JPG, PNG o WebP. Máx 2MB.</p>
            </div>
          </div>
        </div>

        {/* Roles Section */}
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

        {/* Profile Form */}
        <form onSubmit={handleSave} className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="space-y-4">
            {/* Full Name */}
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

            {/* Nickname */}
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

            {/* Email */}
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

            {/* Phone (readonly) */}
            <div>
              <label className="mb-1 block text-sm font-medium text-white/70">Teléfono</label>
              <input
                type="text"
                value={user?.phone || ""}
                readOnly
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white/50 cursor-not-allowed"
              />
              <p className="mt-1 text-xs text-white/40">El teléfono no se puede modificar.</p>
            </div>
          </div>

          {/* Submit */}
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

        {/* Pending Ratings Card */}
        {pendingCount > 0 && (
          <div className="mt-6 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-amber-50">Pendientes de votación</div>
                <div className="mt-1 text-xs text-amber-50/70">
                  Tenés {pendingCount} voto{pendingCount !== 1 ? "s" : ""} pendiente{pendingCount !== 1 ? "s" : ""}.
                </div>
              </div>
              <a
                href="/ratings/pending-ui"
                className={cn(
                  "rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-black",
                  "hover:bg-amber-400"
                )}
              >
                Votar ahora
              </a>
            </div>
          </div>
        )}

        {/* Rating Card */}
        {userRating && userRating.total_votes > 0 && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="text-xs font-semibold uppercase tracking-wide text-white/50 mb-3">
              Mi Calificación
            </div>
            <div className="flex items-center gap-4">
              <div className="text-4xl font-bold text-amber-300">
                {userRating.avg_rating.toFixed(1)}
              </div>
              <div>
                <div className="text-sm text-amber-300">
                  {Array.from({ length: 5 }, (_, i) => (
                    <span key={i}>{i < Math.round(userRating.avg_rating) ? "\u2605" : "\u2606"}</span>
                  ))}
                </div>
                <div className="text-xs text-white/50 mt-1">
                  {userRating.total_votes} calificacion{userRating.total_votes !== 1 ? "es" : ""}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Comments Section */}
        {userComments.length > 0 && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="text-xs font-semibold uppercase tracking-wide text-white/50 mb-3">
              Comentarios recibidos ({commentsTotal})
            </div>
            <div className="space-y-3">
              {userComments.map((c, i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-black/10 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    {c.author.avatar_url ? (
                      <img
                        src={c.author.avatar_url}
                        alt={c.author.full_name}
                        className="h-7 w-7 rounded-full object-cover"
                      />
                    ) : (
                      <div className="grid h-7 w-7 place-items-center rounded-full bg-white/10 text-[10px] font-bold text-white">
                        {initials(c.author.full_name)}
                      </div>
                    )}
                    <div className="text-sm font-semibold text-white">
                      {c.author.nickname || c.author.full_name}
                    </div>
                    <div className="text-xs text-amber-300">
                      {Array.from({ length: 5 }, (_, j) => (
                        <span key={j}>{j < Math.round(c.rating) ? "\u2605" : "\u2606"}</span>
                      ))}
                    </div>
                  </div>
                  <div className="text-sm text-white/70">{c.comment}</div>
                  <div className="mt-1 text-xs text-white/40">
                    {c.event_title} — {c.court_name}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
