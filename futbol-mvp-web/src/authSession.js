// Manejo centralizado de fin de sesión.
// Cuando el backend responde 401 (token inválido/expirado), limpiamos el actor
// guardado y recargamos para caer en la pantalla de login. Tras la recarga,
// getActorId() devuelve "" y los wrappers cortan antes de hacer fetch, así que
// no hay loop de recarga.

let handling = false;

// Evento que avisa que la sesión cambió (login o logout) en esta pestaña.
// El shell lo escucha para mostrar u ocultar la barra de navegación.
export const ACTOR_CHANGED_EVENT = "actor-changed";

export function notifyActorChanged() {
  try {
    window.dispatchEvent(new Event(ACTOR_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

export function clearSession() {
  try {
    localStorage.removeItem("actorUserId");
    localStorage.removeItem("actor_id");
    localStorage.removeItem("actor_me");
  } catch {
    /* ignore */
  }
  notifyActorChanged();
}

export function handleAuthFailure() {
  if (handling) return;
  handling = true;
  clearSession();
  window.location.reload();
}
