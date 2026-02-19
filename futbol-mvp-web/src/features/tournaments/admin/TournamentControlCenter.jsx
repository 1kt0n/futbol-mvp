import { useEffect, useMemo, useState } from "react";
import { apiFetch, cn } from "../../../App.jsx";
import Card from "../../../design/ui/Card.jsx";
import TournamentHeaderHero from "./TournamentHeaderHero.jsx";
import TournamentDraftStepper from "./TournamentDraftStepper.jsx";
import TournamentTabs from "./TournamentTabs.jsx";
import MatchResultModal from "./MatchResultModal.jsx";
import OverviewTab from "./tabs/OverviewTab.jsx";
import TeamsTab from "./tabs/TeamsTab.jsx";
import FixtureTab from "./tabs/FixtureTab.jsx";
import StandingsTab from "./tabs/StandingsTab.jsx";
import ShareTab from "./tabs/ShareTab.jsx";
import { computeDraftStage } from "./state.js";

const FORMATS = ["ROUND_ROBIN", "KNOCKOUT", "GROUPS_PLAYOFFS"];

const FORMAT_META = {
  ROUND_ROBIN: {
    short: "Liga",
    label: "Todos contra todos",
    tooltip: "Cada equipo juega contra todos una vez. El primero en puntos gana.",
  },
  KNOCKOUT: {
    short: "Copa",
    label: "Eliminacion directa",
    tooltip: "El que pierde queda afuera. El ganador avanza a la siguiente ronda.",
  },
  GROUPS_PLAYOFFS: {
    short: "Grupos",
    label: "Grupos + playoffs",
    tooltip: "Fase de grupos y luego eliminacion directa. Disponible en una proxima fase.",
  },
};

function formatName(code) {
  return FORMAT_META[code]?.label || code;
}

