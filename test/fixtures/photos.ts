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
