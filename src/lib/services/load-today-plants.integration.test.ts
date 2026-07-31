import { describe, expect, test } from "vitest";
import { selectDueRecords } from "@/lib/due";
import { addDays } from "@/lib/date";
import { loadTodayPlants } from "@/lib/services/load-today-plants";
import { getTodayInTimeZone } from "@/lib/timezone";
import {
  createActionCookies,
  createActionRequestHeaders,
  getIntegrationUserFixture,
} from "../../../test/fixtures/user";
import { createPlantFixture } from "../../../test/fixtures/plants";

describe("loadTodayPlants", () => {
  test("returns all plants in due-date and name order for the current user", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const userFixture = await getIntegrationUserFixture();
    const { cookies } = createActionCookies(userFixture.cookieJar);
    const requestHeaders = createActionRequestHeaders(userFixture.cookieJar);
    const fixturePlants = await Promise.all([
      createPlantFixture({ dueOffsetDays: -30, name: "Due 30 days ago", referenceDay: clientDate, userFixture }),
      createPlantFixture({ dueOffsetDays: -1, name: "Due yesterday", referenceDay: clientDate, userFixture }),
      createPlantFixture({ dueOffsetDays: 0, name: "Due today", referenceDay: clientDate, userFixture }),
      createPlantFixture({ dueOffsetDays: 5, name: "Due later", referenceDay: clientDate, userFixture }),
    ]);
    const result = await loadTodayPlants(requestHeaders, cookies);

    if (result.plants === null) {
      throw new Error("Expected the authenticated production loader to return plants.");
    }

    const duePlants = selectDueRecords(result.plants, clientDate);

    expect(result.plants.map((plant) => plant.id)).toEqual(fixturePlants.map((plant) => plant.id));
    expect(result.plants.map((plant) => plant.next_due_on)).toEqual([
      addDays(clientDate, -30),
      addDays(clientDate, -1),
      clientDate,
      addDays(clientDate, 5),
    ]);
    expect(duePlants.map((plant) => plant.id)).toEqual(fixturePlants.slice(0, 3).map((plant) => plant.id));
  });
});
