import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE = (
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  ""
).trim();

function getActorId() {
  return localStorage.getItem("actorUserId") || localStorage.getItem("actor_id") || "";
}

function cn(...xs) {
  return xs.filter(Boolean).join(" ");
}

function initials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || "?";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase();
}

async function apiFetch(path, { method = "GET", body } = {}) {
  const actor = getActorId();
  if (!actor) throw new Error("No autenticado.");

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      "X-Actor-User-Id": actor,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");

  if (!res.ok) {
    const detail = data?.detail ?? data?.message ?? data;
    throw new Error(typeof detail === "string" ? detail : `HTTP ${res.status}`);
  }
  return data;
}

function StarRating({ value, onChange, disabled }) {
  const [hover, setHover] = useState(null);

  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = (hover ?? value ?? 0) >= star;
        const half = !filled && (hover ?? value ?? 0) >= star - 0.5;

        return (
          <div key={star} className="relative cursor-pointer select-none">
            <div
              className="absolute inset-y-0 left-0 z-10 w-1/2"
              onMouseEnter={() => !disabled && setHover(star - 0.5)}
              onMouseLeave={() => setHover(null)}
              onClick={() => !disabled && onChange(star - 0.5)}
            />
            <div
              className="absolute inset-y-0 right-0 z-10 w-1/2"
              onMouseEnter={() => !disabled && setHover(star)}
              onMouseLeave={() => setHover(null)}
              onClick={() => !disabled && onChange(star)}
            />
            <span
              className={cn(
                "text-2xl transition-colors",
                filled ? "text-amber-400" : half ? "text-amber-400/50" : "text-white/20",
                disabled && "cursor-not-allowed opacity-60"
              )}
            >
              {filled ? "\u2605" : half ? "\u2BEA" : "\u2606"}
            </span>
          </div>
        );
      })}
      {(hover ?? value) ? (
        <span className="ml-2 text-sm font-semibold text-amber-300">{(hover ?? value).toFixed(1)}</span>
      ) : null}
    </div>
  );
}

function Toast({ toast, onClose }) {
  if (!toast) return null;
  const bg = toast.kind === "error" ? "bg-red-500/90" : "bg-emerald-500/90";
  return (
    <div className={cn("fixed right-4 top-4 z-50 rounded-xl px-4 py-3 text-white shadow-lg", bg)}>
      <div className="font-semibold">{toast.title}</div>
      {toast.text && <div className="text-sm opacity-90">{toast.text}</div>}
      <button onClick={onClose} className="absolute right-2 top-1 text-white/70 hover:text-white">
        X
      </button>
    </div>
  );
}

function timeRemaining(finalizedAt, votingWindowDays = 7) {
  const deadline = new Date(finalizedAt).getTime() + votingWindowDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const diff = deadline - now;
  if (diff <= 0) return null;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (days > 0) {
    const remHours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    return `${days}d ${remHours}h`;
  }
  return `${hours}h ${mins}m`;
}

