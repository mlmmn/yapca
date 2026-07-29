import { describe, expect, test } from "vitest";

describe("astro action shims", () => {
  test("imports the actions module without unresolved Astro virtual modules", async () => {
    const actionsModule = await import("./index");

    expect(actionsModule.server).toBeDefined();
  });
});
