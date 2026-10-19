// Pantalla del partido /p/:id (rediseño UX 1a, §5.3 flujo b). Es lo que abre el
// link de WhatsApp y la pestaña Partido.
// - "Me anoto" en un toque: el servidor asigna la cancha (o la espera) y el toast
//   trae "Deshacer". Tocar "Libre" en una cancha elige esa cancha.
// - "No puedo ir" pregunta quién toma el lugar; a menos de 24 h, avisa al grupo.
// - Compartir, Invitar y la baja viven en ?sheet= (el atrás de Android los cierra).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { cn } from "../../design/cn.js";
import { Menu, toast, useSheetParam } from "../../design/ui/overlay/index.js";
import { usePullToRefresh } from "../../design/usePullToRefresh.js";
import { canAccessAdmin } from "../../permissions/can.js";
import ActionBar from "../../shell/ActionBar.jsx";
import {
  addGuest,
  cancelRegistration,
  errorMessage,
  getMatch,
  getNotifications,
  getOpenEvents,
  register,
} from "./api.js";
import { courtPhrase, ordinal, spotsLeftSentence } from "./format.js";
import {
  canManage,
  canRemove,
  countedCourts,
  firstFreeCourt,
  firstName,
  isLate,
  matchPhase,
  myGuests,
  myState,
  summarize,
  takerLabel,
  whoTakesSpot,
} from "./matchLogic.js";
import { lateDropMessage, matchUrl, shareMessage, whatsAppHref } from "./messages.js";
import { CourtFullDialog, GuestSheet, LeaveDialog, RemoveDialog, ShareSheet } from "./MatchOverlays.jsx";
import { CourtCard, MatchHero, MatchTopBar, PromotionBanner, WaitlistSection } from "./MatchParts.jsx";
import { parseTs } from "./pickNextEvent.js";
import { MatchNotFound, MatchSkeleton } from "./MatchStates.jsx";
import { useMatchScreen } from "./useMatchScreen.js";

const BTN_PRIMARY =
  "focus-ring inline-flex min-h-[52px] w-full flex-col items-center justify-center rounded-2xl bg-emerald-500 px-4 text-base font-semibold leading-tight text-black hover:bg-emerald-400 disabled:opacity-60";
const BTN_SECONDARY =
  "focus-ring inline-flex min-h-[48px] w-full items-center justify-center rounded-2xl border border-white/15 bg-white/10 px-4 text-base font-semibold text-white hover:bg-white/15 disabled:opacity-60";

const PROMO_KEY = "match:promo-seen";

function promoSeen(key) {
  try {
    return localStorage.getItem(PROMO_KEY) === key;
  } catch {
    return false;
  }
}

function markPromoSeen(key) {
  try {
    localStorage.setItem(PROMO_KEY, key);
  } catch {
    /* sin storage: el banner vuelve a aparecer, no pasa nada */
  }
}

/** Abre WhatsApp. Devuelve false si el navegador frenó la ventana (iOS después de un await). */
function openWhatsApp(href) {
  const w = window.open(href, "_blank");
  if (!w) return false;
  try {
    w.opener = null;
  } catch {
    /* ignore */
  }
  return true;
}

