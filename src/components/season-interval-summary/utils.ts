import { formatDueLabel, formatIntervalLabel } from "@/lib/date";
import { getSeason, getShortSeasonLabel, selectSeasonInterval } from "@/lib/season";

export function getFallbackSchedule(growingIntervalDays: number, dormancyIntervalDays: number): string {
  return `Growing: ${formatIntervalLabel(growingIntervalDays)} · Dormancy: ${formatIntervalLabel(dormancyIntervalDays)}`;
}

export function getActiveSchedule(today: string, growingIntervalDays: number, dormancyIntervalDays: number): string {
  const season = getSeason(today);
  const activeInterval = selectSeasonInterval(today, growingIntervalDays, dormancyIntervalDays);

  return `${getShortSeasonLabel(season)} · then ${formatIntervalLabel(activeInterval)}`;
}

export function getFullSchedule(today: string, growingIntervalDays: number, dormancyIntervalDays: number): string {
  const season = getSeason(today);

  return [
    `Growing: ${formatIntervalLabel(growingIntervalDays)}${season === "growing" ? " (active now)" : ""}`,
    `Dormancy: ${formatIntervalLabel(dormancyIntervalDays)}${season === "dormancy" ? " (active now)" : ""}`,
  ].join(" · ");
}

export function getSummaryValues(
  mode: "active" | "full",
  dueDate: string,
  growingIntervalDays: number,
  dormancyIntervalDays: number,
  today: string | null,
): { dueLabel: string; schedule: string } {
  const fallbackSchedule = getFallbackSchedule(growingIntervalDays, dormancyIntervalDays);

  if (today === null) {
    return { dueLabel: formatDueLabel(dueDate, null), schedule: fallbackSchedule };
  }

  return {
    dueLabel: formatDueLabel(dueDate, today),
    schedule:
      mode === "full"
        ? getFullSchedule(today, growingIntervalDays, dormancyIntervalDays)
        : getActiveSchedule(today, growingIntervalDays, dormancyIntervalDays),
  };
}
