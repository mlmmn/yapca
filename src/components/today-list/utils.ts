import { formatShortDate } from "@/lib/date";
import type { ActionKind } from "./types";

export const ANIMATION_MS = 190;

const OVERDUE_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const OVERDUE_DATE_WITH_YEAR_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function getActionLabel(kind: ActionKind): string {
  return kind === "watered" ? "Watered" : "Postpone 2 days";
}

export function getSuccessMessage(kind: ActionKind, name: string, dueDate: string): string {
  const formatted = formatShortDate(dueDate);

  return kind === "watered" ? `${name} marked watered · Next due ${formatted}` : `${name} postponed · Due ${formatted}`;
}

export function getFailureMessage(kind: ActionKind, name: string): string {
  return kind === "watered" ? `Couldn't mark ${name} watered. Try again.` : `Couldn't postpone ${name}. Try again.`;
}

export function getUndoBlockedMessage(name: string): string {
  return `Couldn't undo ${name}. Undo the newer action first.`;
}

export function getUndoScheduleMismatchMessage(name: string): string {
  return `Couldn't undo ${name} safely after a schedule change.`;
}

export function formatOverdueDate(dateString: string, today: string): string {
  const [dueYear, dueMonth, dueDay] = dateString.split("-").map(Number);
  const [todayYear] = today.split("-").map(Number);
  const date = new Date(dueYear, dueMonth - 1, dueDay);

  if (dueYear === todayYear) {
    return OVERDUE_DATE_FORMATTER.format(date);
  }

  return OVERDUE_DATE_WITH_YEAR_FORMATTER.format(date);
}
