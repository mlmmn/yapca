import { describe, expect, it } from "vitest";
import { SEASON_BOUNDARIES } from "@/lib/season-boundaries.fixture";
import { getSeason, getSeasonLabel, getShortSeasonLabel, selectSeasonInterval } from "./season";

describe("season", () => {
  it.each(SEASON_BOUNDARIES)("selects $season for $date ($note)", ({ date, season }) => {
    expect(getSeason(date)).toBe(season);
  });

  it("selects distinguishable intervals for each season", () => {
    expect(selectSeasonInterval("2024-03-01", 7, 30)).toBe(7);
    expect(selectSeasonInterval("2024-11-01", 7, 30)).toBe(30);
  });

  it("formats season labels", () => {
    expect(getSeasonLabel("growing")).toBe("Growing season");
    expect(getShortSeasonLabel("growing")).toBe("Growing");
    expect(getSeasonLabel("dormancy")).toBe("Dormancy season");
    expect(getShortSeasonLabel("dormancy")).toBe("Dormancy");
  });

  it("rejects invalid dates", () => {
    expect(() => getSeason("2024-02-30")).toThrow(RangeError);
  });
});
