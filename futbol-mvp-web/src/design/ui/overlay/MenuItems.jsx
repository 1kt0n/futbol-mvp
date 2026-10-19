// La lista role="menu" que comparten ActionSheet (celular) y Menu (popover de
// escritorio): se navega con flechas (y Inicio/Fin), y elegir una opción cierra
// el menú antes de ejecutarla.
// items: [{ label, hint, icon, tone: "danger", disabled, testId, onSelect }]

import { useRef } from "react";
import { cn } from "../../cn.js";

const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

export function MenuItems({ items, onClose, firstRef, labelledBy, label, variant = "sheet", className }) {
  const menuRef = useRef(null);
  const firstEnabled = items.findIndex((it) => !it.disabled);
  const compact = variant === "popover";

  function onKeyDown(e) {
    if (!NAV_KEYS.has(e.key)) return;
    const buttons = Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || []);
    if (buttons.length === 0) return;
    e.preventDefault();
    const i = buttons.indexOf(document.activeElement);
    let next;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = buttons.length - 1;
    else if (e.key === "ArrowDown") next = (i + 1) % buttons.length;
    else next = (i - 1 + buttons.length) % buttons.length;
    buttons[next].focus();
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      className={cn("flex flex-col", compact ? "gap-0.5" : "gap-2", className)}
      onKeyDown={onKeyDown}
    >
      {items.map((it, i) => (
        <button
          key={it.label}
          ref={i === firstEnabled ? firstRef : undefined}
          type="button"
          role="menuitem"
          disabled={it.disabled}
          data-testid={it.testId}
          onClick={() => {
            onClose?.();
            it.onSelect?.();
          }}
          className={cn(
            "focus-ring flex w-full items-center text-left transition-colors disabled:opacity-50",
            compact
              ? cn(
                  "min-h-[44px] gap-3 rounded-xl px-3 py-2",
                  it.tone === "danger" ? "hover:bg-rose-500/15" : "hover:bg-white/10"
                )
              : cn(
                  "min-h-[52px] gap-3 rounded-2xl border px-4 py-3",
                  it.tone === "danger"
                    ? "border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20"
                    : "border-white/10 bg-white/5 hover:bg-white/10"
                )
          )}
        >
          {it.icon ? (
            <span aria-hidden="true" className={compact ? "text-lg" : "text-xl"}>
              {it.icon}
            </span>
          ) : null}
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block font-semibold",
                compact ? "text-sm" : "text-base",
                it.tone === "danger" ? "text-rose-100" : "text-white"
              )}
            >
              {it.label}
            </span>
            {it.hint ? <span className="mt-0.5 block text-xs text-white/60">{it.hint}</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
}
