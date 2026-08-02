import { expect, test } from "vitest";
import { createAddPlantFormData, postActionForm } from "../../test/fixtures/http-actions";
import { createPaddedJpegFile, expectPhotoAbsent, expectPhotoAvailable } from "../../test/fixtures/photos";
import { getIntegrationUserFixture } from "../../test/fixtures/user";

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

    await expectPhotoAvailable(userFixture, photoPath);
  } finally {
    if (photoPath) {
      const { error } = await userFixture.client.storage.from("plant-photos").remove([photoPath]);

      expect(error).toBeNull();
    }

    if (plantId) {
      const { error } = await userFixture.client.from("plants").delete().eq("id", plantId);

      expect(error).toBeNull();
    }

    if (photoPath) {
      await expectPhotoAbsent(userFixture, photoPath);
    }

    if (plantId) {
      const { data, error } = await userFixture.client.from("plants").select("id").eq("id", plantId).maybeSingle();

      expect(error).toBeNull();
      expect(data).toBeNull();
    }
  }
});
