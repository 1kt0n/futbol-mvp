import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTION_DURATION, DEFAULT_DURATION, MAX_TOASTS, _resetToasts, getToasts, subscribeToasts, toast } from "./toast.js";

describe("toast store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetToasts();
  });
  afterEach(() => {
    _resetToasts();
    vi.useRealTimers();
  });

  it("acepta un string o un objeto y usa success por defecto", () => {
    toast("Cancha creada");
    toast({ kind: "error", title: "No se pudo", text: "Probá de nuevo" });
    expect(getToasts().map((t) => [t.kind, t.title, t.text])).toEqual([
      ["success", "Cancha creada", ""],
      ["error", "No se pudo", "Probá de nuevo"],
    ]);
  });

  it("ignora un toast sin título ni texto", () => {
    expect(toast({})).toBeNull();
    expect(toast(null)).toBeNull();
    expect(getToasts()).toHaveLength(0);
  });

  it("se va solo a los 4 s, o a los 5 s si tiene acción", () => {
    toast("Sin acción");
    toast({ title: "Con acción", action: { label: "Deshacer", onClick: () => {} } });
    vi.advanceTimersByTime(DEFAULT_DURATION);
    expect(getToasts().map((t) => t.title)).toEqual(["Con acción"]);
    vi.advanceTimersByTime(ACTION_DURATION - DEFAULT_DURATION);
    expect(getToasts()).toHaveLength(0);
  });

  it(`muestra como máximo ${MAX_TOASTS}: se van los más viejos`, () => {
    for (let i = 1; i <= MAX_TOASTS + 2; i += 1) toast(`Aviso ${i}`);
    expect(getToasts().map((t) => t.title)).toEqual(["Aviso 3", "Aviso 4", "Aviso 5"]);
  });

  it("dismiss lo saca y avisa a los suscriptores", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToasts(listener);
    const id = toast("Guardado");
    toast.dismiss(id);
    expect(getToasts()).toHaveLength(0);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
