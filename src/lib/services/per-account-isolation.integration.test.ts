import { describe, expect, test } from "vitest";
import { server } from "@/actions/index";
import { getTodayInTimeZone } from "@/lib/timezone";
import { createActionContext } from "../../../test/fixtures/action-context";
import { expectActionNotFound, expectNoRowVisible } from "../../../test/fixtures/denial";
import { createUpdatePlantFormData, markPlantWatered } from "../../../test/fixtures/plant-actions";
import {
  createPlantFixture,
  tryReadPlant,
  tryReadWateringEventById,
  tryReadWateringEvents,
} from "../../../test/fixtures/plants";
import { getIntegrationUserFixture } from "../../../test/fixtures/user";

function createUpdateFormData(
  plant: {
    dormancy_interval_days: number;
    growing_interval_days: number;
    id: string;
    name: string;
    updated_at: string;
  },
  clientDate: string,
) {
  return createUpdatePlantFormData({
    clientDate,
    dormancyIntervalDays: plant.dormancy_interval_days,
    growingIntervalDays: plant.growing_interval_days,
    name: plant.name,
    plantId: plant.id,
    updatedAt: plant.updated_at,
  });
}

describe("plants_select_own", () => {
  test("hides another account's plant addressed by direct id", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const attackerFixture = await getIntegrationUserFixture(1);
    const ownerFixture = await getIntegrationUserFixture();
    const ownerPlant = await createPlantFixture({
      dueOffsetDays: 0,
      referenceDay: clientDate,
      userFixture: ownerFixture,
    });
    const attackerResult = await tryReadPlant(attackerFixture, ownerPlant.id);
    const ownerResult = await tryReadPlant(ownerFixture, ownerPlant.id);

    expectNoRowVisible(attackerResult);
    expect(ownerResult).toMatchObject({ id: ownerPlant.id, user_id: ownerFixture.userId });
  });
});

describe("watering_events_select_own", () => {
  test("hides another account's watering events by plant and event id", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const attackerFixture = await getIntegrationUserFixture(1);
    const ownerFixture = await getIntegrationUserFixture();
    const ownerPlant = await createPlantFixture({
      dueOffsetDays: 0,
      referenceDay: clientDate,
      userFixture: ownerFixture,
    });
    const ownerEvent = await markPlantWatered(ownerFixture, ownerPlant.id, clientDate);
    const attackerEventsByPlant = await tryReadWateringEvents(attackerFixture, ownerPlant.id);
    const attackerEventById = await tryReadWateringEventById(attackerFixture, ownerEvent.event_id);
    const ownerEventsByPlant = await tryReadWateringEvents(ownerFixture, ownerPlant.id);
    const ownerEventById = await tryReadWateringEventById(ownerFixture, ownerEvent.event_id);

    expectNoRowVisible(attackerEventsByPlant);
    expectNoRowVisible(attackerEventById);
    expect(ownerEventsByPlant).toEqual([expect.objectContaining({ id: ownerEvent.event_id })]);
    expect(ownerEventById).toMatchObject({ id: ownerEvent.event_id, plant_id: ownerPlant.id });
  });
});

describe("server.updatePlant cross-account pre-read", () => {
  test("returns NOT_FOUND for another account's plant before reaching its mutation RPC", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const attackerFixture = await getIntegrationUserFixture(1);
    const ownerFixture = await getIntegrationUserFixture();
    const ownerPlant = await createPlantFixture({
      dueOffsetDays: 0,
      referenceDay: clientDate,
      userFixture: ownerFixture,
    });
    const attackerContext = createActionContext(attackerFixture);
    const formData = createUpdateFormData(ownerPlant, clientDate);

    // updatePlant's RLS-scoped pre-read in src/actions/index.ts rejects this before its RPC;
    // it belongs with read isolation even though the public Action is a mutation.
    await expectActionNotFound(() => server.updatePlant.orThrow.call(attackerContext, formData));
  });
});
