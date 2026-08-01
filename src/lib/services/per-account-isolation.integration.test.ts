import { describe, expect, test } from "vitest";
import { server } from "@/actions/index";
import { getTodayInTimeZone } from "@/lib/timezone";
import { createActionContext } from "../../../test/fixtures/action-context";
import { expectActionNotFound, expectNoRowVisible } from "../../../test/fixtures/denial";
import {
  createPlantFixture,
  tryReadPlant,
  tryReadWateringEventById,
  tryReadWateringEvents,
} from "../../../test/fixtures/plants";
import { getIntegrationUserFixture, type IntegrationUserFixture } from "../../../test/fixtures/user";

function createPlantMutationFormData(plantId: string, clientDate: string) {
  const formData = new FormData();

  formData.set("plantId", plantId);
  formData.set("clientDate", clientDate);

  return formData;
}

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
  const formData = new FormData();

  formData.set("plantId", plant.id);
  formData.set("name", plant.name);
  formData.set("growing_interval_days", String(plant.growing_interval_days));
  formData.set("dormancy_interval_days", String(plant.dormancy_interval_days));
  formData.set("removePhoto", "false");
  formData.set("updated_at", plant.updated_at);
  formData.set("clientDate", clientDate);

  return formData;
}

async function markPlantWatered(userFixture: IntegrationUserFixture, plantId: string, clientDate: string) {
  const context = createActionContext(userFixture);

  return server.markWatered.orThrow.call(context, createPlantMutationFormData(plantId, clientDate));
}

describe("tryReadPlant", () => {
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

describe("tryReadWateringEvents", () => {
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

describe("server.updatePlant", () => {
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
