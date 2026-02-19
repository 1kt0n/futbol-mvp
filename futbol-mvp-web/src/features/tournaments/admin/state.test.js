import { describe, expect, it } from "vitest";
import { computeDraftStage } from "./state.js";

describe("computeDraftStage", () => {
  it("returns publish when tournament is not draft", () => {
    expect(computeDraftStage({ status: "LIVE" }, [], [])).toBe("publish");
  });

  it("returns teams when config ready but teams incomplete", () => {
    const t = { status: "DRAFT", title: "Copa", minutes_per_match: 20, teams_count: 4 };
    expect(computeDraftStage(t, [{ id: "a" }], [])).toBe("teams");
  });

  it("returns fixture when teams complete but no matches", () => {
    const t = { status: "DRAFT", title: "Copa", minutes_per_match: 20, teams_count: 2 };
    expect(computeDraftStage(t, [{ id: "a" }, { id: "b" }], [])).toBe("fixture");
  });

  it("returns publish when everything is ready", () => {
    const t = { status: "DRAFT", title: "Copa", minutes_per_match: 20, teams_count: 2 };
    const teams = [{ id: "a" }, { id: "b" }];
    const matches = [{ id: "m1" }];
    expect(computeDraftStage(t, teams, matches)).toBe("publish");
  });
});

