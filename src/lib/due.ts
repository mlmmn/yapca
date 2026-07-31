import { compareDueRecords, type DueRecord } from "./date";

// Narrower than `DueRecord`: the two predicates below only ever read the due date, so they
// stay usable by callers that carry no `name` (e.g. optimistic rows).
type DueDated = {
  next_due_on: string;
};

export function isDueOn(record: DueDated, today: string): boolean {
  return record.next_due_on <= today;
}

export function selectDueRecords<T extends DueDated>(records: T[], today: string): T[] {
  return records.filter((record) => isDueOn(record, today));
}

// Reduces with `compareDueRecords` rather than taking the first non-due element, so the answer
// does not depend on the caller's array order. `find` was correct only while every caller
// happened to pass sorted input — a precondition the name does not advertise and nothing enforced.
export function findNextUpcoming<T extends DueRecord>(records: T[], today: string): T | null {
  return records.reduce<T | null>((earliest, record) => {
    if (isDueOn(record, today)) {
      return earliest;
    }

    if (earliest === null) {
      return record;
    }

    return compareDueRecords(record, earliest) < 0 ? record : earliest;
  }, null);
}
