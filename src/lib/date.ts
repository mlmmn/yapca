const DATE_STRING_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const CLIENT_DATE_ERROR_MESSAGE =
  "The device date could not be reconciled. Check your device clock and try again.";
// Hoisted because SSR calls this once per plant row per request, and constructing an
// Intl.DateTimeFormat is the expensive half of formatting.
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

export function toEpochDay(dateString: string): number {
  const [year, month, day] = dateString.split("-").map(Number);

  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

export function fromEpochDay(epochDay: number): string {
  const date = new Date(epochDay * MS_PER_DAY);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function isValidDateString(value: string): boolean {
  if (!DATE_STRING_PATTERN.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const epochMs = Date.UTC(year, month - 1, day);
  const parsed = new Date(epochMs);

  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function isPlausibleClientDate(candidate: string, utcToday: string): boolean {
  if (!isValidDateString(candidate) || !isValidDateString(utcToday)) {
    return false;
  }

  const dayDifference = Math.abs(toEpochDay(candidate) - toEpochDay(utcToday));

  return dayDifference <= 1;
}

export function parseLocalDateString(dateString: string): Date {
  const [year, month, day] = dateString.split("-").map(Number);

  return new Date(year, month - 1, day);
}

export function formatShortDate(dateString: string): string {
  return SHORT_DATE_FORMATTER.format(parseLocalDateString(dateString));
}

export function formatDueLabel(dateString: string, today: string | null): string {
  return today !== null && dateString === today ? "Due today" : `Due ${formatShortDate(dateString)}`;
}

export function formatIntervalLabel(intervalDays: number): string {
  return `Every ${intervalDays} day${intervalDays === 1 ? "" : "s"}`;
}

export type DueRecord = {
  next_due_on: string;
  name: string;
};

export function compareDueRecords(first: DueRecord, second: DueRecord): number {
  const dueDateOrder = toEpochDay(first.next_due_on) - toEpochDay(second.next_due_on);

  if (dueDateOrder !== 0) {
    return dueDateOrder;
  }

  return first.name.localeCompare(second.name);
}

export type DueStatus = "due-today" | "overdue" | "overdue-strong";

export function classifyDueStatus(dueDate: string, today: string): DueStatus {
  if (!isValidDateString(dueDate) || !isValidDateString(today)) {
    throw new RangeError("Due status requires valid YYYY-MM-DD dates");
  }

  const daysDifference = toEpochDay(today) - toEpochDay(dueDate);

  if (daysDifference < 0) {
    throw new RangeError("Due status cannot classify a future due date");
  }

  if (daysDifference === 0) {
    return "due-today";
  }

  if (daysDifference >= 3) {
    return "overdue-strong";
  }

  return "overdue";
}
