import { fromEpochDay, toEpochDay } from "./date";
import { getSeason, type Season, selectSeasonInterval } from "./season";

export type ScheduleChange = {
  season: Season;
  oldNextDue: string;
  newNextDue: string;
  deltaDays: number;
};

export function resolveScheduleChange(input: {
  activeDay: string;
  oldNextDue: string;
  oldGrowingIntervalDays: number;
  oldDormancyIntervalDays: number;
  newGrowingIntervalDays: number;
  newDormancyIntervalDays: number;
}): ScheduleChange {
  const season = getSeason(input.activeDay);
  const oldActiveInterval = selectSeasonInterval(
    input.activeDay,
    input.oldGrowingIntervalDays,
    input.oldDormancyIntervalDays,
  );
  const newActiveInterval = selectSeasonInterval(
    input.activeDay,
    input.newGrowingIntervalDays,
    input.newDormancyIntervalDays,
  );
  const deltaDays = newActiveInterval - oldActiveInterval;

  return {
    season,
    oldNextDue: input.oldNextDue,
    newNextDue: fromEpochDay(toEpochDay(input.oldNextDue) + deltaDays),
    deltaDays,
  };
}
