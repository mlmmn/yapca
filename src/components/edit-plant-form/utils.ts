import { formatShortDate, toEpochDay } from "@/lib/date";
import { resolveScheduleChange } from "@/lib/schedule";
import { getSeasonLabel } from "@/lib/season";

type PreviewInput = {
  today: string | null;
  oldNextDue: string;
  oldGrowingIntervalDays: number;
  oldDormancyIntervalDays: number;
  newGrowingIntervalDays: number | null;
  newDormancyIntervalDays: number | null;
};

export type SaveErrorState = "conflict" | "generic";

export const SAVE_ERROR_MESSAGES: Record<SaveErrorState, string> = {
  conflict: "This plant changed elsewhere. Reload it before saving again.",
  generic: "We couldn't save these changes. Check your connection and try again.",
};

export function getSaveErrorState(code: string | undefined): SaveErrorState | "not-found" {
  if (code === "CONFLICT") {
    return "conflict";
  }

  if (code === "NOT_FOUND") {
    return "not-found";
  }

  return "generic";
}

function getValidInterval(value: number | null): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 365;
}

export function buildSchedulePreview(input: PreviewInput): string {
  const oldDueLabel = formatShortDate(input.oldNextDue);

  if (!getValidInterval(input.newGrowingIntervalDays) || !getValidInterval(input.newDormancyIntervalDays)) {
    return "Enter valid intervals to preview the next due date.";
  }

  if (input.today === null) {
    return `Next due is ${oldDueLabel}. The applicable season will be resolved when you save.`;
  }

  const scheduleChange = resolveScheduleChange({
    activeDay: input.today,
    oldNextDue: input.oldNextDue,
    oldGrowingIntervalDays: input.oldGrowingIntervalDays,
    oldDormancyIntervalDays: input.oldDormancyIntervalDays,
    newGrowingIntervalDays: input.newGrowingIntervalDays,
    newDormancyIntervalDays: input.newDormancyIntervalDays,
  });
  const inactiveChanged =
    scheduleChange.season === "growing"
      ? input.oldDormancyIntervalDays !== input.newDormancyIntervalDays
      : input.oldGrowingIntervalDays !== input.newGrowingIntervalDays;
  const seasonLabel = getSeasonLabel(scheduleChange.season);

  if (scheduleChange.deltaDays !== 0) {
    const oldDate = formatShortDate(scheduleChange.oldNextDue);
    const newDate = formatShortDate(scheduleChange.newNextDue);
    const dateDifference = toEpochDay(input.today) - toEpochDay(scheduleChange.newNextDue);
    const activeSentence = `${seasonLabel} is active. Next due will move from ${oldDate} to ${newDate}.`;

    if (dateDifference === 0) {
      return `${activeSentence} The plant will be due today.`;
    }

    if (dateDifference > 0) {
      const overdueDays = dateDifference === 1 ? "1 day" : `${dateDifference} days`;

      return `${activeSentence} The plant will be ${overdueDays} overdue.`;
    }

    return activeSentence;
  }

  if (inactiveChanged) {
    const inactiveSeasonLabel = scheduleChange.season === "growing" ? "Dormancy" : "Growing";

    return `${inactiveSeasonLabel} interval saved. ${seasonLabel} is active, so the next due date stays ${oldDueLabel}.`;
  }

  return `The next due date stays ${oldDueLabel} until the active schedule changes.`;
}
