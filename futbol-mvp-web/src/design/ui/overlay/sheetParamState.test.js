import { describe, expect, it } from "vitest";
import {
  entryState,
  historyKeyOf,
  planClose,
  planOpen,
  readSheet,
  reconcileLocation,
  resolveBack,
  withSheet,
} from "./sheetParamState.js";

const loc = (key, sheet, historyKey = key) => ({ key, sheet, historyKey });

describe("?sheet= en la URL", () => {
  it("lee y escribe el param conservando el resto del search", () => {
    expect(readSheet("?tab=2&sheet=invite")).toBe("invite");
    expect(readSheet("?sheet=")).toBeNull();
    expect(readSheet("")).toBeNull();
    expect(withSheet("?tab=2", "invite")).toBe("?tab=2&sheet=invite");
    expect(withSheet("?tab=2&sheet=invite", "share")).toBe("?tab=2&sheet=share");
    expect(withSheet("?tab=2&sheet=invite", null)).toBe("?tab=2");
    expect(withSheet("?sheet=invite", null)).toBe("");
  });

  it("marca la entrada como nuestra sin perder el state que tenía", () => {
    expect(entryState({ from: "home" }, "invite")).toEqual({ from: "home", sheetPushed: "invite" });
    expect(entryState({ from: "home", sheetPushed: "invite" }, null)).toEqual({ from: "home" });
    expect(entryState({ sheetPushed: "invite" }, null)).toBeNull();
    expect(entryState(null, null)).toBeNull();
  });

  it("usa la misma key que react-router para la entrada inicial", () => {
    expect(historyKeyOf({ idx: 0 })).toBe("default");
    expect(historyKeyOf(null)).toBe("default");
    expect(historyKeyOf({ key: "k1", idx: 1 })).toBe("k1");
  });
});

describe("open() y close()", () => {
  it("open hace push; con un close del mismo tick, replace (nuestra solo si ya lo era)", () => {
    expect(planOpen({ closing: false, search: "", historyState: { idx: 0 } })).toEqual({ replace: false, ours: true });
    expect(
      planOpen({ closing: true, search: "?sheet=a", historyState: { idx: 2, usr: { sheetPushed: "a" } } })
    ).toEqual({ replace: true, ours: true });
    expect(planOpen({ closing: true, search: "?sheet=a", historyState: { idx: 0 } })).toEqual({
      replace: true,
      ours: false,
    });
    // El close no tenía nada que sacar de la URL: open vuelve a ser un push.
    expect(planOpen({ closing: true, search: "", historyState: { idx: 1 } })).toEqual({ replace: false, ours: true });
  });

  it("close vuelve atrás solo si la entrada es nuestra y hay adónde volver", () => {
    expect(planClose({ search: "?sheet=a", historyState: { idx: 3, usr: { sheetPushed: "a" } } })).toBe("back");
    // Deep link: la entrada no es nuestra.
    expect(planClose({ search: "?sheet=a", historyState: { idx: 3, usr: null } })).toBe("replace");
    // Nuestra, pero es la primera del history (pestaña nueva con el state copiado).
    expect(planClose({ search: "?sheet=a", historyState: { idx: 0, usr: { sheetPushed: "a" } } })).toBe("replace");
    expect(planClose({ search: "?tab=1", historyState: { idx: 3, usr: { sheetPushed: "a" } } })).toBe("none");
  });
});

describe("reconcileLocation", () => {
  it("ignora un location que React pinta tarde (el history ya va por otra entrada)", () => {
    const state = { current: "a", pending: { type: "go", key: "k2" } };
    expect(reconcileLocation(state, loc("k1", null, "k2"))).toEqual({ type: "keep", pending: state.pending });
  });

  it("nuestro push/replace llega y deja current como la URL", () => {
    const state = { current: "a", pending: { type: "go", key: "k1" } };
    expect(reconcileLocation(state, loc("k1", "a"))).toEqual({ type: "set", current: "a", pending: null });
  });

  it("nuestro -1: espera a salir de la entrada y acepta adonde haya llegado", () => {
    const pending = { type: "back", fromKey: "k1" };
    // open + close rápidos: el push de k1 se pinta después del -1. No reabre.
    expect(reconcileLocation({ current: null, pending }, loc("k1", "a"))).toEqual({ type: "keep", pending });
    expect(reconcileLocation({ current: null, pending }, loc("k0", null))).toEqual({
      type: "set",
      current: null,
      pending: null,
    });
    // Volvió a otra hoja de la misma pantalla.
    expect(reconcileLocation({ current: null, pending }, loc("k0", "a"))).toEqual({
      type: "set",
      current: "a",
      pending: null,
    });
  });

  it("el atrás del usuario con una hoja abierta le pregunta a la hoja", () => {
    expect(reconcileLocation({ current: "a", pending: null }, loc("k0", null))).toEqual({
      type: "ask",
      next: null,
      pending: null,
    });
    // De ?sheet=b a ?sheet=a.
    expect(reconcileLocation({ current: "b", pending: null }, loc("k1", "a"))).toEqual({
      type: "ask",
      next: "a",
      pending: null,
    });
  });

  it("un link (o el adelante) con ?sheet= y nada abierto abre la hoja", () => {
    expect(reconcileLocation({ current: null, pending: null }, loc("k2", "a"))).toEqual({
      type: "set",
      current: "a",
      pending: null,
    });
  });

  it("una navegación ajena con la misma hoja no cambia nada", () => {
    expect(reconcileLocation({ current: "a", pending: null }, loc("k3", "a"))).toEqual({ type: "keep", pending: null });
  });

  it("si la URL cambió por otro lado mientras esperábamos nuestro push, se trata como del usuario", () => {
    // Push de k1 y atrás del usuario antes de que React pinte k1.
    const state = { current: "a", pending: { type: "go", key: "k1" } };
    expect(reconcileLocation(state, loc("k0", null))).toEqual({ type: "ask", next: null, pending: null });
  });
});

describe("resolveBack", () => {
  it("bloquear deja la hoja y vuelve a poner el param; si no, se cierra", () => {
    expect(resolveBack({ current: "a", next: null, blocked: true })).toEqual({ current: "a", repush: "a" });
    expect(resolveBack({ current: "a", next: null, blocked: false })).toEqual({ current: null, repush: null });
    expect(resolveBack({ current: "b", next: "a", blocked: false })).toEqual({ current: "a", repush: null });
  });
});
