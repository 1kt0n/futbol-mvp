import Card from "../../../../design/ui/Card.jsx";
import { cn } from "../../../../App.jsx";

const LEVELS = ["INICIAL", "RECREATIVO", "COMPETITIVO"];

export default function TeamsTab({
  tournament,
  teams,
  busy,
  teamForm,
  setTeamForm,
  selectedTeamId,
  setSelectedTeamId,
  memberForm,
  setMemberForm,
  userQuery,
  setUserQuery,
  userSuggestions,
  usersBusy,
  onSelectSuggestion,
  onAddTeam,
  onDeleteTeam,
  onAddMember,
}) {
  const selectedTeam = teams.find((x) => x.id === selectedTeamId);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2" data-testid="tournament-teams-tab">
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Equipos</h3>
            <p className="text-xs text-white/60">{teams.length}/{tournament.teams_count} creados</p>
          </div>
          <div className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold">
            {Math.min(100, Math.round((teams.length / Math.max(1, Number(tournament.teams_count))) * 100))}%
          </div>
        </div>

        <form className="grid grid-cols-1 gap-2 sm:grid-cols-4" onSubmit={onAddTeam}>
          <input required placeholder="Nombre de equipo" data-testid="team-name-input" value={teamForm.name} onChange={(e) => setTeamForm((p) => ({ ...p, name: e.target.value }))} className="focus-ring rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm sm:col-span-2" />
          <input placeholder="Emoji" data-testid="team-emoji-input" value={teamForm.logo_emoji} onChange={(e) => setTeamForm((p) => ({ ...p, logo_emoji: e.target.value }))} className="focus-ring rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" />
          <button disabled={busy || tournament.status !== "DRAFT"} data-testid="team-add-btn" className="focus-ring rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-40">Agregar</button>
        </form>

        <div className="mt-3 space-y-2">
          {teams.map((x) => (
            <div key={x.id} className={cn("rounded-xl border px-3 py-2 transition", selectedTeamId === x.id ? "border-emerald-300/50 bg-emerald-500/10" : "border-white/10 bg-black/20")}>
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => setSelectedTeamId(x.id)} data-testid={`team-select-${x.id}`} className="focus-ring text-left text-sm font-semibold text-white">
                  {x.logo_emoji ? `${x.logo_emoji} ` : ""}{x.name}
                </button>
                <button
                  type="button"
                  disabled={busy || tournament.status !== "DRAFT"}
                  data-testid={`team-delete-${x.id}`}
                  onClick={() => onDeleteTeam(x.id)}
                  className="focus-ring rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-200 disabled:opacity-40"
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))}

          {teams.length === 0 && (
            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/60">Todavia no hay equipos.</div>
          )}
        </div>
      </Card>

      <Card>
        <h3 className="text-lg font-semibold">Miembros {selectedTeam ? `- ${selectedTeam.name}` : ""}</h3>
        {!selectedTeam ? (
          <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white/60">Selecciona un equipo para cargar miembros.</div>
        ) : (
          <>
            <form className="mt-3 space-y-2" onSubmit={onAddMember}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <select data-testid="member-type-select" value={memberForm.member_type} onChange={(e) => setMemberForm((p) => ({ ...p, member_type: e.target.value, user_id: "", guest_name: "" }))} className="focus-ring rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm">
                  <option value="USER">Usuario existente</option>
                  <option value="GUEST">Invitado</option>
                </select>
                <select data-testid="member-level-select" value={memberForm.level_override} onChange={(e) => setMemberForm((p) => ({ ...p, level_override: e.target.value }))} className="focus-ring rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm">
                  <option value="">Nivel (opcional)</option>
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
                <button disabled={busy || tournament.status !== "DRAFT"} data-testid="member-add-btn" className="focus-ring rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-40">Agregar</button>
              </div>

              {memberForm.member_type === "USER" ? (
                <>
                  <input placeholder="Buscar usuario por nombre o telefono" data-testid="member-user-query-input" value={userQuery} onChange={(e) => setUserQuery(e.target.value)} className="focus-ring w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" />
                  <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                    <div className="mb-1 text-[11px] text-white/60">Sugerencias (maximo 4 resultados)</div>
                    {usersBusy ? (
                      <div className="text-xs text-white/50">Buscando usuarios...</div>
                    ) : userSuggestions.length === 0 ? (
                      <div className="text-xs text-white/50">Sin resultados para esta busqueda.</div>
                    ) : (
                      <div className="space-y-1">
                        {userSuggestions.map((user) => (
                          <button
                            type="button"
                            key={user.id}
                            data-testid={`member-suggestion-${user.id}`}
                            onClick={() => onSelectSuggestion(user)}
                            className={cn(
                              "focus-ring w-full rounded-md border px-2 py-1 text-left text-xs",
                              memberForm.user_id === user.id
                                ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-100"
                                : "border-white/10 bg-black/30 text-white/80 hover:bg-black/40"
                            )}
                          >
                            <div className="font-semibold">{user.full_name}</div>
                            <div className="text-white/60">{user.phone_e164}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <input placeholder="Nombre del invitado" data-testid="member-guest-name-input" value={memberForm.guest_name} onChange={(e) => setMemberForm((p) => ({ ...p, guest_name: e.target.value }))} className="focus-ring w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" />
              )}
            </form>

            <div className="mt-3 space-y-2">
              {(selectedTeam.members || []).map((m) => (
                <div key={m.id} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs">
                  <div className="font-semibold text-white">{m.member_type === "USER" ? m.user_id : m.guest_name}</div>
                  <div className="text-white/60">{m.member_type}{m.level_override ? ` - ${m.level_override}` : ""}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

