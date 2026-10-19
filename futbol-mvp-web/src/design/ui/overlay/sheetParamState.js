// Lógica pura de useSheetParam (?sheet=<name> en la URL). El hook solo lee la
// URL y el history, llama a estas funciones y navega con lo que devuelven.
//
// `pending` es la navegación propia que todavía no llegó a React:
//   { type: "go", key }       → un push/replace nuestro (la key se conoce al toque);
//   { type: "back", fromKey } → un navigate(-1) nuestro (llega con el popstate).
// Mientras tanto, los cambios de URL que se vean son nuestros (o viejos): no son
// el atrás del usuario y no se le pregunta a la hoja.

export const SHEET_PARAM = "sheet";

export function readSheet(search) {
  return new URLSearchParams(search || "").get(SHEET_PARAM) || null;
}

// El search con ?sheet=<name> (o sin el param, con name = null), conservando el resto.
export function withSheet(search, name) {
  const params = new URLSearchParams(search || "");
  if (name) params.set(SHEET_PARAM, name);
  else params.delete(SHEET_PARAM);
  const out = params.toString();
  return out ? `?${out}` : "";
}

// El state de la entrada nueva: el de la actual, marcado (o no) como nuestro.
export function entryState(usr, sheetPushed) {
  const state = usr && typeof usr === "object" ? { ...usr } : {};
  if (sheetPushed) state.sheetPushed = sheetPushed;
  else delete state.sheetPushed;
  return Object.keys(state).length > 0 ? state : null;
}

// La key de la entrada actual, como la calcula react-router.
export function historyKeyOf(historyState) {
  return (historyState && historyState.key) || "default";
}

// open(name): un push, salvo que un close() del mismo tick todavía no haya
// navegado: ahí se cancela ese -1 y se reemplaza la entrada (que sigue siendo
// nuestra solo si ya lo era).
export function planOpen({ closing, search, historyState }) {
  if (closing && readSheet(search)) {
    return { replace: true, ours: Boolean(historyState?.usr?.sheetPushed) };
  }
  return { replace: false, ours: true };
}

// close(): "back" si la entrada la pusimos nosotros (y hay adónde volver),
// "replace" si llegó así (deep link), "none" si la URL ya no tiene el param.
export function planClose({ search, historyState }) {
  if (!readSheet(search)) return "none";
  if (historyState?.usr?.sheetPushed && historyState.idx > 0) return "back";
  return "replace";
}

// Un location nuevo que React ya pintó. Devuelve:
//   { type: "keep" }           → no cambia nada;
//   { type: "set", current }   → current pasa a ser ese;
//   { type: "ask", next }      → el usuario sacó (o cambió) el param: hay que
//                                preguntarle a la hoja abierta si lo bloquea.
// Siempre con el `pending` que queda.
export function reconcileLocation({ current, pending }, { key, sheet, historyKey }) {
  // react-router aplica las navegaciones en una transición: si el history ya va
  // por otra entrada, esta es vieja y va a llegar otra.
  if (key !== historyKey) return { type: "keep", pending };
  if (pending?.type === "back") {
    if (key === pending.fromKey) return { type: "keep", pending };
    return { type: "set", current: sheet, pending: null };
  }
  if (pending?.type === "go" && key === pending.key) {
    return { type: "set", current: sheet, pending: null };
  }
  // La URL la cambió otro: el atrás (o el adelante) del navegador, o un link.
  if (sheet === current) return { type: "keep", pending: null };
  if (current === null) return { type: "set", current: sheet, pending: null };
  return { type: "ask", next: sheet, pending: null };
}

// La respuesta de la hoja: si bloquea, sigue abierta y se vuelve a poner el
// param (repush); si no, se cierra por la URL.
export function resolveBack({ current, next, blocked }) {
  return blocked ? { current, repush: current } : { current: next, repush: null };
}
