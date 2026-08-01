import { describe, expect, test } from "vitest";
import { server } from "@/actions/index";
import { getTodayInTimeZone } from "@/lib/timezone";
import { createActionContext } from "../../test/fixtures/action-context";
import { expectActionNotFound } from "../../test/fixtures/denial";
import { createPlantFixture, readPlantState } from "../../test/fixtures/plants";
import { getIntegrationUserFixture, type IntegrationUserFixture } from "../../test/fixtures/user";

function createPlantActionFormData(plantId: string, clientDate: string) {
  const formData = new FormData();

  formData.set("plantId", plantId);
  formData.set("clientDate", clientDate);

  return formData;
}

function createEventActionFormData(eventId: string) {
  const formData = new FormData();

  formData.set("eventId", eventId);

  return formData;
}

async function markPlantWatered(userFixture: IntegrationUserFixture, plantId: string, clientDate: string) {
  const context = createActionContext(userFixture);

  return server.markWatered.orThrow.call(context, createPlantActionFormData(plantId, clientDate));
}

describe("server.markWatered", () => {
  test("returns NOT_FOUND and preserves another account's complete plant state", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const attackerFixture = await getIntegrationUserFixture(1);
    const ownerFixture = await getIntegrationUserFixture();
    const ownerPlant = await createPlantFixture({
      dueOffsetDays: 0,
      referenceDay: clientDate,
      userFixture: ownerFixture,
    });
    const attackerContext = createActionContext(attackerFixture);
    const beforeState = await readPlantState(ownerFixture, ownerPlant.id);

    await expectActionNotFound(() =>
      server.markWatered.orThrow.call(attackerContext, createPlantActionFormData(ownerPlant.id, clientDate)),
    );

    const afterState = await readPlantState(ownerFixture, ownerPlant.id);

    expect(afterState).toEqual(beforeState);
  });
});

describe("server.postponePlant", () => {
  test("returns NOT_FOUND and preserves another account's complete plant state", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const attackerFixture = await getIntegrationUserFixture(1);
    const ownerFixture = await getIntegrationUserFixture();
    const ownerPlant = await createPlantFixture({
      dueOffsetDays: 0,
      referenceDay: clientDate,
      userFixture: ownerFixture,
    });
    const attackerContext = createActionContext(attackerFixture);
    const beforeState = await readPlantState(ownerFixture, ownerPlant.id);

    await expectActionNotFound(() =>
      server.postponePlant.orThrow.call(attackerContext, createPlantActionFormData(ownerPlant.id, clientDate)),
    );

    const afterState = await readPlantState(ownerFixture, ownerPlant.id);

    expect(afterState).toEqual(beforeState);
  });
});

describe("server.undoWateringEvent", () => {
  test("returns NOT_FOUND and preserves another account's complete plant state", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const attackerFixture = await getIntegrationUserFixture(1);
    const ownerFixture = await getIntegrationUserFixture();
    const ownerPlant = await createPlantFixture({
      dueOffsetDays: 0,
      referenceDay: clientDate,
      userFixture: ownerFixture,
    });
    const ownerEvent = await markPlantWatered(ownerFixture, ownerPlant.id, clientDate);
    const attackerContext = createActionContext(attackerFixture);
    const beforeState = await readPlantState(ownerFixture, ownerPlant.id);

    await expectActionNotFound(() =>
      server.undoWateringEvent.orThrow.call(attackerContext, createEventActionFormData(ownerEvent.event_id)),
    );

    const afterState = await readPlantState(ownerFixture, ownerPlant.id);

    expect(afterState).toEqual(beforeState);
  });
});
