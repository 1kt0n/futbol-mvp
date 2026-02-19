import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { apiFetch, cn } from "./App.jsx";

const FORMATS = ["ROUND_ROBIN", "KNOCKOUT", "GROUPS_PLAYOFFS"];
const LEVELS = ["INICIAL", "RECREATIVO", "COMPETITIVO"];

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

function fmt(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
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

function statusTone(status) {
  if (status === "LIVE") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (status === "FINISHED") return "border-sky-500/30 bg-sky-500/10 text-sky-200";
  if (status === "ARCHIVED") return "border-white/20 bg-white/5 text-white/70";
  return "border-amber-500/30 bg-amber-500/10 text-amber-200";
}

function MatchResultModal({
  open,
  busy,
  state,
  onChange,
  onClose,
  onSave,
  onFinish,
}) {
  if (!open || !state) return null;

  const canSave = state.status === "LIVE" || state.status === "FINISHED";
  const canFinish = state.status === "LIVE";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 p-4"
      role="button"
      tabIndex={-1}
      data-testid="result-modal-overlay"
      onClick={onClose}
    >
      <div
        className="mx-auto mt-20 max-w-xl rounded-2xl border border-white/10 bg-zinc-900 p-4"
        data-testid="result-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold text-white">Cargar resultado</div>
            <div className="text-xs text-white/60">
              Ronda {state.round} - {state.status}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/80 hover:bg-white/10"
          >
            Cerrar
          </button>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="text-sm font-semibold text-white">
            {state.home_name} vs {state.away_name}
          </div>
          <div className="mt-1 text-xs text-white/60">
            Inicio: {fmt(state.started_at)} - Fin: {fmt(state.ended_at)}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div>
            <label className="text-xs font-semibold text-white/70">Goles local</label>
            <input
              type="number"
              min={0}
              value={state.home_goals}
              onChange={(e) => onChange("home_goals", Number(e.target.value || 0))}
              data-testid="result-home-goals-input"
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            />
          </div>
          <div className="mt-5 text-sm text-white/60">-</div>
          <div>
            <label className="text-xs font-semibold text-white/70">Goles visitante</label>
            <input
              type="number"
              min={0}
              value={state.away_goals}
              onChange={(e) => onChange("away_goals", Number(e.target.value || 0))}
              data-testid="result-away-goals-input"
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            disabled={busy || !canSave}
            onClick={onSave}
            data-testid="result-save-btn"
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-200 disabled:opacity-40"
          >
            Guardar resultado
          </button>
          <button
            disabled={busy || !canFinish}
            onClick={onFinish}
            data-testid="result-finish-btn"
            className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm font-semibold text-sky-200 disabled:opacity-40"
          >
            Finalizar partido
          </button>
        </div>

        {!canSave && (
          <div className="mt-3 text-xs text-white/60">
            Este partido esta en PENDING. Inicialo primero para poder cargar resultado.
          </div>
        )}
      </div>
    </div>
  );
}

