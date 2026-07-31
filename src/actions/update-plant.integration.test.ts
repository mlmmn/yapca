import { describe, expect, test } from "vitest";
import { server } from "@/actions/index";
import { addDays } from "@/lib/date";
import { getTodayInTimeZone } from "@/lib/timezone";
import { createActionContext } from "../../test/fixtures/action-context";
import { createPlantFixture, readPlantState } from "../../test/fixtures/plants";
import { assertNoStorageObjects, getIntegrationUserFixture, removeAllStorageObjects } from "../../test/fixtures/user";

type UpdatePlantInput = {
  clientDate: string;
  dormancyIntervalDays: number;
  growingIntervalDays: number;
  name: string;
  photo?: File;
  plantId: string;
  removePhoto?: boolean;
  updatedAt: string;
};

function createPhotoFile(name = "plant.png") {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
}

function createUpdateFormData({
  clientDate,
  dormancyIntervalDays,
  growingIntervalDays,
  name,
  photo,
  plantId,
  removePhoto = false,
  updatedAt,
}: UpdatePlantInput) {
  const formData = new FormData();

  formData.set("plantId", plantId);
  formData.set("name", name);
  formData.set("growing_interval_days", String(growingIntervalDays));
  formData.set("dormancy_interval_days", String(dormancyIntervalDays));
  formData.set("removePhoto", String(removePhoto));
  formData.set("updated_at", updatedAt);
  formData.set("clientDate", clientDate);

  if (photo) {
    formData.set("photo", photo);
  }

  return formData;
}

async function updatePlant(input: UpdatePlantInput) {
  const userFixture = await getIntegrationUserFixture();
  const context = createActionContext(userFixture);
  const formData = createUpdateFormData(input);

  return server.updatePlant.orThrow.call(context, formData);
}

async function uploadPhoto(path: string) {
  const userFixture = await getIntegrationUserFixture();
  const photo = createPhotoFile();
  const { error } = await userFixture.client.storage.from("plant-photos").upload(path, photo, {
    contentType: photo.type,
  });

  if (error) {
    throw new Error(`Failed to upload fixture photo ${path}: ${error.message}`);
  }
}

async function expectPhotoRetrievable(path: string) {
  const userFixture = await getIntegrationUserFixture();
  const { data, error } = await userFixture.client.storage.from("plant-photos").download(path);

  expect(error).toBeNull();
  expect(data?.size).toBeGreaterThan(0);
}

