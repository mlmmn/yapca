import { describe, expect, it } from "vitest";
import { nextDue } from "./interval";

describe("nextDue", () => {
  it.each([
    ["2026-01-31", 1, "2026-02-01"],
    ["2024-02-28", 1, "2024-02-29"],
    ["2024-12-31", 1, "2025-01-01"],
    ["2026-01-01", 365, "2027-01-01"],
    // Regression guard for a local-time rewrite; its failure requires the
    // America/New_York test leg because UTC has no DST transition.
    ["2026-03-08", 1, "2026-03-09"],
  ] as const)("adds %s calendar days", (fromDate, intervalDays, expectedDate) => {
    expect(nextDue(fromDate, intervalDays)).toBe(expectedDate);
  });
});
