// Capa central de permisos (RBAC) del frontend.
// El backend devuelve en /me un array `permissions` con los codigos efectivos del
// usuario, o `["*"]` para super_admin (comodin: tiene todo).
//
// Toda decision de visibilidad por permiso debe pasar por estas funciones, asi el
// dia que agregamos una funcionalidad nueva solo sumamos su codigo de permiso.

export const WILDCARD = "*";

/** ¿El usuario tiene el permiso `code`? (true si es super_admin / comodin) */
export function can(permissions, code) {
  if (!Array.isArray(permissions)) return false;
  return permissions.includes(WILDCARD) || permissions.includes(code);
}

/** ¿Tiene al menos uno de los permisos de la lista? */
export function canAny(permissions, codes) {
  if (!Array.isArray(permissions)) return false;
  if (permissions.includes(WILDCARD)) return true;
  return codes.some((c) => permissions.includes(c));
}

// Permisos que dan acceso al Panel Admin (cualquiera de estos habilita /admin).
export const PANEL_PERMISSIONS = [
  "events.view",
  "users.view",
  "audit.view",
  "notifications.view",
  "tournaments.view",
  "calendar.view",
  "roles.manage",
];

/** ¿Puede entrar al panel admin? */
export function canAccessAdmin(permissions) {
  return canAny(permissions, PANEL_PERMISSIONS);
}