export default function TournamentsAdminTab() {
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

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
  const selectedTeam = teams.find((x) => x.id === selectedTeamId);
  const link = tournament?.public_url
    ? new URL(tournament.public_url, window.location.origin).toString()
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

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <div className="space-y-4" data-testid="tournaments-admin-tab">
      {err && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          {err}
        </div>
      )}
      {ok && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
          {ok}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-semibold text-white">Torneos</div>
            <button
              data-testid="tournaments-reload-btn"
              className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs hover:bg-white/10"
              onClick={() => loadList()}
              disabled={busy}
            >
              Recargar
            </button>
          </div>
          <div className="text-xs text-white/50">
            Selecciona un torneo para editarlo y cargar resultados.
          </div>
          <div className="mt-3 space-y-2">
            {items.length === 0 && (
              <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/60">
                Todavia no hay torneos creados.
              </div>
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
                  "w-full rounded-lg border px-3 py-2 text-left",
                  selectedId === item.id
                    ? "border-emerald-400/50 bg-emerald-500/10"
                    : "border-white/10 bg-black/20 hover:bg-black/30"
                )}
              >
                <div className="truncate text-sm font-semibold text-white">{item.title}</div>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 font-semibold",
                      statusTone(item.status)
                    )}
                  >
                    {item.status}
                  </span>
                  <span className="text-white/60">{formatName(item.format)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 xl:col-span-2">
          <div className="mb-2 font-semibold text-white">Crear torneo</div>
          <div className="mb-3 text-xs text-white/60">
            Crea un torneo rapido con el formato que mejor se adapte a tu fecha.
          </div>
          <form
            className="grid grid-cols-1 gap-2 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save("Torneo creado correctamente.", async () => {
                const created = await apiFetch("/admin/tournaments", {
                  method: "POST",
                  body: {
                    ...createForm,
                    location_name: createForm.location_name || null,
                    starts_at: createForm.starts_at || null,
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
            }}
          >
            <label className="text-xs font-semibold text-white/70">
              Nombre del torneo
                <input
                  required
                  placeholder="Ej: Torneo Viernes Noche"
                  data-testid="create-tournament-title-input"
                  value={createForm.title}
                  onChange={(e) => setCreateForm((p) => ({ ...p, title: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs font-semibold text-white/70">
              Ubicacion
                <input
                  placeholder="Ej: El poli de cramer"
                  data-testid="create-tournament-location-input"
                  value={createForm.location_name}
                  onChange={(e) => setCreateForm((p) => ({ ...p, location_name: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs font-semibold text-white/70">
              Inicio (ISO 8601)
                <input
                  placeholder="Ej: 2026-03-13T20:00:00Z"
                  data-testid="create-tournament-starts-at-input"
                  value={createForm.starts_at}
                  onChange={(e) => setCreateForm((p) => ({ ...p, starts_at: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs font-semibold text-white/70">
              Formato
              <select
                data-testid="create-tournament-format-select"
                value={createForm.format}
                onChange={(e) => setCreateForm((p) => ({ ...p, format: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
                title={FORMAT_META[createForm.format]?.tooltip || ""}
              >
                {FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {formatName(f)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-white/70">
              Cantidad de equipos
              <input
                type="number"
                min={2}
                max={16}
                data-testid="create-tournament-teams-count-input"
                value={createForm.teams_count}
                onChange={(e) => setCreateForm((p) => ({ ...p, teams_count: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs font-semibold text-white/70">
              Minutos por partido
              <input
                type="number"
                min={5}
                max={120}
                data-testid="create-tournament-minutes-input"
                value={createForm.minutes_per_match}
                onChange={(e) =>
                  setCreateForm((p) => ({ ...p, minutes_per_match: e.target.value }))
                }
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
              />
            </label>
            <div className="md:col-span-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/70">
              <span className="font-semibold text-white">Formato seleccionado:</span>{" "}
              {formatName(createForm.format)}. {FORMAT_META[createForm.format]?.tooltip}
            </div>
            <div className="md:col-span-2 flex flex-wrap gap-2">
              {FORMATS.map((formatCode) => (
                <span
                  key={formatCode}
                  title={FORMAT_META[formatCode].tooltip}
                  className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-white/80"
                >
                  {FORMAT_META[formatCode].short}: {formatName(formatCode)}
                </span>
              ))}
            </div>
            <button
              disabled={busy}
              data-testid="create-tournament-submit-btn"
              className="md:col-span-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold hover:bg-emerald-600 disabled:opacity-40"
            >
              Crear torneo
            </button>
          </form>
        </div>
      </div>
      {!tournament ? null : (
        <>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-semibold text-white">{tournament.title}</div>
                <div className="text-xs text-white/60">
                  Ajustes generales del torneo seleccionado.
                </div>
              </div>
              <div
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-semibold",
                  statusTone(tournament.status)
                )}
              >
                {tournament.status}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <input
                data-testid="tournament-config-title-input"
                value={tournament.title || ""}
                onChange={(e) =>
                  setDetail((p) => ({
                    ...p,
                    tournament: { ...p.tournament, title: e.target.value },
                  }))
                }
                className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
                placeholder="Titulo"
              />
              <input
                data-testid="tournament-config-location-input"
                value={tournament.location_name || ""}
                onChange={(e) =>
                  setDetail((p) => ({
                    ...p,
                    tournament: { ...p.tournament, location_name: e.target.value },
                  }))
                }
                className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
                placeholder="Ubicacion"
              />
              <input
                data-testid="tournament-config-starts-at-input"
                value={tournament.starts_at || ""}
                onChange={(e) =>
                  setDetail((p) => ({
                    ...p,
                    tournament: { ...p.tournament, starts_at: e.target.value },
                  }))
                }
                className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
                placeholder="Inicio (ISO 8601)"
              />
              <select
                data-testid="tournament-config-format-select"
                value={tournament.format}
                onChange={(e) =>
                  setDetail((p) => ({
                    ...p,
                    tournament: { ...p.tournament, format: e.target.value },
                  }))
                }
                className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
                title={FORMAT_META[tournament.format]?.tooltip || ""}
              >
                {FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {formatName(f)}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={2}
                max={16}
                data-testid="tournament-config-teams-count-input"
                value={tournament.teams_count}
                onChange={(e) =>
                  setDetail((p) => ({
                    ...p,
                    tournament: {
                      ...p.tournament,
                      teams_count: Number(e.target.value || 0),
                    },
                  }))
                }
                className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
                placeholder="Equipos"
              />
              <input
                type="number"
                min={5}
                max={120}
                data-testid="tournament-config-minutes-input"
                value={tournament.minutes_per_match}
                onChange={(e) =>
                  setDetail((p) => ({
                    ...p,
                    tournament: {
                      ...p.tournament,
                      minutes_per_match: Number(e.target.value || 0),
                    },
                  }))
                }
                className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
                placeholder="Minutos"
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                disabled={busy || tournament.status !== "DRAFT"}
                data-testid="tournament-save-config-btn"
                onClick={() =>
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
                  })
                }
                className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black disabled:opacity-40"
              >
                Guardar configuracion
              </button>
              <button
                disabled={busy || tournament.status !== "DRAFT"}
                data-testid="tournament-status-live-btn"
                onClick={() =>
                  save("Torneo pasado a LIVE.", async () => {
                    await apiFetch(`/admin/tournaments/${tournament.id}/status`, {
                      method: "POST",
                      body: { status: "LIVE" },
                    });
                    await loadList(tournament.id);
                  })
                }
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs disabled:opacity-40"
              >
                Pasar a LIVE
              </button>
              <button
                disabled={busy || tournament.status !== "LIVE"}
                data-testid="tournament-status-finished-btn"
                onClick={() =>
                  save("Torneo finalizado.", async () => {
                    await apiFetch(`/admin/tournaments/${tournament.id}/status`, {
                      method: "POST",
                      body: { status: "FINISHED" },
                    });
                    await loadList(tournament.id);
                  })
                }
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs disabled:opacity-40"
              >
                Pasar a FINISHED
              </button>
              <button
                disabled={busy || tournament.status !== "FINISHED"}
                data-testid="tournament-status-archived-btn"
                onClick={() =>
                  save("Torneo archivado.", async () => {
                    await apiFetch(`/admin/tournaments/${tournament.id}/status`, {
                      method: "POST",
                      body: { status: "ARCHIVED" },
                    });
                    await loadList(tournament.id);
                  })
                }
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs disabled:opacity-40"
              >
                Pasar a ARCHIVED
              </button>
            </div>
            <div className="mt-2 text-xs text-white/60">
              Formato actual: <span className="font-semibold text-white">{formatName(tournament.format)}</span>.{" "}
              {FORMAT_META[tournament.format]?.tooltip}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white">
                    Equipos ({teams.length}/{tournament.teams_count})
                  </div>
                  <div className="text-xs text-white/60">
                    Crea equipos y luego genera el fixture.
                  </div>
                </div>
                <button
                  disabled={busy || tournament.status !== "DRAFT"}
                  data-testid="tournament-generate-fixture-btn"
                  onClick={() =>
                    save("Fixture generado correctamente.", async () => {
                      await apiFetch(`/admin/tournaments/${tournament.id}/generate-fixture`, {
                        method: "POST",
                      });
                      await loadDetail(tournament.id);
                    })
                  }
                  className="rounded-lg bg-white px-3 py-1 text-xs font-semibold text-black disabled:opacity-40"
                >
                  Generar fixture
                </button>
              </div>

              <form
                className="grid grid-cols-1 gap-2 sm:grid-cols-4"
                onSubmit={(e) => {
                  e.preventDefault();
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
                }}
              >
                <input
                  required
                  placeholder="Nombre de equipo"
                  data-testid="team-name-input"
                  value={teamForm.name}
                  onChange={(e) => setTeamForm((p) => ({ ...p, name: e.target.value }))}
                  className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm sm:col-span-2"
                />
                <input
                  placeholder="Emoji"
                  data-testid="team-emoji-input"
                  value={teamForm.logo_emoji}
                  onChange={(e) => setTeamForm((p) => ({ ...p, logo_emoji: e.target.value }))}
                  className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
                />
                <button
                  disabled={busy || tournament.status !== "DRAFT"}
                  data-testid="team-add-btn"
                  className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold hover:bg-emerald-600 disabled:opacity-40"
                >
                  Agregar
                </button>
              </form>

              <div className="mt-2 space-y-2">
                {teams.map((x) => (
                  <div
                    key={x.id}
                    className={cn(
                      "rounded-lg border px-3 py-2",
                      selectedTeamId === x.id
                        ? "border-emerald-400/50 bg-emerald-500/10"
                        : "border-white/10 bg-black/20"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => setSelectedTeamId(x.id)}
                        data-testid={`team-select-${x.id}`}
                        className="text-left text-sm font-semibold text-white"
                      >
                        {x.logo_emoji ? `${x.logo_emoji} ` : ""}
                        {x.name}
                      </button>
                      <button
                        disabled={busy || tournament.status !== "DRAFT"}
                        data-testid={`team-delete-${x.id}`}
                        onClick={() =>
                          save("Equipo eliminado.", async () => {
                            await apiFetch(`/admin/tournaments/${tournament.id}/teams/${x.id}`, {
                              method: "DELETE",
                            });
                            await loadDetail(tournament.id);
                          })
                        }
                        className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-300 disabled:opacity-40"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="mb-2 font-semibold text-white">
                Miembros {selectedTeam ? `- ${selectedTeam.name}` : ""}
              </div>
              {!selectedTeam ? (
                <div className="text-sm text-white/60">
                  Selecciona un equipo para cargar miembros.
                </div>
              ) : (
                <>
                  <div className="mb-2 text-xs text-white/60">
                    Puedes buscar por nombre/telefono y elegir rapido un usuario existente.
                  </div>
                  <form
                    className="space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (memberForm.member_type === "USER" && !memberForm.user_id) {
                        setErr("Selecciona un usuario de la lista antes de agregar.");
                        return;
                      }
                      save("Miembro agregado correctamente.", async () => {
                        await apiFetch(
                          `/admin/tournaments/${tournament.id}/teams/${selectedTeam.id}/members`,
                          {
                            method: "POST",
                            body: {
                              member_type: memberForm.member_type,
                              user_id:
                                memberForm.member_type === "USER"
                                  ? memberForm.user_id || null
                                  : null,
                              guest_name:
                                memberForm.member_type === "GUEST"
                                  ? memberForm.guest_name || null
                                  : null,
                              level_override: memberForm.level_override || null,
                            },
                          }
                        );
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
                    }}
                  >
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <select
                        data-testid="member-type-select"
                        value={memberForm.member_type}
                        onChange={(e) =>
                          setMemberForm((p) => ({
                            ...p,
                            member_type: e.target.value,
                            user_id: "",
                            guest_name: "",
                          }))
                        }
                        className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
                      >
                        <option value="USER">Usuario existente</option>
                        <option value="GUEST">Invitado</option>
                      </select>
                      <select
                        data-testid="member-level-select"
                        value={memberForm.level_override}
                        onChange={(e) =>
                          setMemberForm((p) => ({ ...p, level_override: e.target.value }))
                        }
                        className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
                      >
                        <option value="">Nivel (opcional)</option>
                        {LEVELS.map((l) => (
                          <option key={l} value={l}>
                            {l}
                          </option>
                        ))}
                      </select>
                      <button
                        disabled={busy || tournament.status !== "DRAFT"}
                        data-testid="member-add-btn"
                        className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold hover:bg-emerald-600 disabled:opacity-40"
                      >
                        Agregar
                      </button>
                    </div>

                    {memberForm.member_type === "USER" ? (
                      <>
                        <input
                          placeholder="Buscar usuario por nombre o telefono"
                          data-testid="member-user-query-input"
                          value={userQuery}
                          onChange={(e) => setUserQuery(e.target.value)}
                          className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
                        />
                        <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                          <div className="mb-1 text-[11px] text-white/60">
                            Sugerencias (maximo 4 resultados)
                          </div>
                          {usersBusy ? (
                            <div className="text-xs text-white/50">Buscando usuarios...</div>
                          ) : userSuggestions.length === 0 ? (
                            <div className="text-xs text-white/50">
                              Sin resultados para esta busqueda.
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {userSuggestions.map((user) => (
                                <button
                                  type="button"
                                  key={user.id}
                                  data-testid={`member-suggestion-${user.id}`}
                                  onClick={() => selectSuggestion(user)}
                                  className={cn(
                                    "w-full rounded-md border px-2 py-1 text-left text-xs",
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
                        <div className="text-xs text-white/60">
                          Usuario seleccionado:{" "}
                          <code className="text-white/80">
                            {memberForm.user_id || "Ninguno"}
                          </code>
                        </div>
                      </>
                    ) : (
                      <input
                        placeholder="Nombre del invitado"
                        data-testid="member-guest-name-input"
                        value={memberForm.guest_name}
                        onChange={(e) =>
                          setMemberForm((p) => ({ ...p, guest_name: e.target.value }))
                        }
                        className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
                      />
                    )}
                  </form>

                  <div className="mt-2 space-y-2">
                    {(selectedTeam.members || []).map((m) => (
                      <div
                        key={m.id}
                        className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs"
                      >
                        <div className="font-semibold text-white">
                          {m.member_type === "USER" ? m.user_id : m.guest_name}
                        </div>
                        <div className="text-white/60">
                          {m.member_type}
                          {m.level_override ? ` - ${m.level_override}` : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="mb-2 font-semibold text-white">Partidos</div>
            <div className="mb-2 text-xs text-white/60">
              Flujo sugerido: Iniciar partido, cargar resultado y luego finalizar. Si ya finalizo, puedes editar el resultado.
            </div>
            <div className="space-y-3">
              {rounds.length === 0 ? (
                <div className="text-sm text-white/60">Aun no hay fixture generado.</div>
              ) : (
                rounds.map(([round, ms]) => (
                  <div key={round} className="rounded-lg border border-white/10 bg-black/20 p-2">
                    <div className="mb-2 text-sm font-semibold text-white">Ronda {round}</div>
                    <div className="space-y-2">
                      {ms.map((m) => {
                        const canOpenResult = m.status === "LIVE" || m.status === "FINISHED";
                        return (
                          <div
                            key={m.id}
                            data-testid={`match-card-${m.id}`}
                            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2"
                          >
                            <div className="text-sm font-semibold text-white">
                              {`${m.home.emoji ? `${m.home.emoji} ` : ""}${m.home.name} vs ${
                                m.away.emoji ? `${m.away.emoji} ` : ""
                              }${m.away.name}`}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/60">
                              <span
                                className={cn(
                                  "rounded-full border px-2 py-0.5 font-semibold",
                                  statusTone(m.status)
                                )}
                              >
                                {m.status}
                              </span>
                              <span>{`Marcador: ${m.home_goals}-${m.away_goals}`}</span>
                              <span>{`Inicio: ${fmt(m.started_at)}`}</span>
                              <span>{`Fin: ${fmt(m.ended_at)}`}</span>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <button
                                disabled={busy || m.status !== "PENDING"}
                                data-testid={`match-start-${m.id}`}
                                onClick={() =>
                                  save("Partido iniciado.", async () => {
                                    await apiFetch(
                                      `/admin/tournaments/${tournament.id}/matches/${m.id}/start`,
                                      { method: "POST" }
                                    );
                                    await loadDetail(tournament.id);
                                  })
                                }
                                className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200 disabled:opacity-40"
                              >
                                Iniciar
                              </button>

                              <button
                                disabled={busy || !canOpenResult}
                                data-testid={`match-open-result-${m.id}`}
                                onClick={() => openResultModal(m)}
                                className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-200 disabled:opacity-40"
                                title={
                                  canOpenResult
                                    ? "Cargar o editar resultado"
                                    : "Primero debes iniciar el partido"
                                }
                              >
                                {m.status === "FINISHED"
                                  ? "Editar resultado"
                                  : "Cargar resultado"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="mb-2 font-semibold text-white">Compartir</div>
            <div className="mb-2 text-xs text-white/60">
              Comparte este link publico o el QR para ver resultados en vivo.
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_220px]">
              <div className="space-y-2">
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm break-all text-white/80">
                  {link || "-"}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    disabled={!link}
                    data-testid="share-copy-link-btn"
                    onClick={() => {
                      navigator.clipboard?.writeText(link);
                      setOk("Link publico copiado.");
                    }}
                    className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black disabled:opacity-40"
                  >
                    Copiar link
                  </button>
                  <a
                    href={link || "#"}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="share-open-public-link"
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
                  >
                    Ver pagina publica
                  </a>
                  <a
                    href={link ? `${link}&tv=1` : "#"}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="share-open-tv-link"
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
                  >
                    Ver modo TV
                  </a>
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                {link ? (
                  <div className="grid place-items-center gap-2">
                    <QRCodeSVG value={link} size={180} bgColor="#0a0a0a" fgColor="#f5f5f5" />
                    <div className="text-xs text-white/60">QR publico</div>
                  </div>
                ) : (
                  <div className="text-sm text-white/60">Sin link publico disponible.</div>
                )}
              </div>
            </div>
          </div>
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
            await apiFetch(
              `/admin/tournaments/${tournament.id}/matches/${resultModal.match_id}/score`,
              {
                method: "PATCH",
                body: {
                  home_goals: Number(resultModal.home_goals || 0),
                  away_goals: Number(resultModal.away_goals || 0),
                },
              }
            );
            await loadDetail(tournament.id);
            setResultModal(null);
          })
        }
        onFinish={() =>
          save("Partido finalizado con resultado guardado.", async () => {
            await apiFetch(
              `/admin/tournaments/${tournament.id}/matches/${resultModal.match_id}/score`,
              {
                method: "PATCH",
                body: {
                  home_goals: Number(resultModal.home_goals || 0),
                  away_goals: Number(resultModal.away_goals || 0),
                },
              }
            );
            await apiFetch(
              `/admin/tournaments/${tournament.id}/matches/${resultModal.match_id}/finish`,
              { method: "POST" }
            );
            await loadDetail(tournament.id);
            setResultModal(null);
          })
        }
      />
    </div>
  );
}
