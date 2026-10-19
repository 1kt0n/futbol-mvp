// Piezas de la pantalla del partido: barra superior, hero, canchas, espera y el
// banner de promoción. Sin lógica de datos: todo llega por props desde MatchPage.

import { Link } from "react-router-dom";
import { cn } from "../../design/cn.js";
import { clock, hourLabel, longDay, shortDate, spotsLeftSentence, topTitle } from "./format.js";
import { displayName, firstName } from "./matchLogic.js";

export function MatchTopBar({ event, otherEvents, menuRef, menuOpen, onMenu }) {
  return (
    <header
      className="sticky top-0 z-sticky border-b border-white/10 bg-zinc-950/95 backdrop-blur"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="mx-auto max-w-lg px-4">
        <div className="flex min-h-[52px] items-center gap-2">
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold" data-testid="match-title">
            {event ? topTitle(event.starts_at) : "Partido"}
          </h1>
          <button
            ref={menuRef}
            type="button"
            onClick={onMenu}
            aria-label="Más opciones"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            data-testid="match-menu-btn"
            className="focus-ring -mr-2 grid h-11 w-11 place-items-center rounded-xl text-white/80 hover:bg-white/10"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6" fill="currentColor">
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>
        </div>
        {otherEvents.length > 1 ? (
          <nav aria-label="Próximos partidos" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2.5">
            {otherEvents.map((e) => {
              const current = e.id === event?.id;
              return (
                <Link
                  key={e.id}
                  to={`/p/${e.id}`}
                  replace
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "focus-ring inline-flex min-h-[36px] shrink-0 items-center rounded-full border px-3.5 text-sm font-medium",
                    current ? "border-transparent bg-white text-zinc-950" : "border-white/15 bg-white/5 text-white/80"
                  )}
                >
                  {shortDate(e.starts_at)} · {hourLabel(e.starts_at)}
                </Link>
              );
            })}
          </nav>
        ) : null}
      </div>
    </header>
  );
}

const PHASE_CHIP = {
  open: ["Abierto", "bg-emerald-500/15 text-emerald-300"],
  full: ["Completo", "bg-amber-500/15 text-amber-300"],
  closed: ["Inscripción cerrada", "bg-white/10 text-white/70"],
  played: ["Jugado", "bg-sky-500/15 text-sky-300"],
  empty: ["Armándose", "bg-white/10 text-white/70"],
  other: ["Cerrado", "bg-white/10 text-white/70"],
};