function fmtMatchDate(value) {
  if (!value) return "Fecha no disponible";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("es-AR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function RatingsPending() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [pendingData, setPendingData] = useState(null);
  const [showListView, setShowListView] = useState(false);
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [isEntering, setIsEntering] = useState(false);
  const [enterFromX, setEnterFromX] = useState(0);

  const [formState, setFormState] = useState({});

  const pendingTargets = useMemo(() => {
    const items = pendingData?.items || [];
    const flattened = [];

    for (const item of items) {
      for (const target of item.targets || []) {
        if (!target.existing_vote) {
          flattened.push({
            key: `${item.event_id}:${item.court_id}:${target.user_id}`,
            event_id: item.event_id,
            event_title: item.event_title,
            event_starts_at: item.event_starts_at,
            finalized_at: item.finalized_at,
            voting_window_days: item.voting_window_days || 7,
            court_id: item.court_id,
            court_name: item.court_name,
            is_locked: item.is_locked,
            target,
          });
        }
      }
    }
    return flattened;
  }, [pendingData]);

  const currentCard =
    pendingTargets.length > 0 ? pendingTargets[Math.min(activeCardIndex, pendingTargets.length - 1)] : null;

  const loadPending = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await apiFetch("/ratings/pending");
      setPendingData(data);

      const state = {};
      for (const item of data.items || []) {
        state[item.court_id] = {};
        for (const t of item.targets || []) {
          if (t.existing_vote) {
            state[item.court_id][t.user_id] = {
              rating: t.existing_vote.rating,
              comment: t.existing_vote.comment || "",
            };
          } else {
            state[item.court_id][t.user_id] = { rating: null, comment: "" };
          }
        }
      }
      setFormState(state);
    } catch (e) {
      setToast({ kind: "error", title: "Error", text: e.message });
      if (e.message.includes("No autenticado")) navigate("/");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  useEffect(() => {
    if (pendingTargets.length === 0) {
      setActiveCardIndex(0);
      return;
    }
    if (activeCardIndex > pendingTargets.length - 1) {
      setActiveCardIndex(pendingTargets.length - 1);
    }
  }, [pendingTargets.length, activeCardIndex]);

  useEffect(() => {
    if (!isEntering) return;
    const raf = requestAnimationFrame(() => setIsEntering(false));
    return () => cancelAnimationFrame(raf);
  }, [isEntering, activeCardIndex]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  function updateRating(courtId, targetId, rating) {
    setFormState((prev) => ({
      ...prev,
      [courtId]: {
        ...prev[courtId],
        [targetId]: { ...prev[courtId]?.[targetId], rating },
      },
    }));
  }

  function updateComment(courtId, targetId, comment) {
    setFormState((prev) => ({
      ...prev,
      [courtId]: {
        ...prev[courtId],
        [targetId]: { ...prev[courtId]?.[targetId], comment },
      },
    }));
  }

  function getDraftVote(courtId, targetId) {
    return formState?.[courtId]?.[targetId] || { rating: null, comment: "" };
  }

  async function saveSingleVote(entry) {
    const vote = getDraftVote(entry.court_id, entry.target.user_id);

    if (entry.is_locked) {
      setToast({ kind: "error", title: "Ventana cerrada", text: "Esta votacion ya no acepta cambios." });
      return;
    }
    if (vote.rating == null) {
      setToast({ kind: "error", title: "Falta puntaje", text: "Elegi una puntuacion para guardar." });
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch("/ratings", {
        method: "POST",
        body: {
          event_id: entry.event_id,
          court_id: entry.court_id,
          ratings: [
            {
              target_user_id: entry.target.user_id,
              rating: vote.rating,
              comment: vote.comment?.trim() || null,
            },
          ],
        },
      });
      setToast({ kind: "success", title: "Guardado", text: `Voto guardado. Pendientes: ${res.pending_after}` });
      await loadPending({ silent: true });
    } catch (e) {
      setToast({ kind: "error", title: "Error", text: e.message });
    } finally {
      setSaving(false);
    }
  }

  function goToIndex(nextIndex) {
    if (pendingTargets.length === 0) return;
    const bounded = Math.max(0, Math.min(nextIndex, pendingTargets.length - 1));
    if (bounded === activeCardIndex) return;

    setEnterFromX(bounded > activeCardIndex ? 34 : -34);
    setActiveCardIndex(bounded);
    setIsEntering(true);
  }

  function goToNext() {
    if (pendingTargets.length <= 1) return;
    goToIndex((activeCardIndex + 1) % pendingTargets.length);
  }

  function goToPrev() {
    if (pendingTargets.length <= 1) return;
    goToIndex((activeCardIndex - 1 + pendingTargets.length) % pendingTargets.length);
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <div className="text-white/60">Cargando votos pendientes...</div>
      </div>
    );
  }

  const items = pendingData?.items || [];
  const totalPending = pendingData?.total_pending || 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 px-4 py-8">
      <Toast toast={toast} onClose={() => setToast(null)} />

      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Votos pendientes</h1>
            {pendingData && (
              <p className="mt-1 text-sm text-white/60">
                {totalPending === 0
                  ? "No tenes votos pendientes."
                  : `${totalPending} voto${totalPending !== 1 ? "s" : ""} pendiente${totalPending !== 1 ? "s" : ""}`}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <button
                onClick={() => setShowListView((v) => !v)}
                className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/20"
              >
                {showListView ? "Vista por jugador" : "Ver todas votaciones pendientes"}
              </button>
            )}
            <button
              onClick={() => navigate("/")}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
            >
              Volver
            </button>
          </div>
        </div>

        {totalPending === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
            <div className="text-4xl">OK</div>
            <div className="mt-3 text-lg font-semibold text-white">Todo al dia</div>
            <div className="mt-1 text-sm text-white/60">No tenes calificaciones pendientes.</div>
          </div>
        ) : showListView ? (
          <div className="space-y-6">
            {items.map((item) => {
              const remaining = timeRemaining(item.finalized_at, item.voting_window_days || 7);
              const pendingTargetsByCourt = (item.targets || []).filter((t) => !t.existing_vote);

              if (pendingTargetsByCourt.length === 0) return null;

              const ratedDraft = pendingTargetsByCourt.filter((t) => {
                const draft = getDraftVote(item.court_id, t.user_id);
                return draft.rating != null;
              }).length;

              return (
                <div key={item.court_id} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-base font-semibold text-white">{item.event_title}</div>
                      <div className="text-sm text-white/60">{item.court_name}</div>
                      <div className="mt-1 text-xs text-white/50">
                        Fecha del partido: {fmtMatchDate(item.event_starts_at || item.finalized_at)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {item.is_locked ? (
                        <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-300">
                          Ventana cerrada
                        </span>
                      ) : remaining ? (
                        <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-300">
                          Quedan {remaining}
                        </span>
                      ) : null}
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60">
                        {ratedDraft}/{pendingTargetsByCourt.length} listos
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {pendingTargetsByCourt.map((target) => {
                      const draft = getDraftVote(item.court_id, target.user_id);

                      return (
                        <div key={target.user_id} className="rounded-xl border border-white/10 bg-black/10 p-3">
                          <div className="flex items-center gap-3">
                            {target.avatar_url ? (
                              <img
                                src={target.avatar_url}
                                alt={target.full_name}
                                className="h-10 w-10 rounded-full object-cover"
                              />
                            ) : (
                              <div className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-sm font-bold text-white">
                                {initials(target.full_name)}
                              </div>
                            )}
                            <div>
                              <div className="text-sm font-semibold text-white">{target.nickname || target.full_name}</div>
                              {target.nickname && <div className="text-xs text-white/50">{target.full_name}</div>}
                            </div>
                          </div>

                          <div className="mt-3">
                            <StarRating
                              value={draft.rating}
                              onChange={(v) => updateRating(item.court_id, target.user_id, v)}
                              disabled={item.is_locked || saving}
                            />
                          </div>

                          <textarea
                            value={draft.comment || ""}
                            onChange={(e) => updateComment(item.court_id, target.user_id, e.target.value)}
                            disabled={item.is_locked || saving}
                            placeholder="Comentario opcional..."
                            maxLength={500}
                            rows={2}
                            className={cn(
                              "mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white",
                              "placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/20",
                              "disabled:cursor-not-allowed disabled:opacity-50"
                            )}
                          />

                          {!item.is_locked && (
                            <button
                              onClick={() =>
                                saveSingleVote({
                                  event_id: item.event_id,
                                  court_id: item.court_id,
                                  target,
                                  is_locked: item.is_locked,
                                })
                              }
                              disabled={saving || draft.rating == null}
                              className={cn(
                                "mt-3 w-full rounded-xl bg-white py-2 text-sm font-semibold text-black",
                                "hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
                              )}
                            >
                              {saving ? "Guardando..." : "Guardar voto"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          currentCard && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-base font-semibold text-white">{currentCard.event_title}</div>
                  <div className="text-sm text-white/60">{currentCard.court_name}</div>
                  <div className="mt-1 text-xs text-white/50">
                    Fecha del partido: {fmtMatchDate(currentCard.event_starts_at || currentCard.finalized_at)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {currentCard.is_locked ? (
                    <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-300">
                      Ventana cerrada
                    </span>
                  ) : (
                    <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-300">
                      Quedan {timeRemaining(currentCard.finalized_at, currentCard.voting_window_days || 7) || "menos de 1h"}
                    </span>
                  )}
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60">
                    {activeCardIndex + 1}/{pendingTargets.length}
                  </span>
                </div>
              </div>

              <div
                className="mt-4 rounded-xl border border-white/10 bg-black/10 p-4 transition-all duration-300"
                style={{
                  opacity: isEntering ? 0 : 1,
                  transform: isEntering ? `translateX(${enterFromX}px)` : "translateX(0px)",
                }}
              >
                <div className="flex items-center gap-3">
                  {currentCard.target.avatar_url ? (
                    <img
                      src={currentCard.target.avatar_url}
                      alt={currentCard.target.full_name}
                      className="h-12 w-12 rounded-full object-cover"
                    />
                  ) : (
                    <div className="grid h-12 w-12 place-items-center rounded-full bg-white/10 text-sm font-bold text-white">
                      {initials(currentCard.target.full_name)}
                    </div>
                  )}
                  <div>
                    <div className="text-lg font-semibold text-white">
                      {currentCard.target.nickname || currentCard.target.full_name}
                    </div>
                    {currentCard.target.nickname && (
                      <div className="text-sm text-white/50">{currentCard.target.full_name}</div>
                    )}
                  </div>
                </div>

                <div className="mt-4">
                  <StarRating
                    value={getDraftVote(currentCard.court_id, currentCard.target.user_id).rating}
                    onChange={(v) => updateRating(currentCard.court_id, currentCard.target.user_id, v)}
                    disabled={currentCard.is_locked || saving}
                  />
                </div>

                <textarea
                  value={getDraftVote(currentCard.court_id, currentCard.target.user_id).comment || ""}
                  onChange={(e) => updateComment(currentCard.court_id, currentCard.target.user_id, e.target.value)}
                  disabled={currentCard.is_locked || saving}
                  placeholder="Comentario opcional..."
                  maxLength={500}
                  rows={3}
                  className={cn(
                    "mt-3 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white",
                    "placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/20",
                    "disabled:cursor-not-allowed disabled:opacity-50"
                  )}
                />
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <button
                  onClick={goToPrev}
                  disabled={saving || pendingTargets.length <= 1}
                  className={cn(
                    "rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white",
                    "hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                  )}
                >
                  Anterior
                </button>
                <button
                  onClick={goToNext}
                  disabled={saving || pendingTargets.length <= 1}
                  className={cn(
                    "rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white",
                    "hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                  )}
                >
                  Siguiente
                </button>
                {!currentCard.is_locked ? (
                  <button
                    onClick={() => saveSingleVote(currentCard)}
                    disabled={saving || getDraftVote(currentCard.court_id, currentCard.target.user_id).rating == null}
                    className={cn(
                      "rounded-xl bg-white px-3 py-2 text-sm font-semibold text-black",
                      "hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
                    )}
                  >
                    {saving ? "Guardando..." : "Guardar voto"}
                  </button>
                ) : (
                  <button
                    disabled
                    className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-300 opacity-70"
                  >
                    Bloqueado
                  </button>
                )}
              </div>
            </div>
          )
        )}

        {!showListView && pendingTargets.length > 0 && (
          <div className="mt-3 text-center text-xs text-white/50">
            Tip: usa "Ver todas votaciones pendientes" para abrir el listado completo.
          </div>
        )}

        {!showListView && pendingTargets.length === 0 && totalPending > 0 && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
            Hay votos pendientes, pero la ventana de votacion puede estar cerrada.
          </div>
        )}
      </div>
    </div>
  );
}
