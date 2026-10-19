// Menú de acciones (en el celular no hay dropdowns, §3.4). role="menu", se
// navega con flechas, y elegir una opción cierra el menú antes de ejecutarla.

import { useId, useRef } from "react";
import { cn } from "../../cn.js";
import Layer from "./Layer.jsx";

export function ActionSheet({ open, ...props }) {
  if (!open) return null;
  return <ActionSheetPanel {...props} />;
}

function ActionSheetPanel({ onClose, title, description, items = [], testId }) {
  const titleId = useId();
  const firstRef = useRef(null);
  const menuRef = useRef(null);
  const firstEnabled = items.findIndex((it) => !it.disabled);

  function onMenuKeyDown(e) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const buttons = Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || []);
    if (buttons.length === 0) return;
    e.preventDefault();
    const i = buttons.indexOf(document.activeElement);
    const next = e.key === "ArrowDown" ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
    buttons[next].focus();
  }

  return (
    <Layer
      kind="menu"
      role="dialog"
      aria-labelledby={titleId}
      data-testid={testId}
      initialFocusRef={firstRef}
      onBackdrop={() => onClose?.()}
      onEscape={() => onClose?.()}
      panelClassName="ov-panel--dialog"
    >
      <div className="ov-body pt-5">
        <div className="ov-grabber" aria-hidden="true" />
        <h2 id={titleId} className="text-base font-semibold text-white">
          {title}
        </h2>
        {description ? <p className="mt-1 text-sm text-white/60">{description}</p> : null}
        <div
          ref={menuRef}
          role="menu"
          aria-labelledby={titleId}
          className="mt-4 flex flex-col gap-2"
          onKeyDown={onMenuKeyDown}
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
                "focus-ring flex min-h-[52px] w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors disabled:opacity-50",
                it.tone === "danger"
                  ? "border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20"
                  : "border-white/10 bg-white/5 hover:bg-white/10"
              )}
            >
              {it.icon ? <span aria-hidden="true" className="text-xl">{it.icon}</span> : null}
              <span className="min-w-0 flex-1">
                <span className={cn("block text-base font-semibold", it.tone === "danger" ? "text-rose-100" : "text-white")}>
                  {it.label}
                </span>
                {it.hint ? <span className="mt-0.5 block text-xs text-white/60">{it.hint}</span> : null}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="ov-footer">
        <button
          type="button"
          onClick={() => onClose?.()}
          className="min-h-[44px] w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-base font-semibold text-white hover:bg-white/10"
        >
          Cancelar
        </button>
      </div>
    </Layer>
  );
}
