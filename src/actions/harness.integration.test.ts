import { describe, expect, test } from "vitest";
import { server } from "@/actions/index";
import { addDays } from "@/lib/date";
import { getTodayInTimeZone } from "@/lib/timezone";
import {
  createActionContext,
  createSessionlessActionContext,
  createUnauthenticatedActionContext,
} from "../../test/fixtures/action-context";
import { createPlantFixture, readPlantState } from "../../test/fixtures/plants";
import { getIntegrationUserFixture } from "../../test/fixtures/user";

describe("integration harness", () => {
  test("runs markWatered under a real authenticated session", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const userFixture = await getIntegrationUserFixture();
    const plant = await createPlantFixture({
      dueOffsetDays: 0,
      dormancyIntervalDays: 7,
      growingIntervalDays: 7,
      name: userFixture.createUniqueName("harness-plant"),
      referenceDay: clientDate,
      userFixture,
    });
    const context = createActionContext(userFixture);
    const formData = new FormData();

    formData.set("plantId", plant.id);
    formData.set("clientDate", clientDate);

    const result = await server.markWatered.orThrow.call(context, formData);
    const state = await readPlantState(userFixture, plant.id);

    expect(result).toMatchObject({
      acted_on: clientDate,
      event_type: "watered",
      new_due_on: addDays(clientDate, 7),
      plant_id: plant.id,
      prev_due_on: clientDate,
    });
    expect(state.plant.next_due_on).toBe(addDays(clientDate, 7));
    expect(state.wateringEvents).toHaveLength(1);
    expect(state.wateringEvents[0]).toMatchObject({
      acted_on: clientDate,
      event_type: "watered",
      new_due_on: addDays(clientDate, 7),
      plant_id: plant.id,
      prev_due_on: clientDate,
      user_id: userFixture.userId,
    });
  });

  // The `locals.user: null` case below only proves the app-level guard fires. This one proves
  // the substrate is unprivileged: the guard passes, the RPC is reached with no JWT, and
  // postgres refuses it (42501) — the observation the plan's "genuinely subject to auth rather
  // than running privileged" criterion actually asks for.
  test("cannot mutate through the database without a session cookie", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const userFixture = await getIntegrationUserFixture();
    const plant = await createPlantFixture({
      dueOffsetDays: 0,
      growingIntervalDays: 7,
      referenceDay: clientDate,
      userFixture,
    });
    const context = createSessionlessActionContext(userFixture);
    const formData = new FormData();

    formData.set("plantId", plant.id);
    formData.set("clientDate", clientDate);

    await expect(server.markWatered.orThrow.call(context, formData)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });

    const state = await readPlantState(userFixture, plant.id);

    expect(state.plant.next_due_on).toBe(clientDate);
    expect(state.wateringEvents).toHaveLength(0);
  });

  test("rejects a request without a session", async () => {
    const context = createUnauthenticatedActionContext();
    const formData = new FormData();

    formData.set("plantId", crypto.randomUUID());
    formData.set("clientDate", getTodayInTimeZone("UTC"));

    await expect(server.markWatered.orThrow.call(context, formData)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
