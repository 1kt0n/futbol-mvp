// Pila de overlays (iteración 0b). Es el único dueño del estado global que
// comparten hojas, diálogos y menús:
// - #root y las capas de abajo quedan inertes (ni foco, ni clics, ni lector de
//   pantalla) mientras haya una capa abierta. El Toaster nunca entra acá.
// - Bloqueo de scroll con contador: con hojas anidadas el body se libera recién
//   cuando se cierra la última, y vuelve a la posición en la que estaba. El menú
//   de escritorio (popover) no bloquea: se cierra si la página se mueve.
// - Esc y Tab los atiende solo la capa de arriba. El orden de la pila sigue al
//   visual: un diálogo (z-dialog) queda arriba de una hoja (z-sheet) aunque se
//   haya registrado antes (React corre los efectos de los hijos primero).

import { useSyncExternalStore } from "react";

const layers = [];
const subscribers = new Set();
let seq = 0;

export function getOverlayRoot() {
  let el = document.getElementById("overlay-root");
  if (!el) {
    el = document.createElement("div");
    el.id = "overlay-root";
    document.body.appendChild(el);
  }
  return el;
}

// ── Inert ─────────────────────────────────────────────────────────────────
function setHidden(el, hidden) {
  if (!el) return;
  el.inert = hidden;
  if (hidden) el.setAttribute("aria-hidden", "true");
  else el.removeAttribute("aria-hidden");
}

function applyInert() {
  setHidden(document.getElementById("root"), layers.length > 0);
  layers.forEach((layer, i) => setHidden(layer.node, i < layers.length - 1));
}

// ── Bloqueo de scroll ─────────────────────────────────────────────────────
// position:fixed en el body (no overflow:hidden) porque es lo único que frena el
// scroll del fondo en iOS Safari.
let lockCount = 0;
let lockedScrollY = 0;
let savedBodyStyle = null;
const LOCK_PROPS = ["position", "top", "left", "right", "width", "overflow"];

function lockScroll() {
  lockCount += 1;
  if (lockCount > 1) return;
  const style = document.body.style;
  lockedScrollY = window.scrollY;
  savedBodyStyle = Object.fromEntries(LOCK_PROPS.map((p) => [p, style[p]]));
  style.position = "fixed";
  style.top = `-${lockedScrollY}px`;
  style.left = "0";
  style.right = "0";
  style.width = "100%";
  style.overflow = "hidden";
}

function unlockScroll() {
  if (lockCount === 0) return;
  lockCount -= 1;
  if (lockCount > 0) return;
  Object.assign(document.body.style, savedBodyStyle);
  savedBodyStyle = null;
  window.scrollTo(0, lockedScrollY);
}

// ── Devolución del foco ───────────────────────────────────────────────────
// Safari no enfoca un botón al tocarlo: al abrir la capa, document.activeElement
// sigue siendo el body (o lo que tenía el foco antes). Se recuerda el último
// control tocado (en captura, antes de que su onClick abra la capa) y, si la capa
// se abre enseguida, el foco vuelve a ese control al cerrar.
const CONTROL = 'button, a[href], input, select, textarea, [role="button"], [role="menuitem"], [tabindex]';
const TAP_WINDOW_MS = 1000;
let lastTapped = null;
let lastTappedAt = 0;
if (typeof document !== "undefined") {
  document.addEventListener(
    "click",
    (e) => {
      lastTapped = e.target instanceof Element ? e.target.closest(CONTROL) : null;
      lastTappedAt = performance.now();
    },
    true
  );
}

const isFocusable = (el) => Boolean(el?.isConnected) && !el.closest("[inert]");

// Destinos de foco de las capas que se cerraron en este mismo commit. Se resuelven
// en un microtask, cuando ya se desmontó todo: si se cierran una hoja y su diálogo
// juntos, el foco va al primero que sigue en pantalla (no a un botón que ya no está).
let pendingReturns = [];
let flushScheduled = false;

