import { describe, expect, it } from "vitest";
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
  it.each([
    [3, "2024-03-23"],
    [-3, "2024-03-17"],
    [0, "2024-03-20"],
  ] as const)("applies a %s-day delta", (deltaDays, expectedDate) => {
    const input = { ...baseInput, newGrowingIntervalDays: baseInput.oldGrowingIntervalDays + deltaDays };
    const result = resolveScheduleChange(input);

    expect(result.deltaDays).toBe(deltaDays);
    expect(result.newNextDue).toBe(expectedDate);
  });

  it("does not clamp a recalculated date in the past", () => {
    const result = resolveScheduleChange({
      ...baseInput,
      oldNextDue: "2024-03-02",
      newGrowingIntervalDays: 1,
    });

    expect(result.newNextDue).toBe("2024-02-25");
  });

  it("reports the active season and ignores the inactive interval pair", () => {
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
});
