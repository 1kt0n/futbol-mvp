// Confirmación (role="alertdialog"): título, consecuencia, acción principal y la
// salida segura, que es la que recibe el foco. Abajo en el celular, centrado
// desde 640px. children puede traer un campo (por ejemplo, un motivo opcional).

import { useId, useRef } from "react";
import { cn } from "../../cn.js";
import Layer from "./Layer.jsx";

export function Dialog({ open, ...props }) {
  if (!open) return null;
  return <DialogPanel {...props} />;
}

function DialogPanel({
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancelar",
  tone = "default",
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  testId,
  confirmTestId = "confirm-sheet-confirm",
  cancelTestId = "confirm-sheet-cancel",
}) {
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef(null);
  const cancel = () => {
    if (!busy) onCancel?.();
  };

  // En 390px entran ~16 caracteres por botón si van lado a lado; si no, se apilan (§7.0).
  const stacked = (confirmLabel || "").length > 16 || (cancelLabel || "").length > 16;

  return (
    <Layer
      kind="dialog"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={children ? bodyId : undefined}
      data-testid={testId}
      initialFocusRef={cancelRef}
      onBackdrop={cancel}
      onEscape={cancel}
      panelClassName="ov-panel--dialog"
    >
      <div className="ov-body pt-5">
        <div className="ov-grabber" aria-hidden="true" />
        <h2 id={titleId} className="text-center text-lg font-semibold text-white">
          {title}
        </h2>
        {children ? (
          <div id={bodyId} className="mt-2 text-center text-sm text-white/70">
            {children}
          </div>
        ) : null}
      </div>
      <div className="ov-footer">
        <div className={cn("flex gap-3", stacked ? "flex-col" : "flex-row-reverse")}>
          <button
            type="button"
            disabled={busy || confirmDisabled}
            onClick={onConfirm}
            data-testid={confirmTestId}
            className={cn(
              "min-h-[44px] flex-1 rounded-xl px-4 py-3 text-base font-semibold transition-colors disabled:opacity-50",
              tone === "danger"
                ? "bg-rose-600 text-white hover:bg-rose-700"
                : "bg-emerald-500 text-black hover:bg-emerald-400"
            )}
          >
            {confirmLabel}
          </button>
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={cancel}
            data-testid={cancelTestId}
            className="min-h-[44px] flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </Layer>
  );
}
