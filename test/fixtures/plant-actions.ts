import { server } from "@/actions/index";
import { createActionContext } from "./action-context";
import type { IntegrationUserFixture } from "./user";

export type UpdatePlantFormInput = {
  clientDate: string;
  dormancyIntervalDays: number;
  growingIntervalDays: number;
  name: string;
  photo?: File;
  plantId: string;
  removePhoto?: boolean;
  updatedAt: string;
};

// The plantId + clientDate pair is the shared shape of markWatered and postponePlant.
export function createPlantActionFormData(plantId: string, clientDate: string) {
  const formData = new FormData();

  formData.set("plantId", plantId);
  formData.set("clientDate", clientDate);

  return formData;
}

export function createEventActionFormData(eventId: string) {
  const formData = new FormData();

  formData.set("eventId", eventId);

  return formData;
}

export function createUpdatePlantFormData({
  clientDate,
  dormancyIntervalDays,
  growingIntervalDays,
  name,
  photo,
  plantId,
  removePhoto = false,
  updatedAt,
}: UpdatePlantFormInput) {
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

export async function markPlantWatered(userFixture: IntegrationUserFixture, plantId: string, clientDate: string) {
  const context = createActionContext(userFixture);

  return server.markWatered.orThrow.call(context, createPlantActionFormData(plantId, clientDate));
}
