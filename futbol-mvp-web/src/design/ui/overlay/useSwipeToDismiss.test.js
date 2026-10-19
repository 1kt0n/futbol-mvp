import { describe, expect, it } from "vitest";
import { releaseVelocity, shouldDismiss } from "./useSwipeToDismiss.js";

describe("deslizar para cerrar", () => {
  it("cierra pasado el 30% del alto o soltando rápido hacia abajo", () => {
    expect(shouldDismiss({ dy: 121, height: 400, velocity: 0 })).toBe(true);
    expect(shouldDismiss({ dy: 119, height: 400, velocity: 0.2 })).toBe(false);
    expect(shouldDismiss({ dy: 40, height: 400, velocity: 0.7 })).toBe(true);
    // Un toque (menos de 5 px) no cierra aunque el dedo se haya movido rápido.
    expect(shouldDismiss({ dy: 4, height: 400, velocity: 2 })).toBe(false);
  });

  it("mide la velocidad con los últimos 100 ms", () => {
    const samples = [
      { t: 0, y: 100 },
      { t: 400, y: 120 },
      { t: 450, y: 150 },
      { t: 500, y: 200 },
    ];
    expect(releaseVelocity(samples, 500)).toBeCloseTo(80 / 100);
    // Se quedó quieto antes de soltar.
    expect(releaseVelocity([{ t: 0, y: 100 }, { t: 50, y: 200 }, { t: 400, y: 200 }], 400)).toBe(0);
  });
});
