import { describe, expect, test } from "vitest";
import { server } from "@/actions/index";
import { getTodayInTimeZone } from "@/lib/timezone";
import { createActionContext } from "../../test/fixtures/action-context";
import { expectActionNotFound } from "../../test/fixtures/denial";
import { createDeletePlantFormData, createPlantActionFormData } from "../../test/fixtures/plant-actions";
import { expectPhotoAbsent, expectPhotoAvailable, uploadPhotoFixture } from "../../test/fixtures/photos";
import { createPlantFixture, tryReadPlant, tryReadWateringEvents } from "../../test/fixtures/plants";
import { getIntegrationUserFixture } from "../../test/fixtures/user";

describe("server.deletePlant", () => {
  test("deletes an owner's plant with a multi-event journal and returns id + name", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const userFixture = await getIntegrationUserFixture();
    const plant = await createPlantFixture({
      dueOffsetDays: 0,
      referenceDay: clientDate,
      userFixture,
    });
    const userContext = createActionContext(userFixture);

    await server.markWatered.orThrow.call(userContext, createPlantActionFormData(plant.id, clientDate));
    await server.postponePlant.orThrow.call(userContext, createPlantActionFormData(plant.id, clientDate));

    const result = await server.deletePlant.orThrow.call(userContext, createDeletePlantFormData(plant.id));

    expect(result).toEqual({ id: plant.id, name: plant.name });

    const deletedPlant = await tryReadPlant(userFixture, plant.id);

    expect(deletedPlant).toBeNull();

    const deletedEvents = await tryReadWateringEvents(userFixture, plant.id);

    expect(deletedEvents).toHaveLength(0);
  });

  test("removes the plant's photo on successful cleanup", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const userFixture = await getIntegrationUserFixture();
    const photoPath = `${userFixture.userId}/test-photo.png`;

    await uploadPhotoFixture(userFixture, photoPath);
    await expectPhotoAvailable(userFixture, photoPath);

    const plant = await createPlantFixture({
      dueOffsetDays: 0,
      photoPath,
      referenceDay: clientDate,
      userFixture,
    });
    const userContext = createActionContext(userFixture);

    await server.deletePlant.orThrow.call(userContext, createDeletePlantFormData(plant.id));

    await expectPhotoAbsent(userFixture, photoPath);
  });

  test("returns NOT_FOUND for a missing plant id", async () => {
    const userFixture = await getIntegrationUserFixture();
    const userContext = createActionContext(userFixture);
    const randomPlantId = crypto.randomUUID();

    await expectActionNotFound(() =>
      server.deletePlant.orThrow.call(userContext, createDeletePlantFormData(randomPlantId)),
    );
  });

  test("returns NOT_FOUND and preserves another account's plant when a foreign account attempts deletion", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const ownerFixture = await getIntegrationUserFixture();
    const attackerFixture = await getIntegrationUserFixture(1);
    const photoPath = `${ownerFixture.userId}/foreign-delete-preserved-photo.png`;

    await uploadPhotoFixture(ownerFixture, photoPath);

    const plant = await createPlantFixture({
      dueOffsetDays: 0,
      photoPath,
      referenceDay: clientDate,
      userFixture: ownerFixture,
    });
    const ownerContext = createActionContext(ownerFixture);
    const attackerContext = createActionContext(attackerFixture);

    await server.markWatered.orThrow.call(ownerContext, createPlantActionFormData(plant.id, clientDate));

    const beforeState = await tryReadPlant(ownerFixture, plant.id);
    const beforeEvents = await tryReadWateringEvents(ownerFixture, plant.id);

    expect(beforeEvents.length).toBeGreaterThan(0);

    await expectActionNotFound(() =>
      server.deletePlant.orThrow.call(attackerContext, createDeletePlantFormData(plant.id)),
    );

    const afterState = await tryReadPlant(ownerFixture, plant.id);
    const afterEvents = await tryReadWateringEvents(ownerFixture, plant.id);

    expect(afterState).toEqual(beforeState);
    expect(afterEvents).toEqual(beforeEvents);
    await expectPhotoAvailable(ownerFixture, photoPath);
  });
});
