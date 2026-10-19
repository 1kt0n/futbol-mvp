// ¿Esta persona ve la pantalla del partido (/p/:id) como pestaña Partido?
// MATCH_SCREEN_ENABLED (en /config): "off" | "admins" (quien entra al Panel) | "all".
//
// Un solo store para la Home y la pantalla, así nunca deciden distinto y no
// rebotan entre /?event_id= y /p/:id. Pide /config y /me una vez por sesión y se
// vacía cuando cambia la sesión (login o logout).
//
// El último modo de /config queda en localStorage (`guess`): con el flag apagado,
// la Home de siempre se monta enseguida en vez de esperar /config y /me.

import { useEffect, useSyncExternalStore } from "react";
import { ACTOR_CHANGED_EVENT, handleAuthFailure } from "../../authSession.js";
import { canAccessAdmin } from "../../permissions/can.js";

const API_BASE = (import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || "").trim();

function readActor() {
  try {
    return localStorage.getItem("actorUserId") || localStorage.getItem("actor_id") || "";
  } catch {
    return "";
  }
}

const EMPTY = { actor: "", ready: false, config: null, permissions: [], user: null };
const MODE_KEY = "matchScreen:lastMode";

function readMode() {
  try {
    return localStorage.getItem(MODE_KEY);
  } catch {
    return null;
  }
}

function rememberMode(config) {
  if (!config) return;
  try {
    localStorage.setItem(MODE_KEY, config.matchScreen || "off");
  } catch {
    /* sin storage: se decide al cargar */
  }
}

let state = EMPTY;
let loadingFor = null;
const listeners = new Set();

function emit(next) {
  state = next;
  listeners.forEach((l) => l());
}

async function fetchJson(path, headers) {
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (res.status === 401) {
    handleAuthFailure();
    throw new Error("Sesión expirada.");
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function ensureLoaded() {
  const actor = readActor();
  if (!actor) {
    if (state.actor || state.ready) emit(EMPTY);
    loadingFor = null;
    // En el login: así, al entrar, ya se sabe si el flag está apagado.
    fetchJson("/config").then(rememberMode).catch(() => {});
    return;
  }
  if ((state.actor === actor && state.ready) || loadingFor === actor) return;
  loadingFor = actor;
  if (state.actor !== actor) emit({ ...EMPTY, actor });
  Promise.all([
    fetchJson("/config").catch(() => null),
    fetchJson("/me", { "X-Actor-User-Id": actor }).catch(() => null),
  ]).then(([config, me]) => {
    if (loadingFor !== actor) return; // cambió la sesión mientras tanto
    loadingFor = null;
    rememberMode(config);
    emit({
      actor,
      ready: true,
      config: config || {},
      permissions: Array.isArray(me?.permissions) ? me.permissions : [],
      user: me?.user || null,
    });
  });
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (typeof window !== "undefined") {
  window.addEventListener(ACTOR_CHANGED_EVENT, () => {
    loadingFor = null;
    emit(EMPTY);
    ensureLoaded();
  });
}

export function matchScreenEnabledFor(config, permissions) {
  const mode = config?.matchScreen;
  if (mode === "all") return true;
  if (mode === "admins") return canAccessAdmin(permissions);
  return false;
}

/**
 * { ready, enabled, guess, config, permissions, user } de la sesión actual.
 * guess: lo que dijo /config la última vez (false = apagado, true = para todos,
 * undefined = no se sabe o depende de los permisos), para no esperar en el arranque.
 */
export function useMatchScreen() {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);
  useEffect(() => {
    ensureLoaded();
  }, []);
  const ready = snapshot.ready && snapshot.actor === readActor();
  const mode = readMode();
  return {
    ready,
    guess: mode === "off" ? false : mode === "all" ? true : undefined,
    enabled: ready && matchScreenEnabledFor(snapshot.config, snapshot.permissions),
    config: snapshot.config || {},
    permissions: snapshot.permissions,
    user: snapshot.user,
  };
}