export default function MatchPage({ eventId }) {
  const navigate = useNavigate();
  const { config, permissions } = useMatchScreen();
  const sheets = useSheetParam();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [openEvents, setOpenEvents] = useState([]);
  const [pendingVotes, setPendingVotes] = useState(0);
  const [busy, setBusy] = useState("");
  const [courtFull, setCourtFull] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [leaveDoneHref, setLeaveDoneHref] = useState("");
  const [menu, setMenu] = useState(null); // {kind: "match"} | {kind: "player", player, court}
  const [, setPromoTick] = useState(0);
  const menuRef = useRef(null);
  const playerAnchorRef = useRef(null);
  const loadSeq = useRef(0);

  const oneTap = Boolean(config.oneTapRegisterEnabled);
  const isManager = canManage(permissions);

  const load = useCallback(async () => {
    const n = ++loadSeq.current;
    try {
      const d = await getMatch(eventId);
      if (n !== loadSeq.current) return;
      setData(d);
      setLoadError("");
    } catch (e) {
      if (n === loadSeq.current) setLoadError(errorMessage(e));
    }
  }, [eventId]);

  useEffect(() => {
    load();
    getOpenEvents()
      .then((events) => setOpenEvents(events))
      .catch(() => {});
  }, [load]);

  // Volver a la app (después de WhatsApp, por ejemplo) trae el estado nuevo.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const event = data?.event || null;
  const courts = useMemo(() => data?.courts || [], [data]);
  const waitlist = data?.waitlist || [];
  const viewerId = data?.viewer?.user_id;
  const summary = useMemo(() => summarize(courts), [courts]);
  const phase = matchPhase(event, summary);
  const mine = myState(data);
  const late = event ? isLate(event.starts_at) : false;
  const link = matchUrl(eventId);

  useEffect(() => {
    if (phase !== "played" || mine.kind !== "confirmed") return;
    getNotifications()
      .then((r) => setPendingVotes(r?.pending_ratings_count || 0))
      .catch(() => {});
  }, [phase, mine.kind]);

  // Chips de fecha: los partidos que vienen (desde hace 3 h), como mucho 4.
  const upcoming = useMemo(() => {
    const cutoff = Date.now() - 3 * 60 * 60 * 1000;
    return openEvents
      .map((e) => ({ e, t: parseTs(e.starts_at) }))
      .filter((x) => x.t !== null && x.t >= cutoff)
      .sort((a, b) => a.t - b.t)
      .slice(0, 4)
      .map((x) => x.e);
  }, [openEvents]);

  const { pullY, handlers: pullHandlers } = usePullToRefresh(load);

  // Cerrada la baja por cualquier camino (también el atrás), el paso "Listo" no vuelve con el adelante.
  const leaveSheetOpen = sheets.isOpen("baja");
  useEffect(() => {
    if (!leaveSheetOpen) setLeaveDoneHref("");
  }, [leaveSheetOpen]);

  // ---------- Acciones ----------

  function announceRegistered(r) {
    const undo = { label: "Deshacer", onClick: () => undoRegistration(r.registration_id, "Listo: no quedaste anotado.") };
    if (r.status === "WAITLIST") {
      toast({ kind: "info", title: `Te anotamos en espera (puesto ${r.waitlist_position}).`, action: undo });
    } else {
      toast({ kind: "success", title: `¡Adentro! Estás en ${courtPhrase(r.court_name)}.`, action: undo });
    }
  }

  async function undoRegistration(registrationId, doneText) {
    try {
      await cancelRegistration(registrationId, "undo");
      toast({ title: doneText });
    } catch (e) {
      toast({ kind: "error", title: errorMessage(e) });
    }
    load();
  }

  async function doRegister(body, { retryAlternative = false } = {}) {
    setBusy("register");
    try {
      const r = await register(eventId, body);
      announceRegistered(r);
    } catch (e) {
      if (e.status === 409 && e.detail?.code === "COURT_FULL") {
        const alternative = (e.detail.alternatives || []).find((a) => !a.is_pseudo) || null;
        if (retryAlternative && alternative) {
          return await doRegister({ court_id: alternative.court_id, if_full: "conflict" });
        }
        setCourtFull({ courtName: e.detail.court_name, alternative });
      } else if (e.status === 409) {
        toast({ kind: "info", title: e.message });
      } else {
        toast({ kind: "error", title: errorMessage(e) });
      }
    } finally {
      setBusy("");
    }
    return load();
  }

  // "Me anoto" y "Anotarme en espera". Con ONE_TAP apagado, la cancha la elige el cliente.
  function meAnoto() {
    if (oneTap) return doRegister({});
    const court = firstFreeCourt(courts);
    if (court) return doRegister({ court_id: court.court_id, if_full: "conflict" }, { retryAlternative: true });
    const anyOpen = countedCourts(courts).find((c) => c.is_open);
    if (anyOpen) return doRegister({ court_id: anyOpen.court_id, if_full: "waitlist" });
    return undefined;
  }

  function pickSlot(court) {
    return doRegister({ court_id: court.court_id, if_full: "conflict" });
  }

  async function acceptAlternative() {
    const alt = courtFull?.alternative;
    setCourtFull(null);
    if (alt) await doRegister({ court_id: alt.court_id, if_full: "conflict" });
  }

  async function joinWaitlistFromDialog() {
    setCourtFull(null);
    await meAnoto();
  }

  function openLeave() {
    setLeaveDoneHref("");
    sheets.open("baja");
  }

  async function confirmLeave() {
    if (leaveDoneHref) {
      openWhatsApp(leaveDoneHref);
      setLeaveDoneHref("");
      sheets.close();
      return;
    }
    if (mine.kind !== "confirmed") return;
    setBusy("leave");
    try {
      const r = await cancelRegistration(mine.registrationId, late ? "notify_group" : undefined);
      const takerName = r?.promoted ? takerLabel(r.promoted) || "alguien" : "";
      if (late) {
        // Lo más cerca posible del toque: después de un await, iOS puede frenar la ventana.
        const href = whatsAppHref(lateDropMessage(event, link, takerName));
        if (openWhatsApp(href)) {
          sheets.close();
          toast({ title: takerName ? `Liberaste tu lugar. Lo toma ${takerName}.` : "Liberaste tu lugar." });
        } else {
          setLeaveDoneHref(href);
        }
      } else {
        sheets.close();
        toast({ title: takerName ? `Liberaste tu lugar. Lo toma ${takerName}.` : "Liberaste tu lugar." });
      }
    } catch (e) {
      toast({ kind: "error", title: errorMessage(e) });
    } finally {
      setBusy("");
    }
    load();
  }

  async function leaveWaitlist() {
    if (mine.kind !== "waitlist") return;
    setBusy("leave");
    try {
      await cancelRegistration(mine.registrationId);
      toast({ title: "Saliste de la lista de espera." });
    } catch (e) {
      toast({ kind: "error", title: errorMessage(e) });
    } finally {
      setBusy("");
    }
    load();
  }

  async function confirmRemove() {
    const target = removeTarget;
    if (!target) return;
    setBusy("remove");
    try {
      const r = await cancelRegistration(target.player.registration_id);
      const name = firstName(target.player.name);
      const taker = r?.promoted ? takerLabel(r.promoted) || "alguien" : "";
      toast({ title: taker ? `Sacaste a ${name}. Lo toma ${taker}.` : `Sacaste a ${name}.` });
      setRemoveTarget(null);
    } catch (e) {
      toast({ kind: "error", title: errorMessage(e) });
    } finally {
      setBusy("");
    }
    load();
  }

  async function submitGuest(name) {
    setBusy("guest");
    try {
      let body = { guest_name: name };
      if (!oneTap) {
        const mineCourt = mine.kind === "confirmed" && mine.court?.is_open && mine.court.available > 0 ? mine.court : null;
        const court = mineCourt || firstFreeCourt(courts);
        if (!court) {
          toast({ kind: "error", title: "El partido está completo: no quedan lugares para invitados." });
          return false;
        }
        body = { ...body, court_id: court.court_id };
      }
      const r = await addGuest(eventId, body);
      toast({
        kind: "success",
        title: `Sumaste a ${firstName(name)} en ${courtPhrase(r.court_name)}.`,
        action: {
          label: "Deshacer",
          onClick: () => undoRegistration(r.registration_id, `Listo: sacamos a ${firstName(name)}.`),
        },
      });
      return true;
    } catch (e) {
      toast({ kind: "error", title: errorMessage(e) });
      return false;
    } finally {
      setBusy("");
      load();
    }
  }

  // ---------- Render ----------

  if (!data && !loadError) return <MatchSkeleton />;
  if (data && !event) return <MatchNotFound />;
  if (!data) {
    return (
      <div className="min-h-screen bg-zinc-950 px-4 pt-10 text-white">
        <div className="mx-auto max-w-lg" role="alert">
          <p className="text-lg font-semibold">{loadError}</p>
          <button type="button" onClick={load} className={cn(BTN_SECONDARY, "mt-4 w-auto px-5")}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const isOpen = event.status === "OPEN";
  const canRegister = isOpen && mine.kind === "none";
  const guestLimit = Number(config.guestLimitPerUser) || 5;
  const guests = myGuests(data);
  const guestsLeft = Math.max(0, guestLimit - guests.length);
  const canAddGuest = isOpen && summary.free > 0 && (isManager || guestsLeft > 0);
  const guestLimitText = isManager
    ? "Sin tope de invitados. Va a tu cancha o a la primera con lugar."
    : `Te quedan ${guestsLeft} de ${guestLimit}. Va a tu cancha o a la primera con lugar.`;
  const guestClosedReason = !isOpen
    ? "La inscripción está cerrada."
    : summary.free === 0
      ? "El partido está completo: no quedan lugares para invitados."
      : !isManager && guestsLeft === 0
        ? `Llegaste al máximo de ${guestLimit} invitados para este partido.`
        : "";

  const promoKey = mine.kind === "confirmed" && mine.promotedAt ? `${mine.registrationId}:${mine.promotedAt}` : "";
  const showPromo = Boolean(promoKey) && !promoSeen(promoKey);
  const leaveTaker = mine.kind === "confirmed" ? whoTakesSpot(data, mine.court, mine.registrationId) : null;
  const removeTaker = removeTarget?.court ? whoTakesSpot(data, removeTarget.court, removeTarget.player.registration_id) : null;
  const canRemovePlayer = (court) => (player) => canRemove(player, court, data, permissions);

  const matchMenuItems = [
    { label: "Compartir", onSelect: () => sheets.open("compartir"), testId: "menu-share" },
    ...(isOpen ? [{ label: "Sumar invitado", onSelect: () => sheets.open("invitar"), testId: "menu-guest" }] : []),
    { label: "Ver en el calendario", onSelect: () => navigate("/calendar"), testId: "menu-calendar" },
    ...(isManager || (data.viewer?.captain_court_ids || []).length || data.viewer?.is_event_captain
      ? [
          {
            label: "Vista clásica",
            hint: "Para mover jugadores entre canchas",
            onSelect: () => navigate(`/?event_id=${eventId}&vista=clasica`),
            testId: "menu-classic",
          },
        ]
      : []),
    ...(canAccessAdmin(permissions)
      ? [{ label: "Abrir en Gestión", onSelect: () => navigate(`/admin?event_id=${eventId}`), testId: "menu-admin" }]
      : []),
  ];

  const playerMenuItems =
    menu?.kind === "player"
      ? [
          {
            label: menu.court ? "Quitar del partido" : "Sacar de la espera",
            tone: "danger",
            onSelect: () => setRemoveTarget({ player: menu.player, court: menu.court }),
            testId: "menu-remove-player",
          },
        ]
      : [];

  return (
    <div
      className="page-enter min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-black text-white"
      data-testid="match-page"
      {...pullHandlers}
    >
      <MatchTopBar
        event={event}
        otherEvents={upcoming.some((e) => e.id === event.id) ? upcoming : []}
        menuRef={menuRef}
        menuOpen={menu?.kind === "match"}
        onMenu={() => setMenu({ kind: "match" })}
      />

      <main
        className="mx-auto max-w-lg space-y-4 px-4 pt-4"
        style={{ paddingBottom: "calc(var(--actionbar-h, 0px) + 1.25rem)" }}
      >
        {pullY > 0 ? (
          <p className="text-center text-xs text-white/50" style={{ height: pullY }} aria-hidden="true">
            {pullY >= 60 ? "Soltá para actualizar" : "Tirá para actualizar"}
          </p>
        ) : null}
        {loadError ? (
          <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
            {loadError}
          </p>
        ) : null}
        {showPromo ? (
          <PromotionBanner
            court={mine.court}
            event={event}
            onDismiss={() => {
              markPromoSeen(promoKey);
              setPromoTick((n) => n + 1);
            }}
          />
        ) : null}

        <MatchHero
          event={event}
          summary={summary}
          phase={phase}
          waitCount={waitlist.length}
          showShare={isManager && (phase === "open" || phase === "full")}
          onShare={() => sheets.open("compartir")}
        />

        {courts.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/65">
            Todavía no hay canchas en este partido.
          </p>
        ) : null}

        {courts.map((court) => (
          <CourtCard
            key={court.court_id}
            court={court}
            viewerId={viewerId}
            isMine={mine.kind === "confirmed" && mine.court?.court_id === court.court_id}
            canRegister={canRegister}
            busy={busy === "register"}
            onPickSlot={pickSlot}
            onPlayer={(player, c, anchor) => {
              playerAnchorRef.current = anchor;
              setMenu({ kind: "player", player, court: c });
            }}
            canRemovePlayer={canRemovePlayer(court)}
          />
        ))}

        <WaitlistSection
          waitlist={waitlist}
          viewerId={viewerId}
          onPlayer={(player, c, anchor) => {
            playerAnchorRef.current = anchor;
            setMenu({ kind: "player", player, court: null });
          }}
          canRemovePlayer={canRemovePlayer(null)}
        />
      </main>

      <MatchActionBar
        phase={phase}
        isOpen={isOpen}
        mine={mine}
        summary={summary}
        busy={busy}
        pendingVotes={pendingVotes}
        onRegister={meAnoto}
        onLeave={openLeave}
        onLeaveWaitlist={leaveWaitlist}
        onGuest={() => sheets.open("invitar")}
      />

      <Menu
        open={menu?.kind === "match"}
        onClose={() => setMenu(null)}
        anchorRef={menuRef}
        title={event.title}
        items={matchMenuItems}
        testId="match-menu"
      />
      <Menu
        open={menu?.kind === "player"}
        onClose={() => setMenu(null)}
        anchorRef={playerAnchorRef}
        title={menu?.kind === "player" ? firstName(menu.player.name) : ""}
        items={playerMenuItems}
        testId="player-menu"
      />

      <ShareSheet
        open={sheets.isOpen("compartir")}
        onClose={sheets.close}
        history={sheets.history}
        link={link}
        message={shareMessage(event, courts, link)}
      />
      <GuestSheet
        open={sheets.isOpen("invitar")}
        onClose={sheets.close}
        history={sheets.history}
        canAdd={canAddGuest}
        closedReason={guestClosedReason}
        limitText={guestLimitText}
        guests={guests}
        busy={busy === "guest"}
        onAdd={submitGuest}
        onRemove={(g) => setRemoveTarget({ player: g, court: g.court || null })}
      />
      <LeaveDialog
        open={sheets.isOpen("baja") && (mine.kind === "confirmed" || Boolean(leaveDoneHref))}
        history={sheets.history}
        late={late}
        taker={leaveTaker ? takerLabel(leaveTaker) : ""}
        busy={busy === "leave"}
        doneHref={leaveDoneHref}
        onConfirm={confirmLeave}
        onCancel={() => {
          setLeaveDoneHref("");
          sheets.close();
        }}
      />
      <CourtFullDialog
        state={courtFull}
        busy={busy === "register"}
        onAccept={acceptAlternative}
        onWaitlist={joinWaitlistFromDialog}
        onCancel={() => setCourtFull(null)}
      />
      <RemoveDialog
        target={removeTarget}
        taker={removeTaker ? takerLabel(removeTaker) : ""}
        busy={busy === "remove"}
        onConfirm={confirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}

function MatchActionBar({ phase, isOpen, mine, summary, busy, pendingVotes, onRegister, onLeave, onLeaveWaitlist, onGuest }) {
  let content = null;
  if (mine.kind === "confirmed" && phase !== "played") {
    content = (
      <div className="space-y-2.5">
        <p className="text-base font-semibold" data-testid="match-my-status">
          Estás en {mine.court ? courtPhrase(mine.court.name) : "el partido"}
        </p>
        <div className={cn("grid gap-2.5", isOpen ? "grid-cols-2" : "grid-cols-1")}>
          {isOpen ? (
            <button type="button" onClick={onGuest} className={BTN_SECONDARY} data-testid="match-guest-btn">
              + Invitado
            </button>
          ) : null}
          <button type="button" onClick={onLeave} disabled={busy === "leave"} className={BTN_SECONDARY} data-testid="match-leave-btn">
            No puedo ir
          </button>
        </div>
      </div>
    );
  } else if (mine.kind === "waitlist" && phase !== "played") {
    content = (
      <div className="space-y-2.5">
        <div data-testid="match-my-status">
          <p className="text-base font-semibold">Sos el {ordinal(mine.position || 1)} en la lista de espera.</p>
          <p className="text-sm text-white/60">Si se libera un lugar, entrás solo y te avisamos.</p>
        </div>
        <button
          type="button"
          onClick={onLeaveWaitlist}
          disabled={busy === "leave"}
          className={BTN_SECONDARY}
          data-testid="match-leave-waitlist-btn"
        >
          Salir de la espera
        </button>
      </div>
    );
  } else if (phase === "open") {
    content = (
      <button type="button" onClick={onRegister} disabled={busy === "register"} className={BTN_PRIMARY} data-testid="match-register-btn">
        <span>{busy === "register" ? "Anotando…" : "Me anoto"}</span>
        <small className="text-xs font-medium opacity-80">{spotsLeftSentence(summary.free)}</small>
      </button>
    );
  } else if (phase === "full") {
    content = (
      <div className="space-y-2.5">
        <div>
          <p className="text-base font-semibold">
            Partido completo ({summary.occupied}/{summary.capacity}).
          </p>
          <p className="text-sm text-white/60">Si alguien se baja, entra el primero de la espera.</p>
        </div>
        <button
          type="button"
          onClick={onRegister}
          disabled={busy === "register"}
          className="focus-ring inline-flex min-h-[48px] w-full items-center justify-center rounded-2xl bg-amber-400 px-4 text-base font-semibold text-zinc-950 hover:bg-amber-300 disabled:opacity-60"
          data-testid="match-waitlist-btn"
        >
          {busy === "register" ? "Anotando…" : "Anotarme en espera"}
        </button>
      </div>
    );
  } else if (phase === "closed") {
    content = <p className="py-1 text-center text-base font-semibold text-white/75">Inscripción cerrada</p>;
  } else if (phase === "played" && mine.kind === "confirmed" && pendingVotes > 0) {
    content = (
      <Link to="/ratings/pending-ui" className={BTN_PRIMARY} data-testid="match-vote-btn">
        Votar a tus compañeros
      </Link>
    );
  }
  if (!content) return null;
  return <ActionBar testId="match-action-bar">{content}</ActionBar>;
}
