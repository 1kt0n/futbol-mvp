// Menú de acciones (en el celular no hay dropdowns, §3.4). role="menu", se
// navega con flechas, y elegir una opción cierra el menú antes de ejecutarla.
// En el celular, el grabber se desliza para cerrar. Desde 768px, Menu usa un
// popover al lado del botón en vez de esto.

import { useId, useRef } from "react";
import Layer from "./Layer.jsx";
import { MenuItems } from "./MenuItems.jsx";
import { useSwipeToDismiss } from "./useSwipeToDismiss.js";

export function ActionSheet({ open, ...props }) {
  if (!open) return null;
  return <ActionSheetPanel {...props} />;
}

function ActionSheetPanel({ onClose, title, description, items = [], testId }) {
  const titleId = useId();
  const firstRef = useRef(null);
  const panelRef = useRef(null);
  const swipe = useSwipeToDismiss({
    panelRef,
    onRelease: () => "closed",
    onDismiss: () => onClose?.(),
  });

  return (
    <Layer
      kind="menu"
      role="dialog"
      aria-labelledby={titleId}
      data-testid={testId}
      initialFocusRef={firstRef}
      panelRef={panelRef}
      onBackdrop={() => onClose?.()}
      onEscape={() => onClose?.()}
      panelClassName="ov-panel--dialog"
    >
      <div className="ov-grabzone ov-swipe" {...swipe}>
        <div className="ov-grabber" aria-hidden="true" />
      </div>
      <div className="ov-body pt-2">
        <h2 id={titleId} className="text-base font-semibold text-white">
          {title}
        </h2>
        {description ? <p className="mt-1 text-sm text-white/60">{description}</p> : null}
        <MenuItems items={items} onClose={onClose} firstRef={firstRef} labelledBy={titleId} className="mt-4" />
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
