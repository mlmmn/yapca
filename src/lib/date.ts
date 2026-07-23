const DATE_STRING_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

export function todayLocalDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function msUntilNextLocalMidnight(): number {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);

  return nextMidnight.getTime() - now.getTime();
}

export function parseLocalDateString(dateString: string): Date {
  const [year, month, day] = dateString.split("-").map(Number);

  return new Date(year, month - 1, day);
}

export function formatShortDate(dateString: string): string {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(
    parseLocalDateString(dateString),
  );
}

export function formatDueLabel(dateString: string, today: string): string {
  return dateString === today ? "Due today" : `Due ${formatShortDate(dateString)}`;
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
