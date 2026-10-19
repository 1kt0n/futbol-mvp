// Hoja (bottom sheet en el celular, diálogo centrado desde 640px).
// Header fijo, cuerpo con scroll y footer siempre a la vista con el safe-area.
//
// dismiss:
//   "auto"    → cierra con el fondo, Esc y la cruz.
//   "guarded" → formularios: con cambios sin guardar el fondo no cierra, y Esc o
//               la cruz preguntan "¿Descartás los cambios?" en línea.
//   "locked"  → no cierra con nada (igual que busy, mientras hay un request).
//
// Los formularios hijos avisan que tienen cambios con useSheetDirty(bool) (y que
// hay un request en curso con useSheetBusy(bool)) y ponen su botón abajo con
// <SheetFooter> (el botón submit usa form={id}).

import { useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../cn.js";
import Layer from "./Layer.jsx";
import { SheetContext } from "./sheetContext.js";
import { revealOnFocus } from "./useKeyboardInset.js";

export function Sheet({ open, ...props }) {
  if (!open) return null;
  return <SheetPanel {...props} />;
}

function SheetPanel({
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "auto",
  width = "md",
  dismiss = "auto",
  dirty = false,
  busy = false,
  testId,
  closeTestId,
  backdropTestId,
}) {
  const titleId = useId();
  const titleRef = useRef(null);
  const keepEditingRef = useRef(null);
  // Dónde estaba el foco antes de "¿Descartás los cambios?", para volver ahí.
  const resumeFocusRef = useRef(null);
  const wasConfirming = useRef(false);
  const lastTitle = useRef(title);
  const [reportedDirty, setReportedDirty] = useState(false);
  const [reportedBusy, setReportedBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [footerNode, setFooterNode] = useState(null);
  const [footerItems, setFooterItems] = useState(0);

  const locked = busy || reportedBusy || dismiss === "locked";
  const guarded = dismiss === "guarded" && (dirty || reportedDirty);

  function requestClose(source) {
    if (locked) return;
    if (confirming) {
      // Esc con la pregunta abierta = seguir editando.
      if (source === "escape") setConfirming(false);
      return;
    }
    if (guarded) {
      if (source !== "backdrop") {
        resumeFocusRef.current = document.activeElement;
        setConfirming(true);
      }
      return;
    }
    onClose?.();
  }

  useEffect(() => {
    if (confirming) {
      keepEditingRef.current?.focus();
    } else if (wasConfirming.current) {
      // "Seguir editando" (o Esc) desmonta el botón con foco: se vuelve al campo.
      const el = resumeFocusRef.current;
      const back = el && el !== document.body && el.isConnected ? el : titleRef.current;
      back?.focus({ preventScroll: true });
    }
    wasConfirming.current = confirming;
  }, [confirming]);

  // Si la hoja cambia de paso (Repetir → "Compartí el partido"), se anuncia el título nuevo.
  useEffect(() => {
    if (typeof title === "string" && lastTitle.current !== title) titleRef.current?.focus({ preventScroll: true });
    lastTitle.current = title;
  }, [title]);

  // Si el formulario vuelve a quedar sin cambios, la pregunta ya no hace falta.
  const setDirty = useCallback((value) => {
    setReportedDirty(value);
    if (!value) setConfirming(false);
  }, []);

  const ctx = { setDirty, setBusy: setReportedBusy, footerNode, setFooterItems, requestClose };
  const hasFooter = Boolean(footer) || footerItems > 0 || confirming;

  return (
    <Layer
      kind="sheet"
      role="dialog"
      aria-labelledby={titleId}
      data-testid={testId}
      backdropTestId={backdropTestId}
      initialFocusRef={titleRef}
      onBackdrop={() => requestClose("backdrop")}
      onEscape={() => requestClose("escape")}
      panelClassName={cn(size === "full" && "ov-panel--full", width === "lg" && "ov-panel--lg")}
    >
      <SheetContext.Provider value={ctx}>
        <div className="ov-header">
          <div className="ov-grabber" aria-hidden="true" />
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2
                id={titleId}
                ref={titleRef}
                tabIndex={-1}
                className="text-lg font-semibold leading-snug text-white outline-none"
              >
                {title}
              </h2>
              {subtitle ? <div className="mt-1 text-sm text-white/60">{subtitle}</div> : null}
            </div>
            <button
              type="button"
              onClick={() => requestClose("button")}
              disabled={locked}
              aria-label="Cerrar"
              data-testid={closeTestId}
              className="focus-ring -mr-2 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-2xl leading-none text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              ×
            </button>
          </div>
        </div>

        <div className="ov-body" onFocus={revealOnFocus}>
          {children}
        </div>

        <div className={cn("ov-footer", hasFooter && "ov-footer--filled")}>
          {confirming ? (
            <div role="alert" className="space-y-3">
              <p className="text-center text-base font-semibold text-white">¿Descartás los cambios?</p>
              {/* Apilados: "Seguir editando" no entra en media fila a 375px (§7.0). */}
              <div className="flex flex-col gap-2">
                <button
                  ref={keepEditingRef}
                  type="button"
                  onClick={() => setConfirming(false)}
                  data-testid="sheet-keep-editing-btn"
                  className="min-h-[44px] w-full rounded-xl bg-emerald-500 px-4 py-3 text-base font-semibold text-black hover:bg-emerald-400"
                >
                  Seguir editando
                </button>
                <button
                  type="button"
                  onClick={() => onClose?.()}
                  data-testid="sheet-discard-btn"
                  className="min-h-[44px] w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-base font-semibold text-white hover:bg-white/10"
                >
                  Descartar
                </button>
              </div>
            </div>
          ) : null}
          {/* Se oculta (no se desmonta) mientras está la pregunta: el contenido
              del footer puede venir por portal desde un formulario hijo. */}
          <div hidden={confirming}>
            {footer}
            <div ref={setFooterNode} />
          </div>
        </div>
      </SheetContext.Provider>
    </Layer>
  );
}

// Pone sus hijos en el footer fijo de la hoja. Fuera de una hoja, los deja en el lugar.
export function SheetFooter({ children }) {
  const ctx = useContext(SheetContext);
  const setFooterItems = ctx?.setFooterItems;
  useLayoutEffect(() => {
    if (!setFooterItems) return undefined;
    setFooterItems((n) => n + 1);
    return () => setFooterItems((n) => n - 1);
  }, [setFooterItems]);
  if (!ctx) return <div className="mt-4">{children}</div>;
  if (!ctx.footerNode) return null;
  return createPortal(children, ctx.footerNode);
}
