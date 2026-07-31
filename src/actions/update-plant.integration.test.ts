import { describe, expect, test } from "vitest";
import { server } from "@/actions/index";
import { addDays } from "@/lib/date";
import { getSeason } from "@/lib/season";
import { getTodayInTimeZone } from "@/lib/timezone";
import { createActionContext } from "../../test/fixtures/action-context";
import { createPlantFixture, readPlantState } from "../../test/fixtures/plants";
import { assertNoStorageObjects, getIntegrationUserFixture } from "../../test/fixtures/user";

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

// Asserts absence positively, by listing, rather than by expecting `download` to fail: *any*
// storage error satisfies "the download failed", so an expired or broken fixture session would
// read as "photo correctly deleted". A listing that succeeds and omits the object cannot.
async function expectPhotoAbsent(path: string) {
  const userFixture = await getIntegrationUserFixture();
  const separatorIndex = path.lastIndexOf("/");
  const folder = path.slice(0, separatorIndex);
  const objectName = path.slice(separatorIndex + 1);
  const { data, error } = await userFixture.client.storage.from("plant-photos").list(folder);

  expect(error).toBeNull();
  expect(data?.map((entry) => entry.name)).not.toContain(objectName);
}

describe("server.updatePlant", () => {
  // The fixture below is 7 growing / 30 dormancy, so each row's expected shift depends on which
  // interval is active on the day the suite runs. Both deltas are stated literally rather than
  // subtracted here, so the assertion stays grounded independently of the arithmetic under test.
  test.each([
    { dormancyDelta: 0, dormancyIntervalDays: 30, growingDelta: 0, growingIntervalDays: 7, name: "renamed plant" },
    { dormancyDelta: 0, dormancyIntervalDays: 30, growingDelta: 3, growingIntervalDays: 10, name: "interval only" },
    { dormancyDelta: 5, dormancyIntervalDays: 35, growingDelta: 3, growingIntervalDays: 10, name: "both intervals" },
    { dormancyDelta: 5, dormancyIntervalDays: 35, growingDelta: 5, growingIntervalDays: 12, name: "complete edit" },
  ])(
    "preserves the complete record for $name",
    async ({ dormancyDelta, dormancyIntervalDays, growingDelta, growingIntervalDays, name }) => {
      const clientDate = getTodayInTimeZone("UTC");
      const expectedDelta = getSeason(clientDate) === "growing" ? growingDelta : dormancyDelta;
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
        next_due_on: addDays(plant.next_due_on, expectedDelta),
        photo_path: null,
        user_id: plant.user_id,
      });
      expect(state.plant.updated_at).not.toBe(plant.updated_at);
      expect(state.wateringEvents).toHaveLength(0);
    },
  );

  // The two interval pairs are deliberately asymmetric (7 → 1 growing, 30 → 20 dormancy) so the
  // shift is only correct if the *active* interval for the action date was selected. `getActionDate`
  // (`src/lib/date.ts:43-51`) rejects a clientDate more than a day from UTC today, so the dormancy
  // branch itself can only execute here between November and February; `src/lib/season.test.ts` and
  // `src/lib/schedule.test.ts:43-59` cover the branch year-round.
  test("shifts from the stored due date by the active interval delta without clamping", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const expectedDelta = getSeason(clientDate) === "growing" ? -6 : -10;
    const userFixture = await getIntegrationUserFixture();
    const plant = await createPlantFixture({
      dueOffsetDays: -1,
      dormancyIntervalDays: 30,
      growingIntervalDays: 7,
      referenceDay: clientDate,
      userFixture,
    });

    await updatePlant({
      clientDate,
      dormancyIntervalDays: 20,
      growingIntervalDays: 1,
      name: plant.name,
      plantId: plant.id,
      updatedAt: plant.updated_at,
    });

    const state = await readPlantState(userFixture, plant.id);

    expect(state.plant.next_due_on).toBe(addDays(plant.next_due_on, expectedDelta));
    // Both deltas are negative and the plant was already overdue, so the result lands in the past
    // in either season — clamping to `>= today` would fail here, which is the point.
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
      updatedAt: keptPlant.updated_at,
    });

    expect(replacedPlant.photo_path).not.toBe(originalPhotoPath);
    expect(replacedPlant.photo_path).not.toBeNull();
    await expectPhotoRetrievable(replacedPlant.photo_path!);
    // The superseded-object removal at `src/actions/index.ts:186-193` is best-effort and only
    // logs on failure, so `photo_path` alone cannot prove the old photo left the bucket.
    await expectPhotoAbsent(originalPhotoPath);

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
    // Load-bearing: nothing wipes the bucket first, so this fails if either the replace or the
    // remove intent orphans its superseded object. `resetUserSlot` clears storage before the next
    // test, and `global-setup.ts` fails the run on residue, so this is the per-case signal.
    await assertNoStorageObjects(userFixture.client, userFixture.userId);
  });

  // E5: `edit-plant-form.tsx:79,83` never emits `photo` and `removePhoto=true` together, so this
  // payload is unreachable from the UI but reachable by direct call. The handler's
  // `if (input.photo) … else if (input.removePhoto)` (`src/actions/index.ts:138-142`) silently
  // resolves it to replace. Pinned so a reordering of those branches is a deliberate choice.
  test("resolves a request carrying both a photo and removePhoto to replace", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const userFixture = await getIntegrationUserFixture();
    const originalPhotoPath = `${userFixture.userId}/${userFixture.createUniqueName("e5")}.png`;

    await uploadPhoto(originalPhotoPath);

    const plant = await createPlantFixture({
      dueOffsetDays: 0,
      photoPath: originalPhotoPath,
      referenceDay: clientDate,
      userFixture,
    });
    const collidedPlant = await updatePlant({
      clientDate,
      dormancyIntervalDays: plant.dormancy_interval_days,
      growingIntervalDays: plant.growing_interval_days,
      name: plant.name,
      photo: createPhotoFile("collision.png"),
      plantId: plant.id,
      removePhoto: true,
      updatedAt: plant.updated_at,
    });

    expect(collidedPlant.photo_path).not.toBeNull();
    expect(collidedPlant.photo_path).not.toBe(originalPhotoPath);
    await expectPhotoRetrievable(collidedPlant.photo_path!);
    await expectPhotoAbsent(originalPhotoPath);
  });

  test("rejects a stale token only when the interval delta changes", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const userFixture = await getIntegrationUserFixture();
    const plant = await createPlantFixture({ dueOffsetDays: 0, referenceDay: clientDate, userFixture });
    // `plant.updated_at` is passed straight through as the string Postgres returned. Round-tripping
    // it via `Date` truncates to milliseconds and turns the guard into a permanent conflict — the
    // failure mode `context/archive/2026-07-25-edit-plant-and-recalc/reviews/impl-review.md:36`
    // calls the plan's single most fragile requirement.
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

    // E1, accepted debt: the same stale token now succeeds, because `.eq("updated_at", …)` is
    // attached only when `deltaDays !== 0` (`src/actions/index.ts:168-170`). A name-only edit is
    // therefore unguarded and last-write-wins. Pinned as observed behaviour, not endorsed — if the
    // guard is ever made unconditional, this assertion is the one that should fail first.
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
