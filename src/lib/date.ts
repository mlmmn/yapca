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
