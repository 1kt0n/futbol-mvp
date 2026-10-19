import { describe, expect, it } from "vitest";
import { clock, courtPhrase, hourLabel, ordinal, shortDate, slotTitle, spotsLeftSentence, topTitle } from "./format.js";
import {
  canRemove,
  countedCourts,
  displayName,
  firstFreeCourt,
  isLate,
  matchPhase,
  myGuests,
  myState,
  summarize,
  takerLabel,
  whoTakesSpot,
} from "./matchLogic.js";
import { lateDropMessage, shareMessage, whatsAppHref } from "./messages.js";
import { safeNext } from "./nextPath.js";
import { pickNextEvent } from "./pickNextEvent.js";

// Miércoles 21/10/2026, 21:00 hora local.
const WED = new Date(2026, 9, 21, 21, 0).toISOString();

const court = (id, over = {}) => ({
  court_id: id,
  name: `Cancha ${id}`,
  capacity: 10,
  occupied: 0,
  available: 10,
  is_open: true,
  is_pseudo: false,
  players: [],
  ...over,
});

describe("format", () => {
  it("fechas y horas del copy (§7.0)", () => {
    expect(shortDate(WED)).toBe("Mié 21/10");
    expect(hourLabel(WED)).toBe("21 hs");
    expect(clock(WED)).toBe("21:00");
    expect(topTitle(WED)).toBe("Mié 21/10 · 21 hs");
    expect(slotTitle(WED)).toBe("Miércoles 21 hs");
    expect(hourLabel(new Date(2026, 9, 21, 20, 30))).toBe("20:30 hs");
    // El formato con espacio que manda el backend.
    expect(shortDate("2026-10-21 21:00:00")).toBe("Mié 21/10");
  });

  it("ordinales, lugares y canchas", () => {
    expect(ordinal(2)).toBe("2.º");
    expect(spotsLeftSentence(1)).toBe("Queda 1 lugar");
    expect(spotsLeftSentence(6)).toBe("Quedan 6 lugares");
    expect(courtPhrase("Cancha 1")).toBe("la Cancha 1");
    expect(courtPhrase("cancha 13")).toBe("la cancha 13");
    expect(courtPhrase("Techada")).toBe("Techada");
  });
});

describe("matchLogic", () => {
  it("los lugares no cuentan las pseudo-canchas ni las cerradas", () => {
    const courts = [
      court("1", { occupied: 8, available: 2 }),
      court("2", { occupied: 10, available: 0 }),
      court("3", { is_open: false, occupied: 4, available: 6 }),
      court("s", { name: "Suplentes", is_pseudo: true, available: 10 }),
    ];
    expect(countedCourts(courts).map((c) => c.court_id)).toEqual(["1", "2", "3"]);
    expect(summarize(courts)).toEqual({ occupied: 22, capacity: 30, free: 2, full: false, courtCount: 3, openCount: 2 });
    expect(firstFreeCourt(courts).court_id).toBe("1");
    // Solo pseudo-canchas: cuentan.
    expect(summarize([court("s", { is_pseudo: true, occupied: 3, available: 7 })]).free).toBe(7);
  });

  it("mi estado y quién toma el lugar", () => {
    const c1 = court("1", { occupied: 10, available: 0 });
    const data = {
      courts: [c1],
      waitlist: [{ registration_id: "w1", type: "USER", name: "Juan Pérez" }],
      viewer: { user_id: "me", registration: { registration_id: "r1", status: "CONFIRMED", court_id: "1" } },
    };
    expect(myState(data)).toMatchObject({ kind: "confirmed", court: c1, registrationId: "r1" });
    expect(takerLabel(whoTakesSpot(data, c1, "r1"))).toBe("Juan");
    // Con la cancha cerrada nadie entra (como promote_first_waitlist).
    expect(whoTakesSpot(data, { ...c1, is_open: false }, "r1")).toBeNull();
    const waiting = { ...data, viewer: { registration: { registration_id: "w1", status: "WAITLIST", waitlist_position: 1 } } };
    expect(myState(waiting)).toEqual({ kind: "waitlist", registrationId: "w1", position: 1 });
    expect(myState({ viewer: { registration: null } })).toEqual({ kind: "none" });
    expect(takerLabel({ type: "GUEST", name: "Fede", created_by_name: "Nico Gómez" })).toBe("Fede (invitado de Nico)");
  });

  it("a menos de 24 h", () => {
    const now = new Date(2026, 9, 20, 21, 30).getTime();
    expect(isLate(WED, now)).toBe(true);
    expect(isLate(WED, new Date(2026, 9, 19, 21, 0).getTime())).toBe(false);
    expect(isLate(WED, new Date(2026, 9, 21, 22, 0).getTime())).toBe(true);
  });

  it("nombres cortos", () => {
    expect(displayName("Juan Martín Pérez")).toBe("Juan P.");
    expect(displayName("Juan")).toBe("Juan");
    expect(displayName("Maximilianoooooooooooo Ruiz").length).toBeLessThanOrEqual(21);
  });

  it("quién puede sacar a quién", () => {
    const c1 = court("1");
    const data = { viewer: { user_id: "me", captain_court_ids: ["1"], is_event_captain: false } };
    const other = { type: "USER", user_id: "u2" };
    const me = { type: "USER", user_id: "me" };
    const myGuest = { type: "GUEST", created_by_user_id: "me" };
    expect(canRemove(me, c1, data, ["*"])).toBe(false);
    expect(canRemove(other, c1, data, ["registrations.manage"])).toBe(true);
    expect(canRemove(other, c1, data, [])).toBe(true); // capitán de esa cancha
    expect(canRemove(other, court("2"), data, [])).toBe(false);
    expect(canRemove(myGuest, court("2"), data, [])).toBe(true);
  });

  it("mis invitados y la fase", () => {
    const c1 = court("1", { players: [{ registration_id: "g1", type: "GUEST", created_by_user_id: "me", name: "Fede" }] });
    const data = {
      courts: [c1],
      waitlist: [{ registration_id: "g2", type: "GUEST", created_by_user_id: "me", name: "Lu" }],
      viewer: { user_id: "me" },
    };
    expect(myGuests(data).map((g) => [g.registration_id, g.court?.court_id || null])).toEqual([["g1", "1"], ["g2", null]]);
    const s = summarize([c1]);
    expect(matchPhase({ status: "OPEN" }, s)).toBe("open");
    expect(matchPhase({ status: "OPEN" }, { ...s, full: true })).toBe("full");
    expect(matchPhase({ status: "CLOSED" }, s)).toBe("closed");
    expect(matchPhase({ status: "FINALIZED" }, s)).toBe("played");
    // Sin canchas todavía, o con todas cerradas: no es "Completo" (anotarse daría error).
    expect(matchPhase({ status: "OPEN" }, summarize([]))).toBe("empty");
    expect(matchPhase({ status: "OPEN" }, summarize([court("1", { is_open: false })]))).toBe("closed");
  });
});

