import { expect, test } from "vitest";
import { MAX_PHOTO_BYTES, PHOTO_GUIDANCE } from "@/lib/photo";
import { createAddPlantFormData, postActionForm } from "../../test/fixtures/http-actions";
import {
  createHeicFile,
  createPaddedJpegFile,
  expectPhotoAvailable,
  expectPlantPhotoUploadAbsent,
} from "../../test/fixtures/photos";
import { getIntegrationUserFixture } from "../../test/fixtures/user";

async function expectPersistedPhoto(
  userFixture: Awaited<ReturnType<typeof getIntegrationUserFixture>>,
  plantName: string,
) {
  let photoPath: string | null = null;
  let plantId: string | null = null;

  const { data: plant, error } = await userFixture.client
    .from("plants")
    .select("id, photo_path")
    .eq("name", plantName)
    .single();

  expect(error).toBeNull();
  expect(plant?.photo_path?.startsWith(`${userFixture.userId}/`)).toBe(true);

  if (!plant?.photo_path) {
    throw new Error("Expected addPlant to persist a photo path.");
  }

  photoPath = plant.photo_path;
  plantId = plant.id;

  return { photoPath, plantId };
}

async function removePersistedPhoto(
  userFixture: Awaited<ReturnType<typeof getIntegrationUserFixture>>,
  plantName: string,
  photoPath: string,
  plantId: string,
) {
  const { error: photoError } = await userFixture.client.storage.from("plant-photos").remove([photoPath]);
  const { error: plantError } = await userFixture.client.from("plants").delete().eq("id", plantId);

  expect(photoError).toBeNull();
  expect(plantError).toBeNull();
  await expectPlantPhotoUploadAbsent(userFixture, plantName);
}

test("submits a multipart addPlant request and persists a downloadable photo", async () => {
  const userFixture = await getIntegrationUserFixture();
  const plantName = userFixture.createUniqueName("http-upload");
  const formData = createAddPlantFormData(plantName);
  const photo = await createPaddedJpegFile(512 * 1024);
  let photoPath: string | null = null;
  let plantId: string | null = null;

  formData.set("photo", photo);

  try {
    const response = await postActionForm(userFixture, "addPlant", formData);

    expect(response.ok).toBe(true);
    ({ photoPath, plantId } = await expectPersistedPhoto(userFixture, plantName));
    await expectPhotoAvailable(userFixture, photoPath);
  } finally {
    if (photoPath && plantId) {
      await removePersistedPhoto(userFixture, plantName, photoPath, plantId);
    }
  }
});

test("persists an exactly maximum-size JPEG with byte-identical storage", async () => {
  const userFixture = await getIntegrationUserFixture();
  const plantName = userFixture.createUniqueName("http-exact-limit");
  const formData = createAddPlantFormData(plantName);
  const photo = await createPaddedJpegFile(MAX_PHOTO_BYTES);
  let photoPath: string | null = null;
  let plantId: string | null = null;

  formData.set("photo", photo);

  try {
    const response = await postActionForm(userFixture, "addPlant", formData);
    const uploadedBytes = new Uint8Array(await photo.arrayBuffer());

    expect(response.ok).toBe(true);
    ({ photoPath, plantId } = await expectPersistedPhoto(userFixture, plantName));

    const downloadedPhoto = await expectPhotoAvailable(userFixture, photoPath);
    const downloadedBytes = new Uint8Array(await downloadedPhoto.arrayBuffer());

    expect(downloadedBytes).toEqual(uploadedBytes);
  } finally {
    if (photoPath && plantId) {
      await removePersistedPhoto(userFixture, plantName, photoPath, plantId);
    }
  }
});

test("persists a just-below-limit JPEG", async () => {
  const userFixture = await getIntegrationUserFixture();
  const plantName = userFixture.createUniqueName("http-near-limit");
  const formData = createAddPlantFormData(plantName);
  const photo = await createPaddedJpegFile(MAX_PHOTO_BYTES - 1024);
  let photoPath: string | null = null;
  let plantId: string | null = null;

  formData.set("photo", photo);

  try {
    const response = await postActionForm(userFixture, "addPlant", formData);

    expect(response.ok).toBe(true);
    ({ photoPath, plantId } = await expectPersistedPhoto(userFixture, plantName));

    const downloadedPhoto = await expectPhotoAvailable(userFixture, photoPath);

    expect(downloadedPhoto.size).toBe(photo.size);
  } finally {
    if (photoPath && plantId) {
      await removePersistedPhoto(userFixture, plantName, photoPath, plantId);
    }
  }
});

test("rejects an oversized JPEG at the action body limit without side effects", async () => {
  const userFixture = await getIntegrationUserFixture();
  const plantName = userFixture.createUniqueName("http-oversized");
  const formData = createAddPlantFormData(plantName);
  const photo = await createPaddedJpegFile(12 * 1024 * 1024);

  formData.set("photo", photo);

  const response = await postActionForm(userFixture, "addPlant", formData);
  const error = (await response.json()) as unknown;

  expect(response.status).toBe(413);
  expect(error).toMatchObject({ code: "CONTENT_TOO_LARGE" });
  await expectPlantPhotoUploadAbsent(userFixture, plantName);
});

test("rejects HEIC input with photo guidance and no side effects", async () => {
  const userFixture = await getIntegrationUserFixture();
  const plantName = userFixture.createUniqueName("http-heic");
  const formData = createAddPlantFormData(plantName);
  const photo = createHeicFile();

  formData.set("photo", photo);

  const response = await postActionForm(userFixture, "addPlant", formData);
  const error = (await response.json()) as unknown;

  // This verifies the server contract, not that the user saw this guidance; the device smoke owns that claim.
  expect(response.status).toBe(400);
  expect(JSON.stringify(error)).toContain(PHOTO_GUIDANCE);
  expect(JSON.stringify(error)).not.toContain("INTERNAL_SERVER_ERROR");
  await expectPlantPhotoUploadAbsent(userFixture, plantName);
});
