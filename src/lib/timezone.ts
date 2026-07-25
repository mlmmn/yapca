// This cookie name and the "en-US" 2-digit day formatting in `getDayFormatter` are duplicated
// verbatim by the inline head script in `src/layouts/layout.astro`, which cannot import from here.
// Drift makes that script's `data-today` comparison fail forever, costing every visitor an extra
// document request per session. Change both together.
export const TIME_ZONE_COOKIE = "tz";

const TIME_ZONE_PATTERN = /^[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)*$/;
// Constructing an Intl.DateTimeFormat is the expensive half of formatting, and the
// midnight-rollover search formats the same zone dozens of times per call. Only
// successfully constructed formatters are cached, so untrusted input cannot grow the map.
const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function getDayFormatter(timeZone: string): Intl.DateTimeFormat | null {
  if (timeZone.length === 0 || timeZone.length > 100 || !TIME_ZONE_PATTERN.test(timeZone)) {
    return null;
  }

  const cached = dayFormatters.get(timeZone);

  if (cached) {
    return cached;
  }

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    dayFormatters.set(timeZone, formatter);

    return formatter;
  } catch {
    return null;
  }
}

function formatDay(formatter: Intl.DateTimeFormat, now: Date): string {
  const parts = formatter.formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Unable to resolve a calendar date");
  }

  return `${year}-${month}-${day}`;
}

export function isSupportedTimeZone(value: string): boolean {
  return getDayFormatter(value) !== null;
}

export function getTodayInTimeZone(timeZone: string, now = new Date()): string {
  const formatter = getDayFormatter(timeZone);

  if (!formatter) {
    throw new RangeError(`Unsupported time zone: ${timeZone}`);
  }

  return formatDay(formatter, now);
}

export function getMillisecondsUntilNextMidnight(timeZone: string, now = new Date()): number {
  const formatter = getDayFormatter(timeZone);

  if (!formatter) {
    throw new RangeError(`Unsupported time zone: ${timeZone}`);
  }

  const today = formatDay(formatter, now);
  let lowerBound = now.getTime();
  let upperBound = lowerBound + 36 * 60 * 60 * 1000;

  while (formatDay(formatter, new Date(upperBound)) === today) {
    upperBound += 24 * 60 * 60 * 1000;
  }

  // 28 halvings narrow the 36 h seed window (~1.3e8 ms) to sub-millisecond precision.
  for (let iteration = 0; iteration < 28; iteration += 1) {
    const midpoint = Math.floor((lowerBound + upperBound) / 2);

    if (formatDay(formatter, new Date(midpoint)) === today) {
      lowerBound = midpoint;
    } else {
      upperBound = midpoint;
    }
  }

  return Math.max(1000, upperBound - now.getTime());
}
