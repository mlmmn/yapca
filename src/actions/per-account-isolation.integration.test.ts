import { describe, expect, test } from "vitest";
import { server } from "@/actions/index";
import { buildPhotoPath, resolvePhotoUrl } from "@/lib/photo";
import { getTodayInTimeZone } from "@/lib/timezone";
import { createActionContext } from "../../test/fixtures/action-context";
import { expectActionNotFound, expectStorageDenied } from "../../test/fixtures/denial";
import {
  createEventActionFormData,
  createPlantActionFormData,
  markPlantWatered,
} from "../../test/fixtures/plant-actions";
import {
  createPhotoFile,
  downloadPhoto,
  expectPhotoAbsent,
  expectPhotoAvailable,
  uploadPhotoFixture,
} from "../../test/fixtures/photos";
import { createPlantFixture, readPlantState } from "../../test/fixtures/plants";
import { getIntegrationUserFixture } from "../../test/fixtures/user";

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

    // Seeded so the snapshot's ordered watering_events array is non-empty: an empty-to-empty
    // comparison would not detect a reordering or a mutation of an existing event.
    await markPlantWatered(ownerFixture, ownerPlant.id, clientDate);

    const beforeState = await readPlantState(ownerFixture, ownerPlant.id);

    expect(beforeState.wateringEvents.length).toBeGreaterThan(0);

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

    // Seeded for the same reason as the markWatered case: a non-empty event array is what makes
    // the "complete ordered watering_events" half of the snapshot meaningful.
    await markPlantWatered(ownerFixture, ownerPlant.id, clientDate);

    const beforeState = await readPlantState(ownerFixture, ownerPlant.id);

    expect(beforeState.wateringEvents.length).toBeGreaterThan(0);

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

    expect(beforeState.wateringEvents.length).toBeGreaterThan(0);

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
    await expectPhotoAbsent(ownerFixture, ownerPath);
  });
});
