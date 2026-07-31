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
  test("returns all plants in due-date and name order", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const userFixture = await getIntegrationUserFixture();
    const { cookies } = createActionCookies(userFixture.cookieJar);
    const requestHeaders = createActionRequestHeaders(userFixture.cookieJar);
    // Declared out of due order, with "Zebra"/"Anthurium" sharing one next_due_on and sorting
    // opposite to insertion order, so dropping either .order() clause fails this test.
    const [dueLater, zebraYesterday, overdueThirty, anthuriumYesterday, dueToday] = await Promise.all([
      createPlantFixture({ dueOffsetDays: 5, name: "Due later", referenceDay: clientDate, userFixture }),
      createPlantFixture({ dueOffsetDays: -1, name: "Zebra yesterday", referenceDay: clientDate, userFixture }),
      createPlantFixture({ dueOffsetDays: -30, name: "Due 30 days ago", referenceDay: clientDate, userFixture }),
      createPlantFixture({ dueOffsetDays: -1, name: "Anthurium yesterday", referenceDay: clientDate, userFixture }),
      createPlantFixture({ dueOffsetDays: 0, name: "Due today", referenceDay: clientDate, userFixture }),
    ]);
    const expectedOrder = [overdueThirty, anthuriumYesterday, zebraYesterday, dueToday, dueLater];
    const result = await loadTodayPlants(requestHeaders, cookies);

    if (result.plants === null) {
      throw new Error("Expected the authenticated production loader to return plants.");
    }

    const duePlants = selectDueRecords(result.plants, clientDate);

    expect(result.plants.map((plant) => plant.id)).toEqual(expectedOrder.map((plant) => plant.id));
    expect(result.plants.map((plant) => plant.next_due_on)).toEqual([
      addDays(clientDate, -30),
      addDays(clientDate, -1),
      addDays(clientDate, -1),
      clientDate,
      addDays(clientDate, 5),
    ]);
    expect(duePlants.map((plant) => plant.id)).toEqual(expectedOrder.slice(0, 4).map((plant) => plant.id));
  });

  // Seeds a second account so the loader's RLS scoping is exercised rather than assumed:
  // with only one populated slot, a loader holding a privileged client would pass identically.
  test("excludes plants owned by another user", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const otherUserFixture = await getIntegrationUserFixture(1);
    const userFixture = await getIntegrationUserFixture();
    const { cookies } = createActionCookies(userFixture.cookieJar);
    const requestHeaders = createActionRequestHeaders(userFixture.cookieJar);
    const [ownPlant, otherPlant] = await Promise.all([
      createPlantFixture({ dueOffsetDays: 0, name: "Own plant", referenceDay: clientDate, userFixture }),
      createPlantFixture({
        dueOffsetDays: 0,
        name: "Other account plant",
        referenceDay: clientDate,
        userFixture: otherUserFixture,
      }),
    ]);
    const result = await loadTodayPlants(requestHeaders, cookies);

    if (result.plants === null) {
      throw new Error("Expected the authenticated production loader to return plants.");
    }

    const plantIds = result.plants.map((plant) => plant.id);

    expect(plantIds).toEqual([ownPlant.id]);
    expect(plantIds).not.toContain(otherPlant.id);
  });
});
