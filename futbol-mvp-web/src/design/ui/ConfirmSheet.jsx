import { useEffect, useRef } from "react";
import { cn } from "../cn.js";

// Confirmación en bottom sheet (iter 0a). La primitiva completa de overlays
// (portal, scroll lock, focus trap) llega en la 0b; esto cubre lo mínimo: título,
// consecuencia, acción principal y la salida segura con el foco.
export default function ConfirmSheet({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancelar",
  tone = "default",
  busy = false,
  onConfirm,
  onCancel,
}) {
  const cancelRef = useRef(null);
  const latest = useRef({ busy, onCancel });

  useEffect(() => {
    latest.current = { busy, onCancel };
  });

  // El foco va a la salida segura al abrir; Escape cancela (salvo con un request en curso).
  useEffect(() => {
    if (!open) return undefined;
    cancelRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape" && !latest.current.busy) latest.current.onCancel?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  // En 390px entran ~16 caracteres por botón si van lado a lado; si no, se apilan.
  const stacked = (confirmLabel || "").length > 16 || (cancelLabel || "").length > 16;

  return (
    <div className="bottom-sheet-overlay" onClick={() => !busy && onCancel?.()}>
      <div
        className="bottom-sheet-panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
        <h3 id="confirm-sheet-title" className="text-center text-lg font-semibold text-white">
          {title}
        </h3>
        {children ? <div className="mt-2 text-center text-sm text-white/70">{children}</div> : null}
        <div className={cn("mt-5 flex gap-3", stacked ? "flex-col" : "flex-row-reverse")}>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            data-testid="confirm-sheet-confirm"
            className={cn(
              "flex-1 rounded-xl px-4 py-3 text-base font-semibold transition-colors disabled:opacity-50",
              tone === "danger"
                ? "bg-rose-500 text-white hover:bg-rose-400"
                : "bg-emerald-500 text-black hover:bg-emerald-400"
            )}
          >
            {confirmLabel}
          </button>
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            data-testid="confirm-sheet-cancel"
            className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
