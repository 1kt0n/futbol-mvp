// Reglas puras de la pantalla del partido (se testean en matchLogic.test.js).
// Los datos vienen de GET /events/active?event_id=…&include_finished=1.

import { can } from "../../permissions/can.js";
import { toDate } from "./format.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Las canchas que cuentan para los lugares: sin pseudo-canchas, salvo que no haya otras. */
export function countedCourts(courts = []) {
  const real = courts.filter((c) => !c.is_pseudo);
  return real.length ? real : courts;
}

/** Hero y CTA: anotados, cupo y lugares libres (solo en canchas abiertas). */
export function summarize(courts = []) {
  const counted = countedCourts(courts);
  const occupied = counted.reduce((n, c) => n + c.occupied, 0);
  const capacity = counted.reduce((n, c) => n + c.capacity, 0);
  const open = counted.filter((c) => c.is_open);
  const free = open.reduce((n, c) => n + c.available, 0);
  return { occupied, capacity, free, full: free === 0, courtCount: counted.length, openCount: open.length };
}

/** Primera cancha libre del lado del cliente (con ONE_TAP_REGISTER_ENABLED apagado). */
export function firstFreeCourt(courts = []) {
  return countedCourts(courts).find((c) => c.is_open && c.available > 0) || null;
}

/** Mi lugar: confirmado (con su cancha), en espera (con su puesto) o afuera. */
export function myState(data) {
  const reg = data?.viewer?.registration;
  if (!reg) return { kind: "none" };
  if (reg.status === "WAITLIST") {
    return { kind: "waitlist", registrationId: reg.registration_id, position: reg.waitlist_position };
  }
  const court = (data.courts || []).find((c) => c.court_id === reg.court_id) || null;
  return {
    kind: "confirmed",
    registrationId: reg.registration_id,
    court,
    promotedAt: reg.promoted_at || null,
  };
}

/**
 * Quién entra si se libera un lugar en `court`: el primero de la espera (que no
 * sea quien se baja), siempre que la cancha esté abierta. Es la misma regla de
 * promote_first_waitlist en el backend.
 */
export function whoTakesSpot(data, court, leavingRegistrationId) {
  if (!court?.is_open) return null;
  return (data?.waitlist || []).find((w) => w.registration_id !== leavingRegistrationId) || null;
}

/** A menos de 24 h del inicio (o ya empezado): la baja deja corto al partido. */
export function isLate(startsAt, now = Date.now()) {
  const d = toDate(startsAt);
  return Boolean(d) && d.getTime() - now < DAY_MS;
}

/** "Juan Pérez García" → "Juan G." (nombre de pila + inicial; §7.0: máx. 20 caracteres). */
export function displayName(full = "") {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const label = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
  return label.length > 20 ? `${label.slice(0, 20)}…` : label;
}

/** Nombre de pila, para "Lo toma Juan" y los mensajes. */
export function firstName(full = "") {
  const first = String(full || "").trim().split(/\s+/)[0] || "";
  return first.length > 20 ? `${first.slice(0, 20)}…` : first;
}

/** Nombre para "Lo toma …": un invitado lleva de quién es (§7.2). */
export function takerLabel(entry) {
  if (!entry) return "";
  if (entry.type === "GUEST" && entry.created_by_name) {
    return `${firstName(entry.name)} (invitado de ${firstName(entry.created_by_name)})`;
  }
  return firstName(entry.name);
}

export function canManage(permissions) {
  return can(permissions, "registrations.manage");
}

/** ¿Puedo sacar a este jugador? Quien organiza, el capitán de esa cancha o quien lo invitó. */
export function canRemove(player, court, data, permissions) {
  const viewer = data?.viewer || {};
  if (!player || (player.type === "USER" && player.user_id === viewer.user_id)) return false;
  if (canManage(permissions)) return true;
  if (player.type === "GUEST" && player.created_by_user_id === viewer.user_id) return true;
  if (court && (viewer.captain_court_ids || []).includes(court.court_id)) return true;
  return Boolean(viewer.is_event_captain);
}

/** Mis invitados (no cancelados) en el partido: en canchas y en la espera. */
export function myGuests(data) {
  const me = data?.viewer?.user_id;
  if (!me) return [];
  const inCourts = (data.courts || []).flatMap((c) =>
    c.players.filter((p) => p.type === "GUEST" && p.created_by_user_id === me).map((p) => ({ ...p, court: c }))
  );
  const waiting = (data.waitlist || []).filter((p) => p.type === "GUEST" && p.created_by_user_id === me);
  return [...inCourts, ...waiting];
}

/**
 * Estado del hero: Abierto, Completo, Inscripción cerrada, Jugado o sin canchas
 * todavía. Con todas las canchas cerradas, la inscripción está cerrada aunque el
 * partido siga abierto (anotarse daría error).
 */
export function matchPhase(event, summary) {
  if (!event) return "none";
  if (event.status === "FINALIZED") return "played";
  if (event.status === "CLOSED") return "closed";
  if (event.status !== "OPEN") return "other";
  if (!summary.courtCount) return "empty";
  if (!summary.openCount) return "closed";
  return summary.full ? "full" : "open";
}
