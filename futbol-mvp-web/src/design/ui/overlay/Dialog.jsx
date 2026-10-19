// Confirmación (role="alertdialog"): título, consecuencia, acción principal y la
// salida segura, que es la que recibe el foco. Abajo en el celular, centrado
// desde 640px. children puede traer un campo (por ejemplo, un motivo opcional).
// Con history={sheets.history} (useSheetParam), el atrás de Android cancela.
// En el celular, el grabber se desliza para cancelar.

import { useId, useLayoutEffect, useRef } from "react";
import { cn } from "../../cn.js";
import Layer from "./Layer.jsx";
import { escapeTop, isTopLayer } from "./stack.js";
import { useSwipeToDismiss } from "./useSwipeToDismiss.js";

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
  history,
  testId,
  confirmTestId = "confirm-sheet-confirm",
  cancelTestId = "confirm-sheet-cancel",
}) {
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef(null);
  const panelRef = useRef(null);
  const layerIdRef = useRef(null);
  const busyRef = useRef(busy);
  const cancel = () => {
    if (!busy) onCancel?.();
  };

  useLayoutEffect(() => {
    busyRef.current = busy;
  });

  // El atrás del navegador: true = bloquear. Si no bloquea, se cierra por la URL
  // (no se llama a onCancel, que volvería a navegar).
  useLayoutEffect(() => {
    if (!history) return undefined;
    return history.register(() => {
      if (layerIdRef.current !== null && !isTopLayer(layerIdRef.current)) {
        escapeTop();
        return true;
      }
      return busyRef.current;
    });
  }, [history]);

  const swipe = useSwipeToDismiss({
    panelRef,
    onRelease: () => (busy ? "blocked" : "closed"),
    onDismiss: () => onCancel?.(),
  });

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
      panelRef={panelRef}
      layerIdRef={layerIdRef}
      onBackdrop={cancel}
      onEscape={cancel}
      panelClassName="ov-panel--dialog"
    >
      <div className="ov-grabzone ov-swipe" {...swipe}>
        <div className="ov-grabber" aria-hidden="true" />
      </div>
      <div className="ov-body pt-2">
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