export function MatchHero({ event, summary, phase, waitCount, showShare, onShare }) {
  const [label, tone] = PHASE_CHIP[phase] || PHASE_CHIP.other;
  const pct = summary.capacity ? Math.min(100, Math.round((summary.occupied / summary.capacity) * 100)) : 0;
  let count;
  if (phase === "open") count = `${summary.occupied}/${summary.capacity} · ${spotsLeftSentence(summary.free)}`;
  else if (phase === "full") count = `${summary.occupied}/${summary.capacity} · ${waitCount ? `${waitCount} en espera` : "Sin lugares"}`;
  else count = `${summary.occupied}/${summary.capacity}`;

  return (
    <section className="space-y-1" aria-labelledby="match-hero-title">
      <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold", tone)} data-testid="match-phase">
        {label}
      </span>
      <h2 id="match-hero-title" className="pt-1 text-2xl font-bold leading-tight">
        {event.title}
      </h2>
      <p className="text-sm text-white/60">
        {[event.location_name, shortDate(event.starts_at), clock(event.starts_at)].filter(Boolean).join(" · ")}
      </p>
      {phase !== "empty" ? (
        <p className="pt-2 text-base tabular-nums" data-testid="match-hero-count">
          <b className="font-semibold">{count}</b>
        </p>
      ) : null}
      {phase === "open" || phase === "full" ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      {showShare ? (
        <div className="pt-3">
          <button
            type="button"
            onClick={onShare}
            data-testid="match-share-chip"
            className="focus-ring inline-flex min-h-[40px] items-center rounded-full border border-white/15 bg-white/10 px-4 text-sm font-semibold hover:bg-white/15"
          >
            {summary.free > 0 ? `Compartir · Faltan ${summary.free}` : "Compartir"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function PromotionBanner({ court, event, onDismiss }) {
  return (
    <div
      role="status"
      data-testid="match-promo-banner"
      className="flex items-start gap-3 rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-50"
    >
      <div className="min-w-0 flex-1">
        <b className="block text-base text-white">¡Se liberó un lugar y entraste!</b>
        {court ? `${court.name} · ${longDay(event.starts_at)} ${hourLabel(event.starts_at)}.` : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Cerrar aviso"
        className="focus-ring -mr-2 -mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-full text-xl text-white/70 hover:bg-white/10"
      >
        ×
      </button>
    </div>
  );
}

function PlayerTile({ player, isMe, mineGuest, onTap }) {
  const label = isMe ? "Vos" : player.type === "GUEST" ? firstName(player.name) || "Invitado" : displayName(player.name);
  const sub =
    player.type === "GUEST"
      ? `invitado de ${mineGuest ? "vos" : firstName(player.created_by_name) || "alguien"}`
      : player.type === "EXTERNAL"
        ? "sin cuenta"
        : null;
  const className = cn(
    "flex min-h-[44px] min-w-0 flex-col justify-center rounded-xl px-3 py-1.5 text-left text-sm",
    isMe ? "bg-emerald-500/10 ring-1 ring-inset ring-emerald-400" : "bg-white/5"
  );
  const content = (
    <>
      <span className="truncate">{label}</span>
      {sub ? <small className="truncate text-xs text-white/55">{sub}</small> : null}
    </>
  );
  if (!onTap) return <div className={className}>{content}</div>;
  return (
    <button
      type="button"
      onClick={(e) => onTap(e.currentTarget)}
      aria-haspopup="menu"
      aria-label={`${label}: opciones`}
      className={cn(className, "focus-ring hover:bg-white/10")}
    >
      {content}
    </button>
  );
}

export function CourtCard({ court, viewerId, isMine, canRegister, busy, onPickSlot, onPlayer, canRemovePlayer }) {
  const free = Math.max(0, court.capacity - court.occupied);
  const showSlot = court.is_open && free > 0;
  return (
    <article
      className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3"
      data-testid={`match-court-${court.court_id}`}
      aria-label={court.name}
    >
      <div className="flex items-center gap-2">
        <b className="text-base">{court.name}</b>
        <span className="text-sm tabular-nums text-white/55">
          {court.occupied}/{court.capacity}
        </span>
        {isMine ? (
          <span className="ml-auto rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300">Tu cancha</span>
        ) : !court.is_open ? (
          <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold text-white/60">Cerrada</span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {court.players.map((p) => (
          <PlayerTile
            key={p.registration_id}
            player={p}
            isMe={p.type === "USER" && p.user_id === viewerId}
            mineGuest={p.type === "GUEST" && p.created_by_user_id === viewerId}
            onTap={canRemovePlayer(p) ? (anchor) => onPlayer(p, court, anchor) : null}
          />
        ))}
        {showSlot && canRegister ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onPickSlot(court)}
            data-testid={`match-slot-${court.court_id}`}
            className="focus-ring flex min-h-[44px] items-center justify-center rounded-xl border-[1.5px] border-dashed border-emerald-400/50 px-1.5 text-center text-[13px] font-medium leading-tight text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
          >
            Libre · Anotarme acá
          </button>
        ) : null}
        {showSlot && (!canRegister || free > 1) ? (
          <div className="flex min-h-[44px] items-center justify-center rounded-xl border-[1.5px] border-dashed border-white/15 px-2 text-center text-sm text-white/55">
            {canRegister ? `+${free - 1} ${free - 1 === 1 ? "libre" : "libres"}` : free === 1 ? "Libre" : `${free} libres`}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function WaitlistSection({ waitlist, viewerId, onPlayer, canRemovePlayer }) {
  if (!waitlist.length) return null;
  return (
    <section className="space-y-2" aria-labelledby="match-waitlist-title" data-testid="match-waitlist">
      <h3 id="match-waitlist-title" className="text-sm font-semibold text-white/80">
        En espera ({waitlist.length})
      </h3>
      <ol className="space-y-1">
        {waitlist.map((w, i) => {
          const isMe = w.type === "USER" && w.user_id === viewerId;
          const label = isMe ? "Vos" : w.type === "GUEST" ? `${firstName(w.name)} (invitado)` : displayName(w.name);
          const row = (
            <>
              <span className="w-7 shrink-0 tabular-nums text-white/50">{i + 1}.</span>
              <span className={cn("truncate", isMe && "font-semibold text-white")}>{label}</span>
            </>
          );
          const removable = canRemovePlayer(w);
          return (
            <li key={w.registration_id}>
              {removable ? (
                <button
                  type="button"
                  onClick={(e) => onPlayer(w, null, e.currentTarget)}
                  aria-haspopup="menu"
                  className="focus-ring flex min-h-[40px] w-full items-center rounded-xl px-2 text-left text-sm text-white/70 hover:bg-white/5"
                >
                  {row}
                </button>
              ) : (
                <div className="flex min-h-[40px] items-center px-2 text-sm text-white/70">{row}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
