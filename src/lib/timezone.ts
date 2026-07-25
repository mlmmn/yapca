export const TIME_ZONE_COOKIE = "tz";

const TIME_ZONE_PATTERN = /^[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)*$/;

export function isSupportedTimeZone(value: string): boolean {
  if (value.length === 0 || value.length > 100 || !TIME_ZONE_PATTERN.test(value)) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });

    return true;
  } catch {
    return false;
  }
}

export function getTodayInTimeZone(timeZone: string, now = new Date()): string {
  if (!isSupportedTimeZone(timeZone)) {
    throw new RangeError(`Unsupported time zone: ${timeZone}`);
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Unable to resolve a calendar date");
  }

  return `${year}-${month}-${day}`;
}

export function getBrowserTimeZone(): string | null {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return isSupportedTimeZone(timeZone) ? timeZone : null;
}

export function getMillisecondsUntilNextMidnight(timeZone: string, now = new Date()): number {
  const today = getTodayInTimeZone(timeZone, now);
  let lowerBound = now.getTime();
  let upperBound = lowerBound + 36 * 60 * 60 * 1000;

  while (getTodayInTimeZone(timeZone, new Date(upperBound)) === today) {
    upperBound += 24 * 60 * 60 * 1000;
  }

  for (let iteration = 0; iteration < 42; iteration += 1) {
    const midpoint = Math.floor((lowerBound + upperBound) / 2);

    if (getTodayInTimeZone(timeZone, new Date(midpoint)) === today) {
      lowerBound = midpoint;
    } else {
      upperBound = midpoint;
    }
  }

  return Math.max(1000, upperBound - now.getTime());
}
