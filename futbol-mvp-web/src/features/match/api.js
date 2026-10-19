// Llamadas de la pantalla del partido. Las escrituras mandan X-UI-Source: match
// (metadata.ui en el audit, rediseño UX §8.1).

import { apiFetch } from "../../calendar/api.js";

const WRITE = { "X-UI-Source": "match" };

export const getMatch = (eventId) =>
  apiFetch(`/events/active?event_id=${encodeURIComponent(eventId)}&include_finished=1`);

export const getOpenEvents = () => apiFetch("/events/open").then((r) => r?.events || []);

export const getNotifications = () => apiFetch("/notifications");

/** body: {} ("Me anoto"), {court_id, if_full:"conflict"} (tocar "Libre") o {court_id, if_full:"waitlist"}. */
export const register = (eventId, body = {}) =>
  apiFetch(`/events/${eventId}/register`, { method: "POST", body, headers: WRITE });

export const addGuest = (eventId, body) =>
  apiFetch(`/events/${eventId}/guests`, { method: "POST", body, headers: WRITE });

/** intent: "undo" (Deshacer) | "notify_group" (avisar al grupo) | undefined. */
export const cancelRegistration = (registrationId, intent) =>
  apiFetch(`/registrations/${registrationId}/cancel`, {
    method: "POST",
    body: intent ? { intent } : undefined,
    headers: WRITE,
  });

export function isNetworkError(e) {
  return e && e.status === undefined && e.name === "TypeError";
}

export const NETWORK_ERROR = "No pudimos conectarnos. Revisá tu conexión y probá de nuevo.";

export function errorMessage(e) {
  return isNetworkError(e) ? NETWORK_ERROR : e?.message || NETWORK_ERROR;
}
