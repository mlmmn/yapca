import { inject } from "vitest";
import type { IntegrationUserFixture } from "./user";
import { createActionRequestHeaders } from "./user";

export function createAddPlantFormData(name: string) {
  const formData = new FormData();
  const currentDate = new Date().toISOString().slice(0, 10);

  formData.set("name", name);
  formData.set("growing_interval_days", "7");
  formData.set("dormancy_interval_days", "30");
  formData.set("alreadyWatered", "false");
  formData.set("clientDate", currentDate);

  return formData;
}

export async function postActionForm(userFixture: IntegrationUserFixture, actionName: string, formData: FormData) {
  const baseUrl = inject("httpBaseUrl");
  const headers = createActionRequestHeaders(userFixture.cookieJar);
  const actionUrl = new URL(`/_actions/${actionName}`, baseUrl);

  headers.set("Origin", actionUrl.origin);

  return fetch(actionUrl, { body: formData, headers, method: "POST" });
}
