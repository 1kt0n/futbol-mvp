import { cn } from "../cn.js";

const statusColors = {
  DRAFT: "bg-amber-500/20 text-amber-300 border-amber-300/30",
  LIVE: "bg-emerald-500/20 text-emerald-300 border-emerald-300/30",
  FINISHED: "bg-sky-500/20 text-sky-300 border-sky-300/30",
  ARCHIVED: "bg-zinc-500/20 text-zinc-300 border-zinc-300/30",
  READY: "bg-indigo-500/20 text-indigo-300 border-indigo-300/30",
  PENDING: "bg-amber-500/20 text-amber-300 border-amber-300/30",
};

export default function Badge({ value, className = "" }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
        statusColors[value] || "bg-white/10 text-white border-white/20",
        className
      )}
    >
      {value}
    </span>
  );
}

