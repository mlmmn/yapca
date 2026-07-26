import { describe, expect, test } from "vitest";
// Deliberately imported through the `@/` alias: this is the suite's only aliased
// import, so it is what keeps the `vite-tsconfig-paths` wiring covered. If the
// plugin is ever dropped from vitest.config.ts, this fails loudly.
import { getSeason, getSeasonLabel, getShortSeasonLabel, selectSeasonInterval, type Season } from "@/lib/season";

// The authoritative TypeScript season-boundary table. Every date asserted by
// supabase/tests/season-aware-intervals.sql appears here verbatim; test-plan
// Phase 2 must reconcile the SQL script against this table — by lifting it into
// a shared harness or deriving the SQL cases from it — rather than adding a
// third copy. If that phase needs it outside this file, move it then.
//
// The extra rows mirror the SQL boundary cases and guard a possible future
// day-granular rule, although the current rule only branches at March 1 and
// November 1 because it is month-granular.
const SEASON_BOUNDARIES = [
  { date: "2024-02-27", season: "dormancy", note: "late winter" },
  { date: "2024-02-28", season: "dormancy", note: "day before leap day" },
  { date: "2024-02-29", season: "dormancy", note: "leap day" },
  { date: "2024-03-01", season: "growing", note: "growing season starts" },
  { date: "2024-10-30", season: "growing", note: "day before the final growing day" },
  { date: "2024-10-31", season: "growing", note: "final growing day" },
  { date: "2024-11-01", season: "dormancy", note: "dormancy starts" },
  { date: "2024-12-15", season: "dormancy", note: "mid-dormancy" },
  { date: "2024-12-31", season: "dormancy", note: "year end" },
  { date: "2025-01-01", season: "dormancy", note: "year start" },
  { date: "2025-02-28", season: "dormancy", note: "final winter day" },
  { date: "2025-03-01", season: "growing", note: "growing season starts again" },
] as const satisfies readonly { date: string; season: Season; note: string }[];

describe("getSeason", () => {
  test.each(SEASON_BOUNDARIES)("selects $season for $date ($note)", ({ date, season }) => {
    expect(getSeason(date)).toBe(season);
  });

  test("rejects invalid dates", () => {
    expect(() => getSeason("2024-02-30")).toThrow(RangeError);
  });
});

describe("selectSeasonInterval", () => {
  test("selects distinguishable intervals for each season", () => {
    expect(selectSeasonInterval("2024-03-01", 7, 30)).toBe(7);
    expect(selectSeasonInterval("2024-11-01", 7, 30)).toBe(30);
  });
});

describe("getSeasonLabel", () => {
  test("names both seasons in full", () => {
    expect(getSeasonLabel("growing")).toBe("Growing season");
    expect(getSeasonLabel("dormancy")).toBe("Dormancy season");
  });
});

describe("getShortSeasonLabel", () => {
  test("names both seasons in short form", () => {
    expect(getShortSeasonLabel("growing")).toBe("Growing");
    expect(getShortSeasonLabel("dormancy")).toBe("Dormancy");
  });
});
