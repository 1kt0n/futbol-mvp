// Único lugar donde se pintan los toasts. Vive en #overlay-root (nunca queda
// inerte), encima de la barra inferior; con una hoja abierta se pasa arriba para
// no tapar su botón principal.

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../cn.js";
import { getOverlayRoot, useOverlayDepth } from "./stack.js";
import { dismissToast, getToasts, subscribeToasts } from "./toast.js";

const TONE = {
  // Blanco sobre emerald-700 / rose-700 / zinc-800: contraste AA con texto chico.
  success: "border-emerald-400/30 bg-emerald-700 text-white",
  error: "border-rose-400/30 bg-rose-700 text-white",
  info: "border-white/15 bg-zinc-800 text-white",
};

export default function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  const depth = useOverlayDepth();

  return createPortal(
    <div
      aria-live="polite"
      className={cn("ov-toaster z-toast", depth > 0 ? "ov-toaster--top" : "ov-toaster--bottom")}
      data-testid="toaster"
    >
      {items.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          data-testid="toast"
          className={cn(
            "ov-toast pointer-events-auto flex items-center gap-3 rounded-2xl border px-4 py-3 shadow-xl shadow-black/40",
            TONE[t.kind] || TONE.info
          )}
        >
          <div className="min-w-0 flex-1">
            {t.title ? <div className="text-sm font-semibold">{t.title}</div> : null}
            {t.text ? <div className="text-sm">{t.text}</div> : null}
          </div>
          {t.action ? (
            <button
              type="button"
              onClick={() => {
                dismissToast(t.id);
                t.action.onClick?.();
              }}
              className="-my-2 min-h-[44px] shrink-0 rounded-lg px-3 text-sm font-bold underline-offset-2 hover:underline"
            >
              {t.action.label}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            aria-label="Cerrar aviso"
            className="-my-2 -mr-3 grid h-11 w-11 shrink-0 place-items-center rounded-full text-lg leading-none hover:bg-black/15"
          >
            ×
          </button>
        </div>
      ))}
    </div>,
    getOverlayRoot()
  );
}