describe("server.updatePlant", () => {
  test.each([
    { dormancyIntervalDays: 30, growingIntervalDays: 7, name: "renamed plant" },
    { dormancyIntervalDays: 30, growingIntervalDays: 10, name: "interval only" },
    { dormancyIntervalDays: 35, growingIntervalDays: 10, name: "both intervals" },
    { dormancyIntervalDays: 35, growingIntervalDays: 12, name: "complete edit" },
  ])("preserves the complete record for $name", async ({ dormancyIntervalDays, growingIntervalDays, name }) => {
    const clientDate = getTodayInTimeZone("UTC");
    const userFixture = await getIntegrationUserFixture();
    const plant = await createPlantFixture({
      dueOffsetDays: 8,
      dormancyIntervalDays: 30,
      growingIntervalDays: 7,
      referenceDay: clientDate,
      userFixture,
    });
    const result = await updatePlant({
      clientDate,
      dormancyIntervalDays,
      growingIntervalDays,
      name,
      plantId: plant.id,
      updatedAt: plant.updated_at,
    });
    const state = await readPlantState(userFixture, plant.id);

    expect(result).toEqual(state.plant);
    expect(state.plant).toMatchObject({
      created_at: plant.created_at,
      dormancy_interval_days: dormancyIntervalDays,
      growing_interval_days: growingIntervalDays,
      id: plant.id,
      name,
      photo_path: null,
      user_id: plant.user_id,
    });
    expect(state.plant.updated_at).not.toBe(plant.updated_at);
    expect(state.wateringEvents).toHaveLength(0);
  });

  test("shifts from the stored due date by the active interval delta without clamping", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const userFixture = await getIntegrationUserFixture();
    const plant = await createPlantFixture({
      dueOffsetDays: -1,
      dormancyIntervalDays: 7,
      growingIntervalDays: 7,
      referenceDay: clientDate,
      userFixture,
    });

    await updatePlant({
      clientDate,
      dormancyIntervalDays: 1,
      growingIntervalDays: 1,
      name: plant.name,
      plantId: plant.id,
      updatedAt: plant.updated_at,
    });

    const state = await readPlantState(userFixture, plant.id);

    expect(state.plant.next_due_on).toBe(addDays(plant.next_due_on, -6));
    expect(state.plant.next_due_on < clientDate).toBe(true);
  });

  test("keeps, replaces, and removes photos according to intent", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const userFixture = await getIntegrationUserFixture();
    const originalPhotoPath = `${userFixture.userId}/original.png`;

    await uploadPhoto(originalPhotoPath);

    const plant = await createPlantFixture({
      dueOffsetDays: 0,
      photoPath: originalPhotoPath,
      referenceDay: clientDate,
      userFixture,
    });
    const keptPlant = await updatePlant({
      clientDate,
      dormancyIntervalDays: plant.dormancy_interval_days,
      growingIntervalDays: plant.growing_interval_days,
      name: plant.name,
      plantId: plant.id,
      updatedAt: plant.updated_at,
    });

    expect(keptPlant.photo_path).toBe(originalPhotoPath);
    await expectPhotoRetrievable(originalPhotoPath);

    const replacedPlant = await updatePlant({
      clientDate,
      dormancyIntervalDays: keptPlant.dormancy_interval_days,
      growingIntervalDays: keptPlant.growing_interval_days,
      name: keptPlant.name,
      photo: createPhotoFile("replacement.png"),
      plantId: plant.id,
      removePhoto: true,
      updatedAt: keptPlant.updated_at,
    });

    expect(replacedPlant.photo_path).not.toBe(originalPhotoPath);
    expect(replacedPlant.photo_path).not.toBeNull();
    await expectPhotoRetrievable(replacedPlant.photo_path!);

    const removedPlant = await updatePlant({
      clientDate,
      dormancyIntervalDays: replacedPlant.dormancy_interval_days,
      growingIntervalDays: replacedPlant.growing_interval_days,
      name: replacedPlant.name,
      plantId: plant.id,
      removePhoto: true,
      updatedAt: replacedPlant.updated_at,
    });

    expect(removedPlant.photo_path).toBeNull();
    await removeAllStorageObjects(userFixture.client, userFixture.userId);
    await assertNoStorageObjects(userFixture.client, userFixture.userId);
  });

  test("rejects a stale token only when the interval delta changes", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const userFixture = await getIntegrationUserFixture();
    const plant = await createPlantFixture({ dueOffsetDays: 0, referenceDay: clientDate, userFixture });
    const freshPlant = await updatePlant({
      clientDate,
      dormancyIntervalDays: plant.dormancy_interval_days,
      growingIntervalDays: plant.growing_interval_days,
      name: "fresh name",
      plantId: plant.id,
      updatedAt: plant.updated_at,
    });

    await expect(
      updatePlant({
        clientDate,
        dormancyIntervalDays: freshPlant.dormancy_interval_days + 1,
        growingIntervalDays: freshPlant.growing_interval_days + 1,
        name: freshPlant.name,
        plantId: plant.id,
        updatedAt: plant.updated_at,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const nameOnlyResult = await updatePlant({
      clientDate,
      dormancyIntervalDays: freshPlant.dormancy_interval_days,
      growingIntervalDays: freshPlant.growing_interval_days,
      name: "stale name-only edit",
      plantId: plant.id,
      updatedAt: plant.updated_at,
    });

    expect(nameOnlyResult.name).toBe("stale name-only edit");
  });
});
