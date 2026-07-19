const DATE_STRING_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Guards a client-supplied date string as a real, well-formed `YYYY-MM-DD` calendar date. */
export function isValidDateString(value: string): boolean {
  if (!DATE_STRING_PATTERN.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const epochMs = Date.UTC(year, month - 1, day);
  const parsed = new Date(epochMs);

  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function toEpochDay(dateString: string): number {
  const [year, month, day] = dateString.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

function fromEpochDay(epochDay: number): string {
  const date = new Date(epochDay * MS_PER_DAY);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Computes the next due calendar date via UTC epoch-day addition — never a
 * local-time `Date` — so the result cannot drift across a DST boundary.
 */
export function nextDue(fromDate: string, intervalDays: number): string {
  return fromEpochDay(toEpochDay(fromDate) + intervalDays);
}
