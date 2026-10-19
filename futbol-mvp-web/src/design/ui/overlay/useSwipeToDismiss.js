// Deslizar para cerrar: solo en el celular (debajo de 640px), donde las hojas y
// los diálogos salen de abajo. La zona es el header de la hoja (con el grabber)
// o el grabber del diálogo y del menú.
//
// Pointer events con setPointerCapture, todos en la misma zona: Layer corta la
// propagación, así que un listener más arriba no los vería. La zona lleva
// touch-action: none (clase .ov-swipe) para que el navegador no la use de scroll.

import { useEffect, useLayoutEffect, useRef } from "react";

const MOBILE = "(max-width: 639px)";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const NO_DRAG = 'button, a, input, select, textarea, label, [role="button"]';
// Más que esto es un arrastre: el clic que sigue no cuenta.
const CLICK_SLOP = 5;
const DISTANCE_RATIO = 0.3;
const VELOCITY = 0.6; // px/ms
const VELOCITY_WINDOW_MS = 100;
const EXIT_MS = 160;
const SETTLE_MS = 200;

// Se cierra si pasó el 30% del alto del panel o si se soltó rápido hacia abajo.
export function shouldDismiss({ dy, height, velocity }) {
  if (dy <= CLICK_SLOP) return false;
  return dy > height * DISTANCE_RATIO || velocity > VELOCITY;
}

// Velocidad al soltar (px/ms, positiva hacia abajo) con las muestras de los últimos 100 ms.
export function releaseVelocity(samples, now) {
  const recent = samples.filter((s) => now - s.t <= VELOCITY_WINDOW_MS);
  if (recent.length < 2) return 0;
  const first = recent[0];
  const last = recent[recent.length - 1];
  return last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
}

const matches = (query) => typeof window.matchMedia === "function" && window.matchMedia(query).matches;

// onRelease() se llama cuando el gesto pide cerrar y devuelve "closed",
// "confirm" o "blocked" (lo mismo que requestClose de Sheet). Con "closed" el
// panel sale por abajo y recién después se llama a onDismiss(); si no, vuelve a
// su lugar.
export function useSwipeToDismiss({ panelRef, onRelease, onDismiss }) {
  const callbacks = useRef({ onRelease, onDismiss });
  const drag = useRef(null);
  const suppressClickUntil = useRef(0);
  const pendingTransition = useRef(null);

  useLayoutEffect(() => {
    callbacks.current = { onRelease, onDismiss };
  });

  useEffect(() => () => pendingTransition.current?.cancel(), []);

  // Espera el transitionend del transform (o un timeout, por si no llega).
  function afterTransition(panel, ms, fn) {
    pendingTransition.current?.cancel();
    let timer = 0;
    const cleanup = () => {
      window.clearTimeout(timer);
      panel.removeEventListener("transitionend", onEnd);
      pendingTransition.current = null;
    };
    const finish = () => {
      cleanup();
      fn();
    };
    const onEnd = (e) => {
      if (e.target === panel && e.propertyName === "transform") finish();
    };
    panel.addEventListener("transitionend", onEnd);
    timer = window.setTimeout(finish, ms + 60);
    pendingTransition.current = { cancel: cleanup };
  }

  function settle(panel) {
    if (!panel.style.transform) {
      panel.style.transition = "";
      return;
    }
    if (matches(REDUCED_MOTION)) {
      panel.style.transition = "";
      panel.style.transform = "";
      return;
    }
    panel.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
    panel.style.transform = "";
    afterTransition(panel, SETTLE_MS, () => {
      panel.style.transition = "";
    });
  }

  function exit(panel, offset) {
    const dismiss = () => callbacks.current.onDismiss?.();
    if (matches(REDUCED_MOTION)) {
      dismiss();
      return;
    }
    // Hasta abajo del todo, desde donde lo dejó el dedo.
    const distance = offset + Math.max(0, window.innerHeight - panel.getBoundingClientRect().top) + 16;
    panel.style.transition = `transform ${EXIT_MS}ms cubic-bezier(0.4, 0, 1, 1)`;
    panel.style.transform = `translateY(${Math.round(distance)}px)`;
    afterTransition(panel, EXIT_MS, dismiss);
  }

  function onPointerDown(e) {
    if (drag.current || !e.isPrimary || e.button !== 0) return;
    if (!matches(MOBILE) || e.target.closest(NO_DRAG)) return;
    const panel = panelRef.current;
    if (!panel) return;
    pendingTransition.current?.cancel();
    // La animación de entrada (.ov-panel) pisa el transform inline: se termina de una.
    panel.getAnimations?.().forEach((a) => a.finish());
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // El puntero ya no está activo (o es un evento sintético): sin captura igual anda.
    }
    drag.current = {
      id: e.pointerId,
      startY: e.clientY,
      offset: 0,
      moved: false,
      height: panel.getBoundingClientRect().height,
      samples: [{ t: e.timeStamp, y: e.clientY }],
    };
  }

  function onPointerMove(e) {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const dy = e.clientY - d.startY;
    if (Math.abs(dy) > CLICK_SLOP) d.moved = true;
    d.offset = Math.max(0, dy);
    d.samples.push({ t: e.timeStamp, y: e.clientY });
    if (d.samples.length > 20) d.samples.shift();
    const panel = panelRef.current;
    if (!panel) return;
    panel.style.transition = "none";
    panel.style.transform = d.offset > 0 ? `translateY(${d.offset}px)` : "";
  }

  function end(e, cancelled) {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    const zone = e.currentTarget;
    if (zone.hasPointerCapture?.(e.pointerId)) zone.releasePointerCapture(e.pointerId);
    if (d.moved) suppressClickUntil.current = e.timeStamp + 400;
    const panel = panelRef.current;
    if (!panel) return;
    if (cancelled) {
      settle(panel);
      return;
    }
    d.samples.push({ t: e.timeStamp, y: e.clientY });
    const velocity = releaseVelocity(d.samples, e.timeStamp);
    if (!shouldDismiss({ dy: d.offset, height: d.height, velocity })) {
      settle(panel);
      return;
    }
    const result = callbacks.current.onRelease?.() ?? "closed";
    if (result === "closed") exit(panel, d.offset);
    else settle(panel);
  }

  // El clic que sigue a un arrastre (cae en la zona por el pointer capture) no cuenta.
  function onClickCapture(e) {
    if (e.timeStamp > suppressClickUntil.current) return;
    suppressClickUntil.current = 0;
    e.preventDefault();
    e.stopPropagation();
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: (e) => end(e, false),
    onPointerCancel: (e) => end(e, true),
    onLostPointerCapture: (e) => end(e, true),
    onClickCapture,
  };
}
