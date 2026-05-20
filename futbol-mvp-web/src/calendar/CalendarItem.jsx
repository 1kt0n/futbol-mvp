import { cn, fmtTime } from "./api.js";

const TYPE_ICON = {
  event: "⚽",          // soccer ball
  tournament_match: "\u{1F3C6}", // trophy
  announcement: "\u{1F4E2}",     // megaphone
};

const TYPE_TINT = {
  event: "border-emerald-400/30 bg-emerald-500/10",
  tournament_match: "border-amber-400/30 bg-amber-500/10",
  announcement: "border-sky-400/30 bg-sky-500/10",
};

function ItemBadge({ tone = "default", children }) {
  const tones = {
    default: "bg-white/10 text-white/70 border-white/15",
    success: "bg-emerald-400/20 text-emerald-200 border-emerald-400/30",
    warn: "bg-amber-400/20 text-amber-200 border-amber-400/30",
    danger: "bg-rose-400/20 text-rose-200 border-rose-400/30",
    info: "bg-sky-400/20 text-sky-200 border-sky-400/30",
  };
  return (
    <span className={cn(
      "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
      tones[tone] || tones.default,
    )}>
      {children}
    </span>
  );
}

function badgesFor(item) {
  const out = [];
  if (item.type === "event") {
    const role = item.participation?.role;
    const regStatus = item.participation?.registration_status;
    const counts = item.counts || {};
    const full = counts.capacity_total > 0 && counts.occupied_total >= counts.capacity_total;

    if (role === "captain") out.push(<ItemBadge key="capt" tone="warn">Capitan</ItemBadge>);
    if (regStatus === "WAITLIST") out.push(<ItemBadge key="wait" tone="info">En espera</ItemBadge>);
    else if (role === "registered") out.push(<ItemBadge key="reg" tone="success">Anotado</ItemBadge>);

    if (item.is_global) out.push(<ItemBadge key="glob" tone="info">General</ItemBadge>);
    if (full && role !== "registered") out.push(<ItemBadge key="full" tone="danger">Cupo lleno</ItemBadge>);
    if (item.status === "FINALIZED") out.push(<ItemBadge key="fin">Finalizado</ItemBadge>);
  } else if (item.type === "tournament_match") {
    if (item.status === "LIVE") out.push(<ItemBadge key="live" tone="danger">En vivo</ItemBadge>);
    else if (item.status === "FINISHED") out.push(<ItemBadge key="end">Finalizado</ItemBadge>);
    if (item.participation?.team_name) {
      out.push(<ItemBadge key="team" tone="warn">{item.participation.team_name}</ItemBadge>);
    }
  } else if (item.type === "announcement") {
    out.push(<ItemBadge key="info" tone="info">Anuncio</ItemBadge>);
  }
  return out;
}

export default function CalendarItem({ item, onClick }) {
  const icon = TYPE_ICON[item.type] || "•";
  const tint = TYPE_TINT[item.type] || "border-white/10 bg-white/5";
  const time = fmtTime(item.starts_at);

  return (
    <button
      type="button"
      onClick={() => onClick?.(item)}
      className={cn(
        "w-full text-left rounded-2xl border bg-white/5 p-4 transition-all hover:bg-white/10",
        tint,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-black/30 text-lg">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="truncate text-sm font-semibold text-white">{item.title}</div>
            {time && <div className="shrink-0 text-xs font-mono text-white/60">{time}</div>}
          </div>
          {(item.subtitle || item.location_name) && (
            <div className="mt-0.5 truncate text-xs text-white/60">
              {[item.subtitle, item.location_name].filter(Boolean).join(" · ")}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {badgesFor(item)}
          </div>
        </div>
      </div>
    </button>
  );
}
