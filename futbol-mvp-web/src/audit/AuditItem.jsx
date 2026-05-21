import { useState } from "react";
import { cn, fmtTime } from "./api.js";
import { getTemplate, toneClass, categoryLabel } from "./actionTemplates.jsx";

export default function AuditItem({ log }) {
  const [expanded, setExpanded] = useState(false);
  const tpl = getTemplate(log.action);
  const time = fmtTime(log.created_at);
  const tint = toneClass(tpl.tone);

  return (
    <div
      className={cn(
        "rounded-2xl border bg-white/5 p-3 transition-colors hover:bg-white/10",
        tint,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-black/30 text-base">
          {tpl.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="min-w-0 flex-1 text-sm leading-snug text-white/90">
              {tpl.render(log)}
            </div>
            {time && (
              <div className="shrink-0 font-mono text-[11px] text-white/50">{time}</div>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full border border-white/15 bg-black/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/70">
              {categoryLabel(log.category)}
            </span>
            {log.event?.title && (
              <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] text-white/60">
                {log.event.title}
              </span>
            )}
            {log.is_system && (
              <span className="rounded-full border border-violet-400/30 bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-200">
                AUTO
              </span>
            )}
            <button
              onClick={() => setExpanded((v) => !v)}
              className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-white/40 hover:text-white"
              title="Ver datos crudos"
            >
              {expanded ? "Ocultar JSON" : "JSON"}
            </button>
          </div>

          {expanded && (
            <pre className="mt-2 max-h-60 overflow-auto rounded-xl border border-white/10 bg-black/40 p-2 text-[10px] leading-tight text-white/70">
              {JSON.stringify(
                {
                  id: log.id,
                  action: log.action,
                  actor: log.actor,
                  event: log.event,
                  target: log.target,
                  context: log.context,
                  metadata: log.metadata,
                  created_at: log.created_at,
                },
                null,
                2,
              )}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
