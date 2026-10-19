// Menú de un botón (⋯, "Más acciones"). Controlado:
//
//   const ref = useRef(null);
//   <button ref={ref} onClick={() => setOpen(true)} aria-haspopup="menu">⋯</button>
//   <Menu open={open} onClose={() => setOpen(false)} anchorRef={ref} title="Acciones" items={[...]} />
//
// Debajo de 768px es un ActionSheet (en el celular no hay dropdowns, §3.4).
// Desde 768px, un popover al lado del botón: sin bloquear el scroll y con fondo
// transparente; se cierra con un clic afuera, Esc, al elegir, y si la página se
// mueve (scroll o resize), porque quedaría despegado del botón.
// items tiene la misma forma que en ActionSheet.

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { ActionSheet } from "./ActionSheet.jsx";
import Layer from "./Layer.jsx";
import { MenuItems } from "./MenuItems.jsx";
import { computePopoverPosition } from "./popoverPosition.js";

const DESKTOP = "(min-width: 768px)";

function subscribeDesktop(fn) {
  const mq = window.matchMedia(DESKTOP);
  mq.addEventListener("change", fn);
  return () => mq.removeEventListener("change", fn);
}
const isDesktop = () => window.matchMedia(DESKTOP).matches;

export function Menu({ open, onClose, anchorRef, title, items = [], placement = "bottom-end", testId }) {
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
  if (!desktop) return <ActionSheet open={open} onClose={onClose} title={title} items={items} testId={testId} />;
  if (!open) return null;
  return (
    <MenuPopover onClose={onClose} anchorRef={anchorRef} title={title} items={items} placement={placement} testId={testId} />
  );
}

function MenuPopover({ onClose, anchorRef, title, items, placement, testId }) {
  const panelRef = useRef(null);
  const firstRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  // Antes de pintar: se mide el panel (arranca oculto, sin data-placement) y se
  // ubica al lado del botón.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const viewport = { width: document.documentElement.clientWidth, height: window.innerHeight };
    const anchor = anchorRef?.current?.getBoundingClientRect() ?? {
      left: viewport.width / 2,
      right: viewport.width / 2,
      top: viewport.height / 3,
      bottom: viewport.height / 3,
      width: 0,
      height: 0,
    };
    const pos = computePopoverPosition(
      anchor,
      { width: panel.offsetWidth, height: panel.scrollHeight },
      viewport,
      placement
    );
    panel.style.top = `${pos.top}px`;
    panel.style.left = `${pos.left}px`;
    panel.style.maxHeight = `${pos.maxHeight}px`;
    panel.dataset.placement = pos.placement;
  }, [anchorRef, placement]);

  useEffect(() => {
    const close = () => onCloseRef.current?.();
    // El scroll de adentro del menú (si es largo) no lo cierra.
    const onScroll = (e) => {
      if (!panelRef.current?.contains(e.target)) close();
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, []);

  return (
    <Layer
      kind="popover"
      data-testid={testId}
      initialFocusRef={firstRef}
      panelRef={panelRef}
      onBackdrop={() => onClose?.()}
      onEscape={() => onClose?.()}
    >
      <MenuItems items={items} onClose={onClose} firstRef={firstRef} label={title} variant="popover" />
    </Layer>
  );
}
