// Shell de las pantallas con sesión: el contenido de la ruta + la barra inferior.
// Sin sesión solo se muestra "/" (el login), sin barra; cualquier otra pantalla
// vuelve al login. Las rutas públicas (/e/:code, /g/:token, /tournaments/*)
// quedan fuera del shell en main.jsx.

import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { apiFetch } from "../calendar/api.js";
import { ACTOR_CHANGED_EVENT } from "../authSession.js";
import { can } from "../permissions/can.js";
import { usePermissions } from "../permissions/usePermissions.js";
import BottomNav from "./BottomNav.jsx";
import { AVISOS_CHANGED_EVENT } from "./events.js";

// Los contadores se piden como mucho una vez por minuto al navegar. Descartar un
// aviso, volver a la app o salir de Gestión los refresca en el momento.
const COUNTS_TTL_MS = 60_000;

function readActor() {
  try {
    return localStorage.getItem("actorUserId") || localStorage.getItem("actor_id") || "";
  } catch {
    return "";
  }
}

export default function AppShell() {
  const [actor, setActor] = useState(readActor);
  const { pathname } = useLocation();

  useEffect(() => {
    const sync = () => setActor(readActor());
    window.addEventListener(ACTOR_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ACTOR_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // Cada pantalla abre desde arriba, aunque la anterior estuviera scrolleada.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  const mustLogin = !actor && pathname !== "/";

  // La estructura es siempre la misma (div + barra opcional): si cambiara al
  // iniciar o cerrar sesión, React volvería a montar la pantalla y se perdería
  // su estado (por ejemplo, el aviso de "Bienvenido").
  return (
    <>
      {/* El body ya suma el safe-area de abajo; acá solo el alto de la barra y un respiro. */}
      <div className={actor ? "pb-[calc(var(--tabbar-h)+0.75rem)]" : undefined}>
        {mustLogin ? <Navigate to="/" replace /> : <Outlet />}
      </div>
      {/* key: al cambiar de sesión se vuelven a pedir permisos y contadores */}
      {actor ? <ShellNav key={actor} /> : null}
    </>
  );
}

function ShellNav() {
  const { permissions, canAccessAdmin } = usePermissions();
  const { pathname } = useLocation();
  const [avisos, setAvisos] = useState(0);
  const [pendientes, setPendientes] = useState(0);
  const [tick, setTick] = useState(0);
  const avisosAt = useRef(0);
  const gestionAt = useRef(0);
  const wasInAdmin = useRef(false);
  const canReview = can(permissions, "accounts.review");
  const canUnlock = can(permissions, "users.unlock");
  const inAdmin = pathname.startsWith("/admin");

  useEffect(() => {
    const refresh = () => {
      avisosAt.current = 0;
      gestionAt.current = 0;
      setTick((n) => n + 1);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener(AVISOS_CHANGED_EVENT, refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(AVISOS_CHANGED_EVENT, refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Contador de Avisos. La respuesta se aplica siempre (sin descartarla en el
  // cleanup): con el TTL, una corrida descartada no se vuelve a pedir y el
  // contador quedaría en 0. Si la barra ya se desmontó, el setState no hace nada.
  useEffect(() => {
    if (Date.now() - avisosAt.current < COUNTS_TTL_MS) return;
    avisosAt.current = Date.now();
    apiFetch("/notifications")
      .then((r) => setAvisos(r?.unread_count || 0))
      .catch(() => {});
  }, [pathname, tick]);

  // Contador de Gestión: solicitudes de cuenta + desbloqueos de PIN pendientes.
  // Al salir del Panel se vuelve a pedir, porque ahí se aprueban y rechazan.
  useEffect(() => {
    if (wasInAdmin.current && !inAdmin) gestionAt.current = 0;
    wasInAdmin.current = inAdmin;
    if (!canReview && !canUnlock) return;
    if (Date.now() - gestionAt.current < COUNTS_TTL_MS) return;
    gestionAt.current = Date.now();
    const count = (path) =>
      apiFetch(path)
        .then((r) => r?.requests?.length || 0)
        .catch(() => 0);
    Promise.all([
      canReview ? count("/admin/account-requests") : 0,
      canUnlock ? count("/admin/unlock-requests") : 0,
    ]).then(([a, b]) => setPendientes(a + b));
  }, [pathname, tick, inAdmin, canReview, canUnlock]);

  return (
    <BottomNav
      isAdmin={canAccessAdmin()}
      avisos={avisos}
      // Dentro de Gestión ya se ven las listas: el contador ahí no suma.
      gestion={(canReview || canUnlock) && !inAdmin ? pendientes : 0}
    />
  );
}
