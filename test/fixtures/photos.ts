import { expect } from "vitest";
import type { IntegrationUserFixture } from "./user";

export function createPhotoFile(name = "plant.png") {
  return new File([`fixture photo: ${name}`], name, { type: "image/png" });
}

export async function uploadPhotoFixture(userFixture: IntegrationUserFixture, path: string) {
  const photo = createPhotoFile();
  const { error } = await userFixture.client.storage.from("plant-photos").upload(path, photo, {
    contentType: photo.type,
  });

  if (error) {
    throw new Error(`Failed to upload fixture photo ${path}: ${error.message}`);
  }
}

export async function downloadPhoto(userFixture: IntegrationUserFixture, path: string) {
  return userFixture.client.storage.from("plant-photos").download(path);
}

export async function expectPhotoAvailable(userFixture: IntegrationUserFixture, path: string) {
  const result = await downloadPhoto(userFixture, path);

  expect(result.error).toBeNull();
  expect(result.data?.size).toBeGreaterThan(0);

  if (!result.data) {
    throw new Error(`Expected a downloadable photo at ${path}.`);
  }

  return result.data;
}

// Asserts absence positively, by listing, rather than by expecting `download` to fail: *any*
// storage error satisfies "the download failed", so an expired or broken fixture session would
// read as "photo correctly deleted". A listing that succeeds and omits the object cannot.
// Always call this as the object's owner — a denied list also returns [], so a foreign-user
// listing proves nothing (see expectStorageDenied in ./denial for the cross-account shape).
export async function expectPhotoAbsent(userFixture: IntegrationUserFixture, path: string) {
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
