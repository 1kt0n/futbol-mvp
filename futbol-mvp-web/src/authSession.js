// Manejo centralizado de fin de sesión.
// Cuando el backend responde 401 (token inválido/expirado), limpiamos el actor
// guardado y recargamos para caer en la pantalla de login. Tras la recarga,
// getActorId() devuelve "" y los wrappers cortan antes de hacer fetch, así que
// no hay loop de recarga.

let handling = false;

export function clearSession() {
  try {
    localStorage.removeItem("actorUserId");
    localStorage.removeItem("actor_id");
    localStorage.removeItem("actor_me");
  } catch {
    /* ignore */
  }
}

export function handleAuthFailure() {
  if (handling) return;
  handling = true;
  clearSession();
  window.location.reload();
}
