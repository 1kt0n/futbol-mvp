// Hook para obtener los permisos del usuario actual desde /me.
// Pensado para componentes/paginas que no tienen ya el estado de /me a mano
// (ej. Calendar, RolesPermisosTab). Las paginas grandes (App, AdminPanel) ya
// traen /me y solo guardan `permissions` en su propio estado + usan can().

import { useEffect, useState } from "react";
import { can as canFn, canAccessAdmin } from "./can.js";
import { handleAuthFailure } from "../authSession.js";

const API_BASE = (
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  ""
).trim();

function getActorId() {
  return localStorage.getItem("actorUserId") || localStorage.getItem("actor_id") || "";
}

export function usePermissions() {
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      const actor = getActorId();
      if (!actor) {
        if (alive) { setPermissions([]); setLoading(false); }
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/me`, {
          headers: { "X-Actor-User-Id": actor },
        });
        if (res.status === 401) {
          handleAuthFailure();
          return;
        }
        const data = await res.json().catch(() => null);
        if (alive) setPermissions(res.ok && Array.isArray(data?.permissions) ? data.permissions : []);
      } catch {
        if (alive) setPermissions([]);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => { alive = false; };
  }, []);

  return {
    permissions,
    loading,
    can: (code) => canFn(permissions, code),
    canAccessAdmin: () => canAccessAdmin(permissions),
  };
}
