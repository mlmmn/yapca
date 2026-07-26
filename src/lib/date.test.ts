import { describe, expect, test } from "vitest";
import {
  classifyDueStatus,
  compareDueRecords,
  formatDueLabel,
  formatIntervalLabel,
  formatShortDate,
  fromEpochDay,
  isPlausibleClientDate,
  isValidDateString,
  parseLocalDateString,
  toEpochDay,
} from "./date";

// The round-trip below only pins symmetry: a sign or offset error shared by both
// functions cancels out. Each direction therefore also carries an absolute anchor.
describe("toEpochDay", () => {
  test("anchors the epoch-day scale to 1970-01-01", () => {
    expect(toEpochDay("1970-01-01")).toBe(0);
    expect(toEpochDay("1970-01-02")).toBe(1);
    expect(toEpochDay("1969-12-31")).toBe(-1);
  });
});

describe("fromEpochDay", () => {
  test("anchors epoch day zero to 1970-01-01", () => {
    expect(fromEpochDay(0)).toBe("1970-01-01");
  });

  test.each(["1970-01-01", "2024-02-29", "2025-01-01"])("round-trips %s back through toEpochDay", (dateString) => {
    const epochDay = toEpochDay(dateString);

    expect(fromEpochDay(epochDay)).toBe(dateString);
  });
});

describe("isValidDateString", () => {
  test("validates calendar dates rather than only their shape", () => {
    expect(isValidDateString("2028-02-29")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2026-13-01")).toBe(false);
    expect(isValidDateString("2026-2-01")).toBe(false);
  });
});

describe("isPlausibleClientDate", () => {
  test.each([
    ["2026-03-01", "2026-03-01", true],
    ["2026-02-28", "2026-03-01", true],
    ["2026-03-02", "2026-03-01", true],
    ["2026-02-27", "2026-03-01", false],
    ["2026-03-03", "2026-03-01", false],
    ["2025-12-31", "2026-01-01", true],
    ["2026-01-01", "2025-12-31", true],
    ["2024-02-29", "2024-03-01", true],
    ["2024-03-02", "2024-02-29", false],
    ["2026-02-30", "2026-03-01", false],
    ["not-a-date", "2026-03-01", false],
    ["2026-03-01", "not-a-date", false],
  ])("accepts %s relative to %s: %s", (candidate, utcToday, plausible) => {
    expect(isPlausibleClientDate(candidate, utcToday)).toBe(plausible);
  });
});

describe("parseLocalDateString", () => {
  // 2026-03-08 is the America/New_York spring-forward date: this is the one
  // function in the module that builds an ambient-local Date, so it is the only
  // place a parse could drift by a day. Inert under TZ=UTC by construction; it
  // earns its keep on the America/New_York test leg.
  test("names the same calendar day it was given", () => {
    const localDate = parseLocalDateString("2026-03-08");

    expect(localDate.getFullYear()).toBe(2026);
    expect(localDate.getMonth()).toBe(2);
    expect(localDate.getDate()).toBe(8);
  });
});

describe("formatShortDate", () => {
  test("names the same calendar day it was given", () => {
    expect(formatShortDate("2026-03-08")).toBe("8 Mar");
  });
});

describe("formatDueLabel", () => {
  test("says 'today' only when the due date is today", () => {
    expect(formatDueLabel("2026-03-08", null)).toBe("Due 8 Mar");
    expect(formatDueLabel("2026-03-08", "2026-03-08")).toBe("Due today");
    expect(formatDueLabel("2026-03-08", "2026-03-07")).toBe("Due 8 Mar");
  });
});

describe("formatIntervalLabel", () => {
  test("formats interval labels in singular and plural", () => {
    expect(formatIntervalLabel(1)).toBe("Every 1 day");
    expect(formatIntervalLabel(2)).toBe("Every 2 days");
  });
});

describe("compareDueRecords", () => {
  test("orders due records by date and then name", () => {
    const first = { next_due_on: "2026-03-08", name: "Fern" };
    const second = { next_due_on: "2026-03-08", name: "Aloe" };
    const later = { next_due_on: "2026-03-09", name: "Aloe" };

    expect(compareDueRecords(first, second)).toBeGreaterThan(0);
    expect(compareDueRecords(second, later)).toBeLessThan(0);
  });

  // Without the tie case, a swapped localeCompare plus a sign flip survives.
  test("treats identical date and name as equal", () => {
    const record = { next_due_on: "2026-03-08", name: "Aloe" };

    expect(compareDueRecords(record, { ...record })).toBe(0);
  });
});

describe("classifyDueStatus", () => {
  test.each([
    ["2026-03-08", "2026-03-08", "due-today"],
    ["2026-03-07", "2026-03-08", "overdue"],
    ["2026-03-06", "2026-03-08", "overdue"],
    ["2026-03-05", "2026-03-08", "overdue-strong"],
    ["2026-02-06", "2026-03-08", "overdue-strong"],
  ] as const)("classifies %s relative to %s", (dueDate, today, status) => {
    expect(classifyDueStatus(dueDate, today)).toBe(status);
  });

  test("rejects future and invalid due dates", () => {
    expect(() => classifyDueStatus("2026-03-09", "2026-03-08")).toThrow(RangeError);
    expect(() => classifyDueStatus("2026-02-30", "2026-03-08")).toThrow(RangeError);
    expect(() => classifyDueStatus("2026-03-08", "bad-date")).toThrow(RangeError);
  });
});
