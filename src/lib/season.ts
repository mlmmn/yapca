import { isValidDateString } from "./date";

export type Season = "growing" | "dormancy";

function validateSeasonDate(dateString: string): void {
  if (!isValidDateString(dateString)) {
    throw new RangeError("Season requires a valid YYYY-MM-DD date");
  }
}

export function getSeason(dateString: string): Season {
  validateSeasonDate(dateString);

  const month = Number(dateString.slice(5, 7));
  const growing = month >= 3 && month <= 10;

  return growing ? "growing" : "dormancy";
}

export function selectSeasonInterval(
  dateString: string,
  growingIntervalDays: number,
  dormancyIntervalDays: number,
): number {
  const season = getSeason(dateString);

  return season === "growing" ? growingIntervalDays : dormancyIntervalDays;
}

export function getSeasonLabel(season: Season): string {
  return season === "growing" ? "Growing season" : "Dormancy season";
}
