const API_BASE = (
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  ""
).trim();

function getActorId() {
  return localStorage.getItem("actorUserId") || localStorage.getItem("actor_id") || "";
}

export async function apiFetch(path, { method = "GET", body } = {}) {
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

export function cn(...xs) {
  return xs.filter(Boolean).join(" ");
}

const AR_TZ = { timeZone: "America/Argentina/Buenos_Aires" };

export function fmtTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      ...AR_TZ,
    });
  } catch {
    return "";
  }
}

const WEEKDAYS = ["LUN", "MAR", "MIE", "JUE", "VIE", "SAB", "DOM"];
const MONTHS = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

function arDate(iso) {
  // Devuelve { ymd, weekday, day, month } en TZ Buenos Aires.
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    ...AR_TZ,
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const jsWeekday = new Date(`${map.year}-${map.month}-${map.day}T12:00:00Z`).getUTCDay();
  // map weekday 0=Sun..6=Sat to our LUN-first index
  const wdIdx = (jsWeekday + 6) % 7;
  return {
    ymd: `${map.year}-${map.month}-${map.day}`,
    weekday: WEEKDAYS[wdIdx],
    day: Number(map.day),
    month: MONTHS[Number(map.month) - 1],
  };
}

export function dayLabelAR(iso) {
  if (!iso) return "Sin fecha";
  const now = new Date();
  const today = arDate(now.toISOString());
  const target = arDate(iso);

  if (target.ymd === today.ymd) return "HOY";

  // ayer
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  const yesterday = arDate(y.toISOString());
  if (target.ymd === yesterday.ymd) return "AYER";

  return `${target.weekday} ${target.day} ${target.month}`;
}