export function scheduleFocusReturn(el) {
  if (!el) return;
  pendingReturns.push(el);
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    const candidates = pendingReturns.reverse();
    pendingReturns = [];
    // Si se abrió otra capa (o StrictMode volvió a montar esta), el foco ya está ahí.
    const active = document.activeElement;
    if (active && layers.some((l) => l.node?.contains(active))) return;
    candidates.find(isFocusable)?.focus({ preventScroll: true });
  });
}

export function getReturnFocusTarget() {
  if (lastTapped?.isConnected && performance.now() - lastTappedAt < TAP_WINDOW_MS) return lastTapped;
  // Una capa que se abre en el mismo commit en que se cierra otra (menú → hoja)
  // hereda su destino: el foco todavía no volvió (se devuelve en un microtask).
  for (let i = pendingReturns.length - 1; i >= 0; i -= 1) {
    if (isFocusable(pendingReturns[i])) {
      const el = pendingReturns[i];
      pendingReturns = [];
      return el;
    }
  }
  const active = document.activeElement;
  if (active && active !== document.body && active !== document.documentElement) return active;
  return null;
}

// ── Teclado ───────────────────────────────────────────────────────────────
const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function tabbables(node) {
  return Array.from(node.querySelectorAll(TABBABLE)).filter(
    (el) => !el.closest("[hidden], [inert]") && el.getClientRects().length > 0
  );
}

function trapTab(e, node) {
  const items = tabbables(node);
  if (items.length === 0) {
    e.preventDefault();
    return;
  }
  const active = document.activeElement;
  // -1: el foco está en el título o en el panel (tabIndex=-1), que no cuentan.
  const idx = items.indexOf(active);
  if (!node.contains(active)) {
    e.preventDefault();
    items[0].focus();
  } else if (e.shiftKey && idx <= 0) {
    e.preventDefault();
    items[items.length - 1].focus();
  } else if (!e.shiftKey && idx === items.length - 1) {
    e.preventDefault();
    items[0].focus();
  }
}

// En captura: los portales cortan la propagación de React (ver Layer.jsx), así
// que un listener en burbuja no vería las teclas que nacen adentro de la capa.
function onKeyDown(e) {
  const top = layers[layers.length - 1];
  if (!top || !top.node) return;
  if (e.key === "Escape") {
    const handlers = top.getHandlers();
    if (handlers.onEscape) {
      e.preventDefault();
      e.stopPropagation();
      handlers.onEscape();
    }
  } else if (e.key === "Tab") {
    trapTab(e, top.node);
  }
}

// ── Pila ──────────────────────────────────────────────────────────────────
function emit() {
  subscribers.forEach((fn) => fn());
}

const KIND_RANK = { sheet: 0, dialog: 1, menu: 2, popover: 2 };

export function pushLayer({ lockScroll: locksScroll = true, ...layer }) {
  seq += 1;
  const entry = { id: seq, rank: KIND_RANK[layer.kind] ?? 0, locksScroll, ...layer };
  layers.push(entry);
  layers.sort((a, b) => a.rank - b.rank || a.id - b.id);
  if (layers.length === 1) window.addEventListener("keydown", onKeyDown, true);
  if (locksScroll) lockScroll();
  applyInert();
  emit();
  return entry.id;
}

export function removeLayer(id) {
  const i = layers.findIndex((l) => l.id === id);
  if (i === -1) return;
  const [entry] = layers.splice(i, 1);
  if (layers.length === 0) window.removeEventListener("keydown", onKeyDown, true);
  if (entry.locksScroll) unlockScroll();
  applyInert();
  emit();
}

export function isTopLayer(id) {
  return layers.length > 0 && layers[layers.length - 1].id === id;
}

// Lo mismo que un Esc sobre la capa de arriba (el atrás de Android con un diálogo
// encima de la hoja cierra el diálogo, no la hoja). Devuelve si había a quién.
export function escapeTop() {
  const onEscape = layers[layers.length - 1]?.getHandlers().onEscape;
  if (!onEscape) return false;
  onEscape();
  return true;
}

function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function getDepth() {
  return layers.length;
}

// Cantidad de capas abiertas (el Toaster se pasa arriba si hay alguna).
export function useOverlayDepth() {
  return useSyncExternalStore(subscribe, getDepth, () => 0);
}
