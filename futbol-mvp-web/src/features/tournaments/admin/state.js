export function computeDraftStage(tournament, teams, matches) {
  if (!tournament || tournament.status !== "DRAFT") return "publish";
  const configReady = !!String(tournament.title || "").trim() && Number(tournament.minutes_per_match) > 0;
  const teamsReady =
    teams.length >= Number(tournament.teams_count || 0) && Number(tournament.teams_count || 0) > 0;
  const fixtureReady = (matches || []).length > 0;

  if (!configReady) return "config";
  if (!teamsReady) return "teams";
  if (!fixtureReady) return "fixture";
  return "publish";
}

