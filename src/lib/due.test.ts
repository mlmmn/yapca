import { describe, expect, test } from "vitest";
import { findNextUpcoming, isDueOn, selectDueRecords } from "./due";

const TODAY = "2024-01-01";
const DUE_RECORDS = [
  { id: "overdue-by-30", next_due_on: "2023-12-02" },
  { id: "overdue-by-1", next_due_on: "2023-12-31" },
  { id: "due-today", next_due_on: "2024-01-01" },
  { id: "due-tomorrow", next_due_on: "2024-01-02" },
] as const;

describe("isDueOn", () => {
  test.each([
    ["due today", "2024-01-01", true],
    ["overdue by one day", "2023-12-31", true],
    ["overdue by thirty days", "2023-12-02", true],
    ["due tomorrow", "2024-01-02", false],
    ["across a year boundary", "2023-12-31", true],
  ] as const)("returns %s for %s", (_description, nextDueOn, expectedDue) => {
    expect(isDueOn({ next_due_on: nextDueOn }, TODAY)).toBe(expectedDue);
  });
});

describe("selectDueRecords", () => {
  test("returns the complete due and overdue set", () => {
    const dueRecords = selectDueRecords([...DUE_RECORDS], TODAY);

    expect(dueRecords.map((record) => record.id)).toEqual(["overdue-by-30", "overdue-by-1", "due-today"]);
  });
});

describe("findNextUpcoming", () => {
  test("returns the first record after today", () => {
    const nextUpcoming = findNextUpcoming([...DUE_RECORDS], TODAY);

    expect(nextUpcoming).toEqual({ id: "due-tomorrow", next_due_on: "2024-01-02" });
  });

  test("returns null when every record is due", () => {
    const nextUpcoming = findNextUpcoming(DUE_RECORDS.slice(0, 3), TODAY);

    expect(nextUpcoming).toBeNull();
  });
});
