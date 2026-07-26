import { describe, expect, it } from "vitest";
import { getMillisecondsUntilNextMidnight, getTodayInTimeZone, isSupportedTimeZone } from "./timezone";

const warsaw = "Europe/Warsaw";

describe("time zone resolution", () => {
  it("accepts real zones and rejects forged or malformed values", () => {
    expect(isSupportedTimeZone(warsaw)).toBe(true);
    expect(isSupportedTimeZone("Not/AZone")).toBe(false);
    expect(isSupportedTimeZone("")).toBe(false);
    expect(isSupportedTimeZone("a".repeat(101))).toBe(false);
    expect(isSupportedTimeZone("Europe/Warsaw!invalid")).toBe(false);
  });

  it("resolves dates around midnight in zones on opposite sides of UTC", () => {
    expect(getTodayInTimeZone("Pacific/Kiritimati", new Date("2026-02-28T09:30:00.000Z"))).toBe("2026-02-28");
    expect(getTodayInTimeZone("Pacific/Kiritimati", new Date("2026-02-28T10:30:00.000Z"))).toBe("2026-03-01");
    expect(getTodayInTimeZone("Pacific/Midway", new Date("2026-03-01T09:30:00.000Z"))).toBe("2026-02-28");
    expect(getTodayInTimeZone("Pacific/Midway", new Date("2026-03-01T11:30:00.000Z"))).toBe("2026-03-01");
    expect(() => getTodayInTimeZone("Not/AZone", new Date())).toThrow(RangeError);
  });

  it.each([
    [new Date("2026-02-14T10:00:00.000Z"), "2026-02-15"],
    [new Date("2026-03-29T00:30:00.000Z"), "2026-03-30"],
    [new Date("2026-10-25T00:30:00.000Z"), "2026-10-26"],
  ] as const)("finds the next local midnight", (now, nextDate) => {
    const milliseconds = getMillisecondsUntilNextMidnight(warsaw, now);
    const scheduled = new Date(now.getTime() + milliseconds);
    const justBefore = new Date(scheduled.getTime() - 1);

    expect(getTodayInTimeZone(warsaw, scheduled)).toBe(nextDate);
    expect(getTodayInTimeZone(warsaw, justBefore)).toBe(getTodayInTimeZone(warsaw, now));
    expect(milliseconds).toBeGreaterThan(1000);
  });

  it("enforces the one-second floor immediately before midnight", () => {
    const now = new Date("2026-02-14T22:59:59.500Z");
    const milliseconds = getMillisecondsUntilNextMidnight(warsaw, now);

    expect(milliseconds).toBe(1000);
    expect(getTodayInTimeZone(warsaw, new Date(now.getTime() + milliseconds))).toBe("2026-02-15");
  });
});
