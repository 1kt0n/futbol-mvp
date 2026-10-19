// Rutas de la pestaña Partido (rediseño UX 1a, patrón strangler):
// - "/" sin sesión es el login (App). Con sesión y la pantalla nueva prendida
//   para esta persona (MATCH_SCREEN_ENABLED), abre /p/<próximo partido>; si no,
//   la Home de siempre. "?vista=clasica" fuerza la Home (para mover jugadores).
// - "/p/:id" es la pantalla del partido; con el flag apagado vuelve a
//   /?event_id=:id, así los links de WhatsApp siguen andando si se apaga.

import { useEffect, useState } from "react";
import { Link, Navigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import App from "../../App.jsx";
import { canAccessAdmin } from "../../permissions/can.js";
import { getOpenEvents } from "./api.js";
import MatchPage from "./MatchPage.jsx";
import { EmptyState, MatchNotFound, MatchSkeleton } from "./MatchStates.jsx";
import { safeNext, UUID_RE } from "./nextPath.js";
import { pickNextEvent } from "./pickNextEvent.js";
import { useMatchScreen } from "./useMatchScreen.js";

export function HomeRoute() {
  const { actor } = useOutletContext() || {};
  const [params] = useSearchParams();
  const { ready, enabled, guess } = useMatchScreen();

  if (!actor) return <App />;
  const next = safeNext(params.get("next"));
  if (next) return <Navigate to={next} replace />;
  if (params.get("vista") === "clasica") return <App />;
  // Con el flag apagado la última vez, la Home se monta ya (y no se vuelve a montar
  // cuando llega /config: es el mismo elemento en el mismo lugar).
  if (!ready) return guess === false ? <App /> : <MatchSkeleton />;
  if (!enabled) return <App />;
  const eventId = params.get("event_id");
  if (eventId) return <Navigate to={`/p/${eventId}`} replace />;
  return <MatchHome />;
}

export function MatchRoute() {
  const { id } = useParams();
  const { ready, enabled } = useMatchScreen();
  if (!ready) return <MatchSkeleton />;
  if (!enabled) return <Navigate to={`/?event_id=${encodeURIComponent(id || "")}`} replace />;
  if (!UUID_RE.test(id || "")) return <MatchNotFound />;
  return <MatchPage key={id} eventId={id} />;
}

/** "/" con la pantalla nueva: va al próximo partido o muestra el estado vacío (§7.9). */
function MatchHome() {
  const { permissions } = useMatchScreen();
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    let alive = true;
    getOpenEvents()
      .then((events) => alive && setState({ status: "ok", next: pickNextEvent(events) }))
      .catch(() => alive && setState({ status: "error" }));
    return () => {
      alive = false;
    };
  }, []);

  if (state.status === "loading") return <MatchSkeleton />;
  if (state.next) return <Navigate to={`/p/${state.next.id}`} replace />;
  if (state.status === "error") {
    return (
      <EmptyState title="No pudimos conectarnos." text="Revisá tu conexión y probá de nuevo.">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="focus-ring mt-4 inline-flex min-h-[44px] items-center rounded-xl bg-emerald-500 px-4 text-base font-semibold text-black hover:bg-emerald-400"
        >
          Reintentar
        </button>
      </EmptyState>
    );
  }
  if (canAccessAdmin(permissions)) {
    return (
      <EmptyState title="No hay partido armado." text="Armalo desde Gestión: Repetir copia el de la semana pasada.">
        <Link to="/admin" className="focus-ring mt-4 inline-flex min-h-[44px] items-center rounded-xl bg-emerald-500 px-4 text-base font-semibold text-black hover:bg-emerald-400">
          Ir a Gestión
        </Link>
      </EmptyState>
    );
  }
  return <EmptyState title="Todavía no hay partido esta semana." text="Cuando se arme, te aparece acá." />;
}
