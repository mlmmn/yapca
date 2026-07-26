import { describe, expect, test } from "vitest";
import { isValidDateString, nextDue } from "./interval";

describe("nextDue", () => {
  test.each([
    ["2026-01-31", 1, "2026-02-01"],
    ["2024-02-28", 1, "2024-02-29"],
    ["2024-12-31", 1, "2025-01-01"],
    ["2026-01-01", 365, "2027-01-01"],
    // Regression guard for a local-time rewrite. Must be a fall-back date: a
    // 25-hour day makes naive millisecond addition land back on the same
    // calendar day. Spring-forward would overshoot onto the correct date and
    // pass. Only fails on the America/New_York leg; UTC has no transition.
    ["2026-11-01", 1, "2026-11-02"],
  ] as const)("adds %s calendar days", (fromDate, intervalDays, expectedDate) => {
    expect(nextDue(fromDate, intervalDays)).toBe(expectedDate);
  });

  // Deliberately permissive: `resolveScheduleChange` relies on negative
  // intervals to shift a due date backwards. Pinned so it is not "fixed" into a
  // guard that would break the no-clamping rule in schedule.ts.
  test("accepts zero and negative intervals", () => {
    expect(nextDue("2026-03-08", 0)).toBe("2026-03-08");
    expect(nextDue("2026-03-08", -1)).toBe("2026-03-07");
    expect(nextDue("2026-03-01", -1)).toBe("2026-02-28");
  });
});

// The re-export is part of this module's public surface; without a test an
// accidental removal would surface only at the call sites.
describe("isValidDateString re-export", () => {
  test("resolves through ./interval", () => {
    expect(isValidDateString("2028-02-29")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
  });
});
