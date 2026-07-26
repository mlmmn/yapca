import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  TIME_ZONE_COOKIE,
  getBrowserRolloverState,
  getNextBrowserToday,
  getMillisecondsUntilNextMidnight,
  getTodayInTimeZone,
  isSupportedTimeZone,
} from "./timezone";

const warsaw = "Europe/Warsaw";
const fixedNow = new Date("2026-02-14T10:00:00.000Z");

describe("isSupportedTimeZone", () => {
  test("accepts real zones and rejects forged or malformed values", () => {
    expect(isSupportedTimeZone(warsaw)).toBe(true);
    expect(isSupportedTimeZone("Not/AZone")).toBe(false);
    expect(isSupportedTimeZone("")).toBe(false);
    expect(isSupportedTimeZone("a".repeat(101))).toBe(false);
    expect(isSupportedTimeZone("Europe/Warsaw!invalid")).toBe(false);
  });
});

describe("getNextBrowserToday", () => {
  test("keeps the previously emitted day when a later acquisition fails", () => {
    expect(getNextBrowserToday("2026-03-08", null)).toBe("2026-03-08");
    expect(getNextBrowserToday(null, null)).toBeNull();
  });

  test("emits a newly acquired day after the original seed", () => {
    expect(getNextBrowserToday("2026-03-08", "2026-03-09")).toBe("2026-03-09");
  });
});

describe("getTodayInTimeZone", () => {
  test("resolves dates around midnight in zones on opposite sides of UTC", () => {
    expect(getTodayInTimeZone("Pacific/Kiritimati", new Date("2026-02-28T09:30:00.000Z"))).toBe("2026-02-28");
    expect(getTodayInTimeZone("Pacific/Kiritimati", new Date("2026-02-28T10:30:00.000Z"))).toBe("2026-03-01");
    expect(getTodayInTimeZone("Pacific/Midway", new Date("2026-03-01T09:30:00.000Z"))).toBe("2026-02-28");
    expect(getTodayInTimeZone("Pacific/Midway", new Date("2026-03-01T11:30:00.000Z"))).toBe("2026-03-01");
  });

  test("throws on an unsupported zone", () => {
    expect(() => getTodayInTimeZone("Not/AZone", fixedNow)).toThrow(RangeError);
  });
});

describe("getMillisecondsUntilNextMidnight", () => {
  test.each([
    [new Date("2026-02-14T10:00:00.000Z"), "2026-02-14", "2026-02-15"],
    [new Date("2026-03-29T00:30:00.000Z"), "2026-03-29", "2026-03-30"],
    [new Date("2026-10-25T00:30:00.000Z"), "2026-10-25", "2026-10-26"],
  ] as const)("finds the next local midnight", (now, currentDate, nextDate) => {
    const milliseconds = getMillisecondsUntilNextMidnight(warsaw, now);
    const scheduled = new Date(now.getTime() + milliseconds);
    const justBefore = new Date(scheduled.getTime() - 1);

    expect(getTodayInTimeZone(warsaw, scheduled)).toBe(nextDate);
    expect(getTodayInTimeZone(warsaw, justBefore)).toBe(currentDate);
    expect(milliseconds).toBeGreaterThan(1000);
  });

  test("enforces the one-second floor immediately before midnight", () => {
    const now = new Date("2026-02-14T22:59:59.500Z");
    const milliseconds = getMillisecondsUntilNextMidnight(warsaw, now);

    expect(milliseconds).toBe(1000);
    expect(getTodayInTimeZone(warsaw, new Date(now.getTime() + milliseconds))).toBe("2026-02-15");
  });

  test("throws on an unsupported zone", () => {
    expect(() => getMillisecondsUntilNextMidnight("Not/AZone", fixedNow)).toThrow(RangeError);
  });
});

describe("getBrowserRolloverState", () => {
  // Chained on purpose: a delay computed once from the seed would still satisfy a
  // single-tick assertion, so the second tick must be taken at the instant the first
  // one scheduled and produce the day after it.
  test("reschedules from the newly observed day rather than the original seed", () => {
    const seed = new Date("2026-03-09T10:00:00.000Z");
    const first = getBrowserRolloverState(warsaw, seed);
    const firstMidnight = new Date(seed.getTime() + first.delay);
    const second = getBrowserRolloverState(warsaw, firstMidnight);
    const secondMidnight = new Date(firstMidnight.getTime() + second.delay);

    expect(first.today).toBe("2026-03-09");
    expect(second.today).toBe("2026-03-10");
    expect(getTodayInTimeZone(warsaw, secondMidnight)).toBe("2026-03-11");
    // Each delay must land on the boundary itself, not merely somewhere in the next
    // day — otherwise a fixed 24 h reschedule would satisfy the assertions above.
    expect(getTodayInTimeZone(warsaw, new Date(firstMidnight.getTime() - 1))).toBe("2026-03-09");
    expect(getTodayInTimeZone(warsaw, new Date(secondMidnight.getTime() - 1))).toBe("2026-03-10");
  });

  test.each([new Date("2026-03-29T00:30:00.000Z"), new Date("2026-10-25T00:30:00.000Z")])(
    "keeps DST rollover calculation anchored to the observed instant: %s",
    (now) => {
      const { today, delay } = getBrowserRolloverState(warsaw, now);
      const scheduled = new Date(now.getTime() + delay);

      expect(today).toBe(getTodayInTimeZone(warsaw, now));
      expect(getTodayInTimeZone(warsaw, scheduled)).not.toBe(today);
    },
  );
});

// `TIME_ZONE_COOKIE === "tz"` would only restate the constant. The drift that costs
// something is the inline head script in layout.astro — which cannot import from here —
// being renamed on its own, so this reads that file rather than asserting the value.
describe("TIME_ZONE_COOKIE", () => {
  test("matches the cookie name written by the inline head script in layout.astro", () => {
    const layoutPath = fileURLToPath(new URL("../layouts/layout.astro", import.meta.url));
    const layoutSource = readFileSync(layoutPath, "utf8");

    expect(layoutSource).toContain(`${TIME_ZONE_COOKIE}=`);
  });
});