describe("messages (§7.7)", () => {
  const event = { starts_at: WED, location_name: "Club Norte" };
  const link = "https://app.test/p/abc";

  it("compartir con los lugares por cancha, sin pseudo-canchas ni emojis", () => {
    const courts = [
      court("1", { occupied: 7, available: 3 }),
      court("2", { occupied: 10, available: 0 }),
      court("s", { name: "Suplentes", is_pseudo: true }),
    ];
    expect(shareMessage(event, courts, link)).toBe(
      "*Miércoles 21 hs* · Club Norte\nMié 21/10 · 21:00\nCancha 1: quedan 3 · Cancha 2: completa\n" +
        "Anotate desde la app: https://app.test/p/abc"
    );
    expect(shareMessage(event, [court("1", { occupied: 10, available: 0 })], link)).toBe(
      "*Miércoles 21 hs* · Club Norte\nMié 21/10 · 21:00\nPartido completo, anotate en la espera: https://app.test/p/abc"
    );
    expect(shareMessage(event, courts, link)).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("baja a menos de 24 h", () => {
    expect(lateDropMessage(event, link, "Juan")).toBe(
      "Me bajo del *Miércoles 21 hs*. Entra Juan desde la espera: https://app.test/p/abc"
    );
    expect(lateDropMessage(event, link, "")).toBe("Me bajo del *Miércoles 21 hs*. Se liberó un lugar: https://app.test/p/abc");
    expect(whatsAppHref("a b")).toBe("https://wa.me/?text=a%20b");
  });
});

describe("rutas", () => {
  it("?next= solo acepta un link de partido", () => {
    const id = "3f1b2c4d-1111-4222-8333-444455556666";
    expect(safeNext(`/p/${id}`)).toBe(`/p/${id}`);
    expect(safeNext(`/p/${id}?sheet=compartir`)).toBe(`/p/${id}?sheet=compartir`);
    for (const bad of ["//evil.com", "https://evil.com/p/" + id, "/admin", "/p/abc", "/p/" + id + "/x", null]) {
      expect(safeNext(bad)).toBeNull();
    }
  });

  it("el próximo partido", () => {
    const now = new Date(2026, 9, 21, 12, 0).getTime();
    const evts = [
      { id: "past", starts_at: new Date(2026, 9, 14, 21).toISOString() },
      { id: "later", starts_at: new Date(2026, 9, 28, 21).toISOString() },
      { id: "soon", starts_at: WED },
    ];
    expect(pickNextEvent(evts, now).id).toBe("soon");
    expect(pickNextEvent([evts[0]], now).id).toBe("past");
    expect(pickNextEvent([], now)).toBeNull();
  });
});
