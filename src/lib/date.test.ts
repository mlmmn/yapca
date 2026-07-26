import { describe, expect, it } from "vitest";
import {
  classifyDueStatus,
  compareDueRecords,
  formatDueLabel,
  formatIntervalLabel,
  formatShortDate,
  fromEpochDay,
  isValidDateString,
  parseLocalDateString,
  toEpochDay,
} from "./date";

describe("date primitives", () => {
  it.each(["1970-01-01", "2024-02-29", "2025-01-01"])("round-trips %s", (dateString) => {
    const epochDay = toEpochDay(dateString);

    expect(fromEpochDay(epochDay)).toBe(dateString);
  });

  it("validates calendar dates rather than only their shape", () => {
    expect(isValidDateString("2028-02-29")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2026-13-01")).toBe(false);
    expect(isValidDateString("2026-2-01")).toBe(false);
  });

  it("formats dates and due labels", () => {
    const localDate = parseLocalDateString("2026-03-08");

    expect(localDate.getFullYear()).toBe(2026);
    expect(localDate.getMonth()).toBe(2);
    expect(localDate.getDate()).toBe(8);
    expect(formatShortDate("2026-03-08")).toBe("8 Mar");
    expect(formatDueLabel("2026-03-08", null)).toBe("Due 8 Mar");
    expect(formatDueLabel("2026-03-08", "2026-03-08")).toBe("Due today");
    expect(formatDueLabel("2026-03-08", "2026-03-07")).toBe("Due 8 Mar");
  });

  it("formats interval labels in singular and plural", () => {
    expect(formatIntervalLabel(1)).toBe("Every 1 day");
    expect(formatIntervalLabel(2)).toBe("Every 2 days");
  });

  it("orders due records by date and then name", () => {
    const first = { next_due_on: "2026-03-08", name: "Fern" };
    const second = { next_due_on: "2026-03-08", name: "Aloe" };
    const later = { next_due_on: "2026-03-09", name: "Aloe" };

    expect(compareDueRecords(first, second)).toBeGreaterThan(0);
    expect(compareDueRecords(second, later)).toBeLessThan(0);
  });

  it.each([
    ["2026-03-08", "2026-03-08", "due-today"],
    ["2026-03-07", "2026-03-08", "overdue"],
    ["2026-03-06", "2026-03-08", "overdue"],
    ["2026-03-05", "2026-03-08", "overdue-strong"],
    ["2026-02-06", "2026-03-08", "overdue-strong"],
  ] as const)("classifies %s relative to %s", (dueDate, today, status) => {
    expect(classifyDueStatus(dueDate, today)).toBe(status);
  });

  it("rejects future and invalid due dates", () => {
    expect(() => classifyDueStatus("2026-03-09", "2026-03-08")).toThrow(RangeError);
    expect(() => classifyDueStatus("2026-02-30", "2026-03-08")).toThrow(RangeError);
    expect(() => classifyDueStatus("2026-03-08", "bad-date")).toThrow(RangeError);
  });
});
