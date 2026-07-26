import { describe, expect, it } from "vitest";
import { nextDue } from "./interval";

describe("nextDue", () => {
  it("adds calendar days across a month boundary", () => {
    expect(nextDue("2026-01-31", 1)).toBe("2026-02-01");
  });
});
