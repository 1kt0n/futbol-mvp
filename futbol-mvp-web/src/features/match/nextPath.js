// ?next= del login: solo un link de partido de la app (/p/<uuid>), nunca una URL externa.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function safeNext(value) {
  const v = String(value || "");
  const [path] = v.split("?");
  const parts = path.split("/");
  return parts.length === 3 && parts[0] === "" && parts[1] === "p" && UUID_RE.test(parts[2]) ? v : null;
}
