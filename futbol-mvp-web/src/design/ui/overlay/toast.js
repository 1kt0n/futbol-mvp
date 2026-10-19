// Avisos efímeros: toast({ title, text, kind, action, duration }) desde cualquier
// lado (no hace falta contexto). Los muestra el único <Toaster/> de main.jsx.
// kind: "success" | "error" | "info". action: { label, onClick } (p. ej. Deshacer).

export const MAX_TOASTS = 3;
export const DEFAULT_DURATION = 4000;
export const ACTION_DURATION = 5000;
// Un error se lee más despacio (y puede traer el detalle del backend).
export const ERROR_DURATION = 6000;

let items = [];
let seq = 0;
const timers = new Map();
const subscribers = new Set();

function emit() {
  subscribers.forEach((fn) => fn());
}

export function toast(input) {
  const t = typeof input === "string" ? { title: input } : input || {};
  if (!t.title && !t.text) return null;
  seq += 1;
  const id = seq;
  const item = {
    id,
    kind: t.kind || "success",
    title: t.title || "",
    text: t.text || "",
    action: t.action || null,
    duration: t.duration ?? (t.action ? ACTION_DURATION : t.kind === "error" ? ERROR_DURATION : DEFAULT_DURATION),
  };
  items = [...items, item];
  // Si hay demasiados, se van los más viejos.
  while (items.length > MAX_TOASTS) dismissToast(items[0].id, { silent: true });
  if (item.duration > 0) timers.set(id, setTimeout(() => dismissToast(id), item.duration));
  emit();
  return id;
}

export function dismissToast(id, { silent = false } = {}) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const next = items.filter((t) => t.id !== id);
  if (next.length === items.length) return;
  items = next;
  if (!silent) emit();
}

toast.dismiss = dismissToast;
toast.success = (title, text) => toast({ kind: "success", title, text });
toast.error = (title, text) => toast({ kind: "error", title, text });
toast.info = (title, text) => toast({ kind: "info", title, text });

export function subscribeToasts(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function getToasts() {
  return items;
}

// Solo para tests.
export function _resetToasts() {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  items = [];
  emit();
}
