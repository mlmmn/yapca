import { describe, expect, test } from "vitest";
import { server } from "@/actions/index";
import { buildPhotoPath, resolvePhotoUrl } from "@/lib/photo";
import { getTodayInTimeZone } from "@/lib/timezone";
import { createActionContext } from "../../test/fixtures/action-context";
import { expectActionNotFound, expectStorageDenied } from "../../test/fixtures/denial";
import { createPhotoFile, downloadPhoto, uploadPhotoFixture } from "../../test/fixtures/photos";
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

async function expectPhotoAvailable(userFixture: IntegrationUserFixture, path: string) {
  const result = await downloadPhoto(userFixture, path);

  expect(result.error).toBeNull();
  expect(result.data?.size).toBeGreaterThan(0);

  return result.data!;
}

async function expectPhotoAbsentForOwner(userFixture: IntegrationUserFixture, path: string) {
  const separatorIndex = path.lastIndexOf("/");
  const folder = path.slice(0, separatorIndex);
  const objectName = path.slice(separatorIndex + 1);
  const { data, error } = await userFixture.client.storage.from("plant-photos").list(folder);

  expect(error).toBeNull();

  if (!data) {
    throw new Error(`Expected an owner-scoped storage listing for ${folder}.`);
  }

  expect(data.map((entry) => entry.name)).not.toContain(objectName);
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

describe("storage.objects", () => {
  test("denies another account from downloading an uploaded photo", async () => {
    const attackerFixture = await getIntegrationUserFixture(1);
    const ownerFixture = await getIntegrationUserFixture();
    const ownerPath = buildPhotoPath(ownerFixture.userId, "image/png");

    await uploadPhotoFixture(ownerFixture, ownerPath);

    const attackerResult = await downloadPhoto(attackerFixture, ownerPath);

    expectStorageDenied(attackerResult);
    await expectPhotoAvailable(ownerFixture, ownerPath);
  });

  test("keeps a foreign photo path as a pointer leak rather than a content leak", async () => {
    const attackerFixture = await getIntegrationUserFixture(1);
    const ownerFixture = await getIntegrationUserFixture();
    const attackerPlant = await createPlantFixture({ dueOffsetDays: 0, userFixture: attackerFixture });
    const ownerPath = buildPhotoPath(ownerFixture.userId, "image/png");

    await uploadPhotoFixture(ownerFixture, ownerPath);

    const { data, error } = await attackerFixture.client
      .from("plants")
      .update({ photo_path: ownerPath })
      .eq("id", attackerPlant.id)
      .select()
      .single();
    const ownerUrl = await resolvePhotoUrl(ownerFixture.client, ownerPath);
    const attackerUrl = await resolvePhotoUrl(attackerFixture.client, ownerPath);

    // This is a pointer leak, not a content leak: B may store A's string on B's own row, but
    // only A can resolve it through Storage into a usable signed URL.
    expect(error).toBeNull();
    expect(data).toMatchObject({ id: attackerPlant.id, photo_path: ownerPath });
    expect(ownerUrl).not.toBeNull();
    expect(attackerUrl).toBeNull();
  });

  test("denies another account from uploading into an owner folder", async () => {
    const attackerFixture = await getIntegrationUserFixture(1);
    const ownerFixture = await getIntegrationUserFixture();
    const ownerPath = buildPhotoPath(ownerFixture.userId, "image/png");
    const attackerPhoto = createPhotoFile("foreign-insert.png");
    const attackerResult = await attackerFixture.client.storage.from("plant-photos").upload(ownerPath, attackerPhoto, {
      contentType: attackerPhoto.type,
    });

    expectStorageDenied(attackerResult);
    await uploadPhotoFixture(ownerFixture, ownerPath);
    await expectPhotoAvailable(ownerFixture, ownerPath);
  });

  test("denies another account from replacing an owner photo", async () => {
    const attackerFixture = await getIntegrationUserFixture(1);
    const ownerFixture = await getIntegrationUserFixture();
    const ownerPath = buildPhotoPath(ownerFixture.userId, "image/png");
    const attackerPhoto = createPhotoFile("foreign-update.png");
    const ownerReplacement = createPhotoFile("owner-replacement.png");

    await uploadPhotoFixture(ownerFixture, ownerPath);

    const baselinePhoto = await expectPhotoAvailable(ownerFixture, ownerPath);
    const baselineText = await baselinePhoto.text();
    const attackerResult = await attackerFixture.client.storage.from("plant-photos").upload(ownerPath, attackerPhoto, {
      contentType: attackerPhoto.type,
      upsert: true,
    });

    expectStorageDenied(attackerResult);

    const preservedPhoto = await expectPhotoAvailable(ownerFixture, ownerPath);

    expect(await preservedPhoto.text()).toBe(baselineText);

    const { error } = await ownerFixture.client.storage.from("plant-photos").upload(ownerPath, ownerReplacement, {
      contentType: ownerReplacement.type,
      upsert: true,
    });

    expect(error).toBeNull();

    const replacedPhoto = await expectPhotoAvailable(ownerFixture, ownerPath);

    expect(await replacedPhoto.text()).toBe("fixture photo: owner-replacement.png");
  });

  test("denies another account from deleting an owner photo", async () => {
    const attackerFixture = await getIntegrationUserFixture(1);
    const ownerFixture = await getIntegrationUserFixture();
    const ownerPath = buildPhotoPath(ownerFixture.userId, "image/png");

    await uploadPhotoFixture(ownerFixture, ownerPath);

    const { error: attackerError } = await attackerFixture.client.storage.from("plant-photos").remove([ownerPath]);

    // A denied remove may be a policy-filtered no-op, so the owner's successful download is the
    // isolation assertion rather than the response shape of the remove call.
    expect(attackerError).toBeNull();
    await expectPhotoAvailable(ownerFixture, ownerPath);

    const { error: ownerError } = await ownerFixture.client.storage.from("plant-photos").remove([ownerPath]);

    expect(ownerError).toBeNull();
    await expectPhotoAbsentForOwner(ownerFixture, ownerPath);
  });
});
