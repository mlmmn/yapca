import { describe, expect, test } from "vitest";
import { resolveScheduleChange } from "./schedule";

const baseInput = {
  activeDay: "2024-03-01",
  oldNextDue: "2024-03-20",
  oldGrowingIntervalDays: 7,
  oldDormancyIntervalDays: 30,
  newGrowingIntervalDays: 10,
  newDormancyIntervalDays: 1,
};

describe("resolveScheduleChange", () => {
  // Interval values are literal rather than derived from the expected delta, so
  // the delta assertion is grounded independently of the subtraction under test.
  test.each([
    [10, 3, "2024-03-23"],
    [4, -3, "2024-03-17"],
    [7, 0, "2024-03-20"],
  ] as const)(
    "shifts the due date when the interval becomes %s days",
    (newGrowingIntervalDays, expectedDelta, expectedDate) => {
      const result = resolveScheduleChange({ ...baseInput, newGrowingIntervalDays });

      expect(result.deltaDays).toBe(expectedDelta);
      expect(result.newNextDue).toBe(expectedDate);
      // Literal rather than `baseInput.oldNextDue`, so a pass-through that silently
      // returned some other field of the same input could not satisfy it.
      expect(result.oldNextDue).toBe("2024-03-20");
    },
  );

  test("does not clamp a recalculated date in the past", () => {
    const result = resolveScheduleChange({
      ...baseInput,
      oldNextDue: "2024-03-02",
      newGrowingIntervalDays: 1,
    });

    expect(result.newNextDue).toBe("2024-02-25");
  });

  test("reports the active season and ignores the inactive interval pair", () => {
    const growingResult = resolveScheduleChange(baseInput);
    const dormancyResult = resolveScheduleChange({
      ...baseInput,
      activeDay: "2024-11-01",
      oldNextDue: "2024-11-20",
      oldGrowingIntervalDays: 100,
      newGrowingIntervalDays: 1,
      oldDormancyIntervalDays: 30,
      newDormancyIntervalDays: 35,
    });

    expect(growingResult.season).toBe("growing");
    expect(growingResult.deltaDays).toBe(3);
    expect(dormancyResult.season).toBe("dormancy");
    expect(dormancyResult.deltaDays).toBe(5);
    expect(dormancyResult.newNextDue).toBe("2024-11-25");
  });

  test("propagates the RangeError from an invalid active day", () => {
    expect(() => resolveScheduleChange({ ...baseInput, activeDay: "2024-02-30" })).toThrow(RangeError);
  });
});
