import { toEpochDay, fromEpochDay } from "./date";

/**
 * Computes the next due calendar date via UTC epoch-day addition — never a
 * local-time `Date` — so the result cannot drift across a DST boundary.
 */
export function nextDue(fromDate: string, intervalDays: number): string {
  return fromEpochDay(toEpochDay(fromDate) + intervalDays);
}

export { isValidDateString } from "./date";
