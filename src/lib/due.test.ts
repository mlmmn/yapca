import { describe, expect, test } from "vitest";
import { findNextUpcoming, isDueOn, selectDueRecords } from "./due";

const TODAY = "2024-01-01";
const DUE_RECORDS = [
  { id: "overdue-by-30", name: "Monstera", next_due_on: "2023-12-02" },
  { id: "overdue-by-1", name: "Ficus", next_due_on: "2023-12-31" },
  { id: "due-today", name: "Calathea", next_due_on: "2024-01-01" },
  { id: "due-tomorrow", name: "Aloe", next_due_on: "2024-01-02" },
] as const;

describe("isDueOn", () => {
  test.each([
    ["due today", "2024-01-01", true],
    ["overdue by one day, across the year boundary", "2023-12-31", true],
    ["overdue by thirty days", "2023-12-02", true],
    ["due tomorrow", "2024-01-02", false],
  ] as const)("%s (%s) → returns %s", (_description, nextDueOn, expectedDue) => {
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
  test("returns the earliest record after today", () => {
    const nextUpcoming = findNextUpcoming([...DUE_RECORDS], TODAY);

    expect(nextUpcoming).toEqual({ id: "due-tomorrow", name: "Aloe", next_due_on: "2024-01-02" });
  });

  test("returns the earliest upcoming record even when the input is unsorted", () => {
    const unsortedRecords = [
      { id: "due-next-month", name: "Yucca", next_due_on: "2024-02-01" },
      { id: "due-today", name: "Calathea", next_due_on: "2024-01-01" },
      { id: "due-tomorrow", name: "Aloe", next_due_on: "2024-01-02" },
    ];

    const nextUpcoming = findNextUpcoming(unsortedRecords, TODAY);

    expect(nextUpcoming).toEqual({ id: "due-tomorrow", name: "Aloe", next_due_on: "2024-01-02" });
  });

  test("breaks a same-day tie on name", () => {
    const tiedRecords = [
      { id: "zebra", name: "Zebra plant", next_due_on: "2024-01-02" },
      { id: "aloe", name: "Aloe", next_due_on: "2024-01-02" },
    ];

    const nextUpcoming = findNextUpcoming(tiedRecords, TODAY);

    expect(nextUpcoming).toEqual({ id: "aloe", name: "Aloe", next_due_on: "2024-01-02" });
  });

  test("returns null when every record is due", () => {
    const nextUpcoming = findNextUpcoming(DUE_RECORDS.slice(0, 3), TODAY);

    expect(nextUpcoming).toBeNull();
  });
});
