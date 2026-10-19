import { describe, expect, it } from "vitest";
import { computePopoverPosition } from "./popoverPosition.js";

const rect = (left, top, width, height) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});
const viewport = { width: 1024, height: 768 };
const panel = { width: 200, height: 150 };

describe("computePopoverPosition", () => {
  it("bottom-end: abajo del botón, alineado a su borde derecho", () => {
    expect(computePopoverPosition(rect(600, 100, 100, 40), panel, viewport, "bottom-end")).toEqual({
      top: 144,
      left: 500,
      maxHeight: 460,
      placement: "bottom-end",
    });
  });

  it("usa bottom-end por defecto y respeta start y center", () => {
    const anchor = rect(600, 100, 100, 40);
    expect(computePopoverPosition(anchor, panel, viewport).placement).toBe("bottom-end");
    expect(computePopoverPosition(anchor, panel, viewport, "bottom-start").left).toBe(600);
    expect(computePopoverPosition(anchor, panel, viewport, "bottom")).toMatchObject({ left: 550, placement: "bottom" });
  });

  it("se da vuelta arriba si abajo no entra y arriba hay más lugar", () => {
    const pos = computePopoverPosition(rect(600, 700, 100, 40), panel, viewport, "bottom-end");
    expect(pos).toMatchObject({ placement: "top-end", top: 700 - 4 - 150 });
  });

  it("top se da vuelta abajo si arriba no entra", () => {
    const pos = computePopoverPosition(rect(600, 20, 100, 40), panel, viewport, "top-start");
    expect(pos).toMatchObject({ placement: "bottom-start", top: 64, left: 600 });
  });

  it("si no entra de ningún lado, queda del que tiene más lugar y achica el alto", () => {
    const tall = { width: 200, height: 2000 };
    const small = { width: 1024, height: 400 };
    const pos = computePopoverPosition(rect(600, 150, 100, 40), tall, small, "bottom-end");
    // Abajo: 400 - 190 - 12 = 198; arriba: 150 - 12 = 138. Tope 60% = 240.
    expect(pos).toMatchObject({ placement: "bottom-end", top: 194, maxHeight: 198 });
  });

  it("el alto máximo es el 60% del viewport", () => {
    const pos = computePopoverPosition(rect(600, 10, 100, 30), { width: 200, height: 2000 }, viewport);
    expect(pos.maxHeight).toBe(460);
  });

  it("se corre para quedar a 8 px de los bordes", () => {
    expect(computePopoverPosition(rect(0, 100, 40, 40), panel, viewport, "bottom-end").left).toBe(8);
    expect(computePopoverPosition(rect(1000, 100, 20, 40), panel, viewport, "bottom-start").left).toBe(1024 - 8 - 200);
  });

  it("un panel más ancho que el viewport queda pegado al margen izquierdo", () => {
    const pos = computePopoverPosition(rect(100, 100, 40, 40), { width: 600, height: 100 }, { width: 400, height: 700 });
    expect(pos.left).toBe(8);
  });

  it("nunca se sale por arriba ni por abajo", () => {
    // Botón casi pegado abajo en un viewport bajo: el panel no puede quedar fuera.
    const pos = computePopoverPosition(rect(600, 280, 100, 10), panel, { width: 1024, height: 300 }, "bottom-end");
    expect(pos.top).toBeGreaterThanOrEqual(8);
    expect(pos.top + Math.min(panel.height, pos.maxHeight)).toBeLessThanOrEqual(300 - 8);
  });
});
