import TournamentControlCenter from "./features/tournaments/admin/TournamentControlCenter.jsx";

const NEW_TOURNAMENT_UX = (import.meta.env.VITE_NEW_TOURNAMENT_UX ?? "true") !== "false";

export default function TournamentsAdminTab() {
  if (!NEW_TOURNAMENT_UX) {
    return (
      <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100" data-testid="tournaments-admin-tab">
        El feature flag <code>VITE_NEW_TOURNAMENT_UX</code> esta desactivado, pero la version legacy no esta habilitada en este build.
      </div>
    );
  }
  return <TournamentControlCenter />;
}
