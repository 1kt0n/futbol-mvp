import { handleAuthFailure } from "../authSession.js";

const API_BASE = (
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  ""
).trim();

function getActorId() {
  return localStorage.getItem("actorUserId") || localStorage.getItem("actor_id") || "";
}

// El error lleva `status` y el `detail` crudo del backend: la pantalla del partido
// necesita distinguir un 409 COURT_FULL (detail con alternativas) de otro 409.
export async function apiFetch(path, { method = "GET", body, headers } = {}) {
  const actor = getActorId();
  if (!actor) throw new Error("No autenticado.");

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      "X-Actor-User-Id": actor,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    handleAuthFailure();
    throw new Error("Sesión expirada.");
  }

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
          : detail?.message || `HTTP ${res.status}`;
    const error = new Error(msg);
    error.status = res.status;
    error.detail = detail;
    throw error;
  }

  return data;
}

export function fmtTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

// Un solo cn en toda la app (src/design/cn.js); se re-exporta para los imports existentes.
export { cn } from "../design/cn.js";