function toDatetimeLocal(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function grouped(matches = []) {
  const byRound = {};
  for (const m of matches) {
    const round = Number(m.round || 0);
    byRound[round] = byRound[round] || [];
    byRound[round].push(m);
  }
  return Object.entries(byRound)
    .map(([round, ms]) => [Number(round), ms.sort((a, b) => a.sort_order - b.sort_order)])
    .sort((a, b) => a[0] - b[0]);
}

export default function TournamentControlCenter() {
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  const [activeTab, setActiveTab] = useState("overview");

  const [createForm, setCreateForm] = useState({
    title: "",
    location_name: "",
    starts_at: "",
    format: "ROUND_ROBIN",
    teams_count: 4,
    minutes_per_match: 20,
  });

  const [teamForm, setTeamForm] = useState({ name: "", logo_emoji: "", is_guest: false });
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [memberForm, setMemberForm] = useState({
    member_type: "USER",
    user_id: "",
    guest_name: "",
    level_override: "",
  });

  const [userQuery, setUserQuery] = useState("");
  const [userSuggestions, setUserSuggestions] = useState([]);
  const [usersBusy, setUsersBusy] = useState(false);
  const [resultModal, setResultModal] = useState(null);

  const tournament = detail?.tournament;
  const teams = detail?.teams || [];
  const matches = detail?.matches || [];
  const rounds = useMemo(() => grouped(matches), [matches]);
  const standings = detail?.standings || [];
  const selectedTeam = teams.find((x) => x.id === selectedTeamId);

  const hasFixture = matches.length > 0;
  const teamsReady = teams.length >= Number(tournament?.teams_count || 0) && Number(tournament?.teams_count || 0) > 0;
  const ready = !!tournament && teamsReady && hasFixture;
  const draftStage = computeDraftStage(tournament, teams, matches);
  const nextMatch = matches.find((m) => m.status === "PENDING") || null;

  const link = tournament?.public_url
    ? (() => {
        const raw = new URL(tournament.public_url, window.location.origin);
        const token = raw.searchParams.get("token") || "";
        const base = new URL(`/tournaments/${tournament.id}`, window.location.origin);
        if (token) base.searchParams.set("token", token);
        return base.toString();
      })()
    : "";

  async function loadList(preferredId = "") {
    setBusy(true);
    setErr("");
    try {
      const data = await apiFetch("/admin/tournaments?limit=200");
      const nextItems = data.items || [];
      setItems(nextItems);

      const nextId =
        preferredId ||
        (nextItems.some((x) => x.id === selectedId) ? selectedId : nextItems[0]?.id || "");
      setSelectedId(nextId);

      if (nextId) {
        await loadDetail(nextId);
      } else {
        setDetail(null);
      }
    } catch (e) {
      setErr(e.message || "No se pudo cargar la lista de torneos.");
    } finally {
      setBusy(false);
    }
  }

  async function loadDetail(id) {
    setBusy(true);
    setErr("");
    try {
      const data = await apiFetch(`/admin/tournaments/${id}`);
      setDetail(data);
      setSelectedTeamId((prev) =>
        data?.teams?.some((x) => x.id === prev) ? prev : data?.teams?.[0]?.id || ""
      );
      setResultModal(null);
    } catch (e) {
      setErr(e.message || "No se pudo cargar el torneo seleccionado.");
    } finally {
      setBusy(false);
    }
  }

  async function save(action, fn) {
    setBusy(true);
    setErr("");
    setOk("");
    try {
      await fn();
      setOk(action);
    } catch (e) {
      setErr(e.message || "No se pudo completar la accion.");
    } finally {
      setBusy(false);
    }
  }

  async function loadUserSuggestions(rawQuery) {
    if (!selectedTeam || memberForm.member_type !== "USER") {
      setUserSuggestions([]);
      return;
    }

    setUsersBusy(true);
    try {
      const query = String(rawQuery || "").trim();
      const path = query
        ? `/admin/users?limit=4&query=${encodeURIComponent(query)}`
        : "/admin/users?limit=4";
      const data = await apiFetch(path);
      setUserSuggestions(data.users || []);
    } catch {
      setUserSuggestions([]);
    } finally {
      setUsersBusy(false);
    }
  }

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const enabled = memberForm.member_type === "USER" && selectedTeam;
    if (!enabled) {
      setUserSuggestions([]);
      return undefined;
    }
    const timer = setTimeout(() => loadUserSuggestions(userQuery), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userQuery, memberForm.member_type, selectedTeamId]);

  function selectSuggestion(user) {
    setMemberForm((prev) => ({ ...prev, user_id: user.id }));
    setUserQuery(user.full_name || "");
  }

  function openResultModal(match) {
    setResultModal({
      match_id: match.id,
      round: match.round,
      status: match.status,
      home_name: match.home.name,
      away_name: match.away.name,
      home_goals: Number(match.home_goals || 0),
      away_goals: Number(match.away_goals || 0),
      started_at: match.started_at,
      ended_at: match.ended_at,
    });
  }

  function updateResultModal(field, value) {
    setResultModal((prev) => ({ ...prev, [field]: value }));
  }

  function handleCreateTournament(e) {
    e.preventDefault();
    save("Torneo creado correctamente.", async () => {
      const created = await apiFetch("/admin/tournaments", {
        method: "POST",
        body: {
          ...createForm,
          location_name: createForm.location_name || null,
          starts_at: createForm.starts_at ? new Date(createForm.starts_at).toISOString() : null,
          teams_count: Number(createForm.teams_count),
          minutes_per_match: Number(createForm.minutes_per_match),
        },
      });
      setCreateForm({
        title: "",
        location_name: "",
        starts_at: "",
        format: "ROUND_ROBIN",
        teams_count: 4,
        minutes_per_match: 20,
      });
      await loadList(created.id);
    });
  }

  function handleSaveConfig() {
    if (!tournament) return;
    save("Configuracion guardada.", async () => {
      await apiFetch(`/admin/tournaments/${tournament.id}`, {
        method: "PATCH",
        body: {
          title: tournament.title,
          location_name: tournament.location_name || null,
          starts_at: tournament.starts_at || null,
          format: tournament.format,
          teams_count: Number(tournament.teams_count),
          minutes_per_match: Number(tournament.minutes_per_match),
        },
      });
      await loadDetail(tournament.id);
    });
  }

  function handleGenerateFixture() {
    if (!tournament) return;
    save("Fixture generado correctamente.", async () => {
      await apiFetch(`/admin/tournaments/${tournament.id}/generate-fixture`, {
        method: "POST",
      });
      await loadDetail(tournament.id);
    });
  }

  function handleGoLive() {
    if (!tournament) return;
    save("Torneo pasado a LIVE.", async () => {
      await apiFetch(`/admin/tournaments/${tournament.id}/status`, {
        method: "POST",
        body: { status: "LIVE" },
      });
      await loadList(tournament.id);
    });
  }

  function handleFinishTournament() {
    if (!tournament) return;
    save("Torneo finalizado.", async () => {
      await apiFetch(`/admin/tournaments/${tournament.id}/status`, {
        method: "POST",
        body: { status: "FINISHED" },
      });
      await loadList(tournament.id);
    });
  }

  function handleArchiveTournament() {
    if (!tournament) return;
    save("Torneo archivado.", async () => {
      await apiFetch(`/admin/tournaments/${tournament.id}/status`, {
        method: "POST",
        body: { status: "ARCHIVED" },
      });
      await loadList(tournament.id);
    });
  }

  function handleAddTeam(e) {
    e.preventDefault();
    if (!tournament) return;
    save("Equipo creado correctamente.", async () => {
      await apiFetch(`/admin/tournaments/${tournament.id}/teams`, {
        method: "POST",
        body: {
          name: teamForm.name,
          logo_emoji: teamForm.logo_emoji || null,
          is_guest: !!teamForm.is_guest,
        },
      });
      setTeamForm({ name: "", logo_emoji: "", is_guest: false });
      await loadDetail(tournament.id);
    });
  }

  function handleDeleteTeam(teamId) {
    if (!tournament) return;
    save("Equipo eliminado.", async () => {
      await apiFetch(`/admin/tournaments/${tournament.id}/teams/${teamId}`, { method: "DELETE" });
      await loadDetail(tournament.id);
    });
  }

  function handleAddMember(e) {
    e.preventDefault();
    if (!tournament || !selectedTeam) return;
    if (memberForm.member_type === "USER" && !memberForm.user_id) {
      setErr("Selecciona un usuario de la lista antes de agregar.");
      return;
    }

    save("Miembro agregado correctamente.", async () => {
      await apiFetch(`/admin/tournaments/${tournament.id}/teams/${selectedTeam.id}/members`, {
        method: "POST",
        body: {
          member_type: memberForm.member_type,
          user_id: memberForm.member_type === "USER" ? memberForm.user_id || null : null,
          guest_name: memberForm.member_type === "GUEST" ? memberForm.guest_name || null : null,
          level_override: memberForm.level_override || null,
        },
      });
      setMemberForm({
        member_type: "USER",
        user_id: "",
        guest_name: "",
        level_override: "",
      });
      setUserQuery("");
      setUserSuggestions([]);
      await loadDetail(tournament.id);
    });
  }

  function handleStartMatch(matchId) {
    if (!tournament) return;
    save("Partido iniciado.", async () => {
      await apiFetch(`/admin/tournaments/${tournament.id}/matches/${matchId}/start`, { method: "POST" });
      await loadDetail(tournament.id);
    });
  }

  return (
    <div className="space-y-4" data-testid="tournaments-admin-tab">
      <div className="sr-only" aria-live="polite">{ok || err}</div>
      {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{err}</div>}
      {ok && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">{ok}</div>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <div className="font-semibold text-white">Torneos</div>
            <button data-testid="tournaments-reload-btn" className="focus-ring rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs hover:bg-white/10" onClick={() => loadList()} disabled={busy}>Recargar</button>
          </div>
          <div className="text-xs text-white/50">Selecciona un torneo para administrarlo.</div>
          <div className="mt-3 space-y-2 max-h-[300px] overflow-y-auto pr-1">
            {items.length === 0 && (
              <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/60">Todavia no hay torneos creados.</div>
            )}
            {items.map((item) => (
              <button
                key={item.id}
                data-testid={`tournament-list-item-${item.id}`}
                onClick={() => {
                  setSelectedId(item.id);
                  loadDetail(item.id);
                }}
                className={cn(
                  "focus-ring w-full rounded-lg border px-3 py-2 text-left",
                  selectedId === item.id
                    ? "border-emerald-400/50 bg-emerald-500/10"
                    : "border-white/10 bg-black/20 hover:bg-black/30"
                )}
              >
                <div className="truncate text-sm font-semibold text-white">{item.title}</div>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span className="rounded-full border border-white/20 px-2 py-0.5 font-semibold text-white/70">{item.status}</span>
                  <span className="text-white/60">{formatName(item.format)}</span>
                </div>
              </button>
            ))}
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <div className="mb-2 font-semibold text-white">Crear torneo</div>
          <div className="mb-3 text-xs text-white/60">Arma un torneo rapido y despues ajusta desde el centro de control.</div>
          <form className="grid grid-cols-1 gap-2 md:grid-cols-2" onSubmit={handleCreateTournament}>
            <label className="text-xs font-semibold text-white/70">
              Nombre del torneo
              <input required placeholder="Ej: Torneo Viernes Noche" data-testid="create-tournament-title-input" value={createForm.title} onChange={(e) => setCreateForm((p) => ({ ...p, title: e.target.value }))} className="focus-ring mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-semibold text-white/70">
              Ubicacion
              <input placeholder="Ej: El poli de cramer" data-testid="create-tournament-location-input" value={createForm.location_name} onChange={(e) => setCreateForm((p) => ({ ...p, location_name: e.target.value }))} className="focus-ring mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-semibold text-white/70">
              Inicio
              <input type="datetime-local" data-testid="create-tournament-starts-at-input" value={createForm.starts_at} onChange={(e) => setCreateForm((p) => ({ ...p, starts_at: e.target.value }))} className="focus-ring mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-semibold text-white/70">
              Formato
              <select data-testid="create-tournament-format-select" value={createForm.format} onChange={(e) => setCreateForm((p) => ({ ...p, format: e.target.value }))} className="focus-ring mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" title={FORMAT_META[createForm.format]?.tooltip || ""}>
                {FORMATS.map((f) => (<option key={f} value={f}>{formatName(f)}</option>))}
              </select>
            </label>
            <label className="text-xs font-semibold text-white/70">
              Cantidad de equipos
              <input type="number" min={2} max={16} data-testid="create-tournament-teams-count-input" value={createForm.teams_count} onChange={(e) => setCreateForm((p) => ({ ...p, teams_count: e.target.value }))} className="focus-ring mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-semibold text-white/70">
              Minutos por partido
              <input type="number" min={5} max={120} data-testid="create-tournament-minutes-input" value={createForm.minutes_per_match} onChange={(e) => setCreateForm((p) => ({ ...p, minutes_per_match: e.target.value }))} className="focus-ring mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" />
            </label>
            <button disabled={busy} data-testid="create-tournament-submit-btn" className="focus-ring md:col-span-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-40">Crear torneo</button>
          </form>
        </Card>
      </div>

      {!tournament ? null : (
        <>
          <TournamentHeaderHero
            tournament={tournament}
            ready={ready}
            teamsCount={teams.length}
            matchesCount={matches.length}
            busy={busy}
            onSaveConfig={handleSaveConfig}
            onGenerateFixture={handleGenerateFixture}
            onGoLive={handleGoLive}
            onFinish={handleFinishTournament}
            onArchive={handleArchiveTournament}
          />

          <TournamentDraftStepper visible={tournament.status === "DRAFT"} stage={draftStage} />

          <TournamentTabs activeTab={activeTab} onChange={setActiveTab} />

          {activeTab === "overview" && (
            <div className="space-y-4">
              <Card>
                <h3 className="text-lg font-semibold">Configuracion</h3>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                  <input data-testid="tournament-config-title-input" value={tournament.title || ""} onChange={(e) => setDetail((p) => ({ ...p, tournament: { ...p.tournament, title: e.target.value } }))} className="focus-ring rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" placeholder="Titulo" />
                  <input data-testid="tournament-config-location-input" value={tournament.location_name || ""} onChange={(e) => setDetail((p) => ({ ...p, tournament: { ...p.tournament, location_name: e.target.value } }))} className="focus-ring rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" placeholder="Ubicacion" />
                  <input type="datetime-local" data-testid="tournament-config-starts-at-input" value={toDatetimeLocal(tournament.starts_at)} onChange={(e) => setDetail((p) => ({ ...p, tournament: { ...p.tournament, starts_at: e.target.value ? new Date(e.target.value).toISOString() : null } }))} className="focus-ring rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" />
                  <select data-testid="tournament-config-format-select" value={tournament.format} onChange={(e) => setDetail((p) => ({ ...p, tournament: { ...p.tournament, format: e.target.value } }))} className="focus-ring rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" title={FORMAT_META[tournament.format]?.tooltip || ""}>
                    {FORMATS.map((f) => (<option key={f} value={f}>{formatName(f)}</option>))}
                  </select>
                  <input type="number" min={2} max={16} data-testid="tournament-config-teams-count-input" value={tournament.teams_count} onChange={(e) => setDetail((p) => ({ ...p, tournament: { ...p.tournament, teams_count: Number(e.target.value || 0) } }))} className="focus-ring rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" placeholder="Equipos" />
                  <input type="number" min={5} max={120} data-testid="tournament-config-minutes-input" value={tournament.minutes_per_match} onChange={(e) => setDetail((p) => ({ ...p, tournament: { ...p.tournament, minutes_per_match: Number(e.target.value || 0) } }))} className="focus-ring rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" placeholder="Minutos" />
                </div>
                <div className="mt-2 text-xs text-white/60">Formato actual: <span className="font-semibold text-white">{formatName(tournament.format)}</span>. {FORMAT_META[tournament.format]?.tooltip}</div>
              </Card>

              <OverviewTab tournament={tournament} teams={teams} matches={matches} standings={standings} nextMatch={nextMatch} />
            </div>
          )}

          {activeTab === "teams" && (
            <TeamsTab
              tournament={tournament}
              teams={teams}
              busy={busy}
              teamForm={teamForm}
              setTeamForm={setTeamForm}
              selectedTeamId={selectedTeamId}
              setSelectedTeamId={setSelectedTeamId}
              memberForm={memberForm}
              setMemberForm={setMemberForm}
              userQuery={userQuery}
              setUserQuery={setUserQuery}
              userSuggestions={userSuggestions}
              usersBusy={usersBusy}
              onSelectSuggestion={selectSuggestion}
              onAddTeam={handleAddTeam}
              onDeleteTeam={handleDeleteTeam}
              onAddMember={handleAddMember}
            />
          )}

          {activeTab === "fixture" && (
            <FixtureTab
              tournament={tournament}
              rounds={rounds}
              busy={busy}
              onGenerateFixture={handleGenerateFixture}
              onStartMatch={handleStartMatch}
              onOpenResult={openResultModal}
            />
          )}

          {activeTab === "standings" && (
            <StandingsTab tournament={tournament} standings={standings} rounds={rounds} />
          )}

          {activeTab === "share" && (
            <ShareTab
              link={link}
              onCopy={() => {
                navigator.clipboard?.writeText(link);
                setOk("Link publico copiado.");
              }}
            />
          )}
        </>
      )}

      <MatchResultModal
        open={!!resultModal}
        busy={busy}
        state={resultModal}
        onClose={() => setResultModal(null)}
        onChange={updateResultModal}
        onSave={() =>
          save("Resultado actualizado.", async () => {
            await apiFetch(`/admin/tournaments/${tournament.id}/matches/${resultModal.match_id}/score`, {
              method: "PATCH",
              body: {
                home_goals: Number(resultModal.home_goals || 0),
                away_goals: Number(resultModal.away_goals || 0),
              },
            });
            await loadDetail(tournament.id);
            setResultModal(null);
          })
        }
        onFinish={() =>
          save("Partido finalizado con resultado guardado.", async () => {
            await apiFetch(`/admin/tournaments/${tournament.id}/matches/${resultModal.match_id}/score`, {
              method: "PATCH",
              body: {
                home_goals: Number(resultModal.home_goals || 0),
                away_goals: Number(resultModal.away_goals || 0),
              },
            });
            await apiFetch(`/admin/tournaments/${tournament.id}/matches/${resultModal.match_id}/finish`, {
              method: "POST",
            });
            await loadDetail(tournament.id);
            setResultModal(null);
          })
        }
      />
    </div>
  );
}

