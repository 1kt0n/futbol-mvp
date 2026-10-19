// Fechas, horas y ordinales del copy de la pantalla del partido (rediseño UX §7.0):
// "Mié 28/10" al inicio de línea, "el mié 28/10" en una frase, "21 hs" en títulos,
// "21:00" en el detalle y "2.º". Los días van fijos en castellano: no dependen del
// idioma del teléfono.

import { parseTs } from "./pickNextEvent.js";

const DAYS_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const DAYS_LONG = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const pad2 = (n) => String(n).padStart(2, "0");
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function toDate(value) {
  if (value instanceof Date) return value;
  const t = parseTs(value);
  return t === null ? null : new Date(t);
}

/** "Mié 28/10" */
export function shortDate(value) {
  const d = toDate(value);
  return d ? `${DAYS_SHORT[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}` : "";
}

/** "miércoles" */
export function longDay(value) {
  const d = toDate(value);
  return d ? DAYS_LONG[d.getDay()] : "";
}

/** "21 hs" o "21:30 hs" */
export function hourLabel(value) {
  const d = toDate(value);
  if (!d) return "";
  return d.getMinutes() ? `${d.getHours()}:${pad2(d.getMinutes())} hs` : `${d.getHours()} hs`;
}

/** "21:00" */
export function clock(value) {
  const d = toDate(value);
  return d ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : "";
}

/** Barra superior: "Mié 28/10 · 21 hs" */
export function topTitle(value) {
  return `${shortDate(value)} · ${hourLabel(value)}`;
}

/** Título del mensaje de WhatsApp: "Miércoles 21 hs" */
export function slotTitle(value) {
  return `${capitalize(longDay(value))} ${hourLabel(value)}`;
}

/** "2.º" */
export function ordinal(n) {
  return `${n}.º`;
}

/** "quedan 3", "queda 1" */
export function spotsLeft(n) {
  return n === 1 ? "queda 1" : `quedan ${n}`;
}

/** "Quedan 6 lugares", "Queda 1 lugar" */
export function spotsLeftSentence(n) {
  return n === 1 ? "Queda 1 lugar" : `Quedan ${n} lugares`;
}

/** "la Cancha 1" (las canchas suelen llamarse "Cancha N"); otro nombre va tal cual: "Techada". */
export function courtPhrase(name = "") {
  const n = String(name || "").trim();
  return /^cancha\b/i.test(n) ? `la ${n}` : n;
}
