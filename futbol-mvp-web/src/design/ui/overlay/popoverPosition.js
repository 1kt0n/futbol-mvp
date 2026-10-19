// Dónde va el menú de escritorio (popover) respecto del botón que lo abre.
// Función pura: todo en coordenadas del viewport (getBoundingClientRect).
//
// placement: "bottom-end" (default), "bottom-start", "bottom", "top-end",
// "top-start" o "top".
// - Flip: si no entra del lado pedido y del otro hay más lugar, se da vuelta.
// - Shift: nunca queda a menos de 8 px de un borde.
// - Alto máximo: 60% del viewport (60dvh) o lo que haya de ese lado.

export const POPOVER_GAP = 4;
export const POPOVER_MARGIN = 8;
export const POPOVER_MAX_HEIGHT_RATIO = 0.6;
// Con poco lugar de los dos lados, al menos esto (aunque tape un poco el botón).
const MIN_HEIGHT = 120;

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

export function computePopoverPosition(anchorRect, panelSize, viewport, placement = "bottom-end") {
  const [requested, align = "center"] = placement.split("-");
  const cap = Math.floor(viewport.height * POPOVER_MAX_HEIGHT_RATIO);
  const wanted = Math.min(panelSize.height, cap);
  const room = {
    bottom: viewport.height - anchorRect.bottom - POPOVER_GAP - POPOVER_MARGIN,
    top: anchorRect.top - POPOVER_GAP - POPOVER_MARGIN,
  };

  let side = requested === "top" ? "top" : "bottom";
  const other = side === "bottom" ? "top" : "bottom";
  if (wanted > room[side] && room[other] > room[side]) side = other;

  const maxHeight = Math.min(cap, Math.floor(Math.max(room[side], Math.min(wanted, MIN_HEIGHT))));
  const height = Math.min(wanted, maxHeight);
  const top = side === "bottom" ? anchorRect.bottom + POPOVER_GAP : anchorRect.top - POPOVER_GAP - height;

  const width = Math.min(panelSize.width, viewport.width - 2 * POPOVER_MARGIN);
  let left;
  if (align === "end") left = anchorRect.right - width;
  else if (align === "start") left = anchorRect.left;
  else left = anchorRect.left + anchorRect.width / 2 - width / 2;

  return {
    top: Math.round(clamp(top, POPOVER_MARGIN, viewport.height - POPOVER_MARGIN - height)),
    left: Math.round(clamp(left, POPOVER_MARGIN, viewport.width - POPOVER_MARGIN - width)),
    maxHeight,
    placement: align === "center" ? side : `${side}-${align}`,
  };
}
