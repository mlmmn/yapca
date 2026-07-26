import type { Season } from "./season";

// The extra rows mirror the SQL boundary cases and guard a possible future
// day-granular rule, although the current rule only branches at March 1 and
// November 1 because it is month-granular.
export const SEASON_BOUNDARIES = [
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
