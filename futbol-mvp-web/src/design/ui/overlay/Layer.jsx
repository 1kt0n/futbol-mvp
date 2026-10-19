// Capa base de todos los overlays: portal a #overlay-root, fondo, registro en la
// pila (inert, scroll, Esc/Tab), foco inicial y devolución del foco al cerrar.
// No se usa directo: la envuelven Sheet, Dialog y ActionSheet.

import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../cn.js";
import { getOverlayRoot, getReturnFocusTarget, pushLayer, removeLayer, scheduleFocusReturn } from "./stack.js";
import { useKeyboardInset } from "./useKeyboardInset.js";

const Z = { sheet: "z-sheet", dialog: "z-dialog", menu: "z-menu" };

// El portal saca el DOM de #root, pero React sigue propagando los eventos por su
// propio árbol: sin esto, un clic adentro de la hoja dispararía el onClick de la
// tarjeta (o el onSubmit del form) que la contiene en el código.
const stop = (e) => e.stopPropagation();
const STOP_PROPAGATION = {
  onClick: stop,
  onDoubleClick: stop,
  onPointerDown: stop,
  onPointerUp: stop,
  onMouseDown: stop,
  onMouseUp: stop,
  onTouchStart: stop,
  onTouchEnd: stop,
  onKeyDown: stop,
  onKeyUp: stop,
  onChange: stop,
  onInput: stop,
  onSubmit: stop,
};

export default function Layer({
  kind = "sheet",
  onBackdrop,
  onEscape,
  initialFocusRef,
  panelClassName,
  backdropTestId,
  children,
  ...panelProps
}) {
  const nodeRef = useRef(null);
  const panelRef = useRef(null);
  const handlers = useRef({ onBackdrop, onEscape });

  // Hojas, diálogos y menús suben con el teclado virtual (un diálogo puede traer un campo).
  useKeyboardInset();

  useLayoutEffect(() => {
    handlers.current = { onBackdrop, onEscape };
  });

  useLayoutEffect(() => {
    const previous = getReturnFocusTarget();
    const id = pushLayer({ kind, node: nodeRef.current, getHandlers: () => handlers.current });
    const target = initialFocusRef?.current || panelRef.current;
    target?.focus({ preventScroll: true });
    return () => {
      removeLayer(id);
      // En un microtask: si se cierran dos capas juntas, recién ahí no queda nada inerte.
      scheduleFocusReturn(previous);
    };
    // Solo al montar: el foco inicial y el registro son de toda la vida de la capa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div ref={nodeRef} className={cn("ov-layer", Z[kind])} data-overlay={kind} {...STOP_PROPAGATION}>
      <div
        className="ov-backdrop"
        aria-hidden="true"
        data-testid={backdropTestId}
        onClick={() => handlers.current.onBackdrop?.()}
      />
      <div
        ref={panelRef}
        aria-modal="true"
        tabIndex={-1}
        className={cn("ov-panel", panelClassName)}
        {...panelProps}
      >
        {children}
      </div>
    </div>,
    getOverlayRoot()
  );
}
