import { describe, expect, test } from "vitest";
import { server } from "@/actions/index";
import { addDays } from "@/lib/date";
import { getTodayInTimeZone } from "@/lib/timezone";
import { createActionContext } from "../../test/fixtures/action-context";
import { createPlantFixture, readPlantState } from "../../test/fixtures/plants";
import { getIntegrationUserFixture } from "../../test/fixtures/user";

function createPlantMutationFormData(plantId: string, clientDate: string) {
  const formData = new FormData();

  formData.set("plantId", plantId);
  formData.set("clientDate", clientDate);

  return formData;
}

function createUndoFormData(eventId: string) {
  const formData = new FormData();

  formData.set("eventId", eventId);

  return formData;
}

function createUpdateFormData({
  clientDate,
  dormancyIntervalDays,
  growingIntervalDays,
  name,
  plantId,
  updatedAt,
}: {
  clientDate: string;
  dormancyIntervalDays: number;
  growingIntervalDays: number;
  name: string;
  plantId: string;
  updatedAt: string;
}) {
  const formData = new FormData();

  formData.set("plantId", plantId);
  formData.set("name", name);
  formData.set("growing_interval_days", String(growingIntervalDays));
  formData.set("dormancy_interval_days", String(dormancyIntervalDays));
  formData.set("removePhoto", "false");
  formData.set("updated_at", updatedAt);
  formData.set("clientDate", clientDate);

  return formData;
}

async function markPlantWatered(plantId: string, clientDate: string) {
  const userFixture = await getIntegrationUserFixture();
  const context = createActionContext(userFixture);

  return server.markWatered.orThrow.call(context, createPlantMutationFormData(plantId, clientDate));
}

async function postponePlant(plantId: string, clientDate: string) {
  const userFixture = await getIntegrationUserFixture();
  const context = createActionContext(userFixture);

  return server.postponePlant.orThrow.call(context, createPlantMutationFormData(plantId, clientDate));
}

async function undoWateringEvent(eventId: string) {
  const userFixture = await getIntegrationUserFixture();
  const context = createActionContext(userFixture);

  return server.undoWateringEvent.orThrow.call(context, createUndoFormData(eventId));
}

async function updatePlantSchedule({
  clientDate,
  dormancyIntervalDays,
  growingIntervalDays,
  name,
  plantId,
  updatedAt,
}: {
  clientDate: string;
  dormancyIntervalDays: number;
  growingIntervalDays: number;
  name: string;
  plantId: string;
  updatedAt: string;
}) {
  const userFixture = await getIntegrationUserFixture();
  const context = createActionContext(userFixture);
  const formData = createUpdateFormData({
    clientDate,
    dormancyIntervalDays,
    growingIntervalDays,
    name,
    plantId,
    updatedAt,
  });

  return server.updatePlant.orThrow.call(context, formData);
}

describe("schedule mutation sequences", () => {
  test("returns the plant and journal to their original state after water, undo, postpone, and undo", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const originalDueOn = addDays(clientDate, -3);
    const userFixture = await getIntegrationUserFixture();
    const plant = await createPlantFixture({
      dueOffsetDays: -3,
      growingIntervalDays: 7,
      referenceDay: clientDate,
      userFixture,
    });
    const wateredEvent = await markPlantWatered(plant.id, clientDate);
    const wateredState = await readPlantState(userFixture, plant.id);

    expect(wateredState.plant.next_due_on).toBe(addDays(clientDate, 7));
    expect(wateredState.wateringEvents).toEqual([
      expect.objectContaining({
        acted_on: clientDate,
        event_type: "watered",
        id: wateredEvent.event_id,
        new_due_on: addDays(clientDate, 7),
        plant_id: plant.id,
        prev_due_on: originalDueOn,
      }),
    ]);

    await undoWateringEvent(wateredEvent.event_id);

    const restoredState = await readPlantState(userFixture, plant.id);

    expect(restoredState.plant.next_due_on).toBe(originalDueOn);
    expect(restoredState.wateringEvents).toEqual([]);

    const postponedEvent = await postponePlant(plant.id, clientDate);
    const postponedState = await readPlantState(userFixture, plant.id);

    // The detail journal renders prev_due_on; new_due_on is the value that governs undo.
    expect(postponedState.plant.next_due_on).toBe(addDays(clientDate, 2));
    expect(postponedState.wateringEvents).toEqual([
      expect.objectContaining({
        acted_on: clientDate,
        event_type: "postponed",
        id: postponedEvent.event_id,
        new_due_on: addDays(clientDate, 2),
        plant_id: plant.id,
        prev_due_on: originalDueOn,
      }),
    ]);

    await undoWateringEvent(postponedEvent.event_id);

    const finalState = await readPlantState(userFixture, plant.id);

    expect(finalState.plant.next_due_on).toBe(originalDueOn);
    expect(finalState.wateringEvents).toEqual([]);
  });

  test("postpones an overdue plant to the action date plus two days without changing its intervals", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const userFixture = await getIntegrationUserFixture();
    const plant = await createPlantFixture({
      dormancyIntervalDays: 30,
      dueOffsetDays: -10,
      growingIntervalDays: 7,
      referenceDay: clientDate,
      userFixture,
    });

    await postponePlant(plant.id, clientDate);

    const state = await readPlantState(userFixture, plant.id);

    // PRD §FR-012 says "2 days forward", but the deliberate contract is action date + 2.
    expect(state.plant.next_due_on).toBe(addDays(clientDate, 2));
    expect(state.plant.next_due_on).not.toBe(addDays(plant.next_due_on, 2));
    expect(state.plant.growing_interval_days).toBe(plant.growing_interval_days);
    expect(state.plant.dormancy_interval_days).toBe(plant.dormancy_interval_days);
  });

  test("identifies undo by event id and reports a repeated undo as not found", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const userFixture = await getIntegrationUserFixture();
    const plant = await createPlantFixture({ dueOffsetDays: 0, referenceDay: clientDate, userFixture });
    const event = await markPlantWatered(plant.id, clientDate);

    await undoWateringEvent(event.event_id);

    await expect(undoWateringEvent(event.event_id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("records a no-op event for two same-day postpones", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const userFixture = await getIntegrationUserFixture();
    const plant = await createPlantFixture({ dueOffsetDays: -1, referenceDay: clientDate, userFixture });

    await postponePlant(plant.id, clientDate);
    await postponePlant(plant.id, clientDate);

    const state = await readPlantState(userFixture, plant.id);

    expect(state.plant.next_due_on).toBe(addDays(clientDate, 2));
    expect(state.wateringEvents).toHaveLength(2);
    expect(state.wateringEvents[1]).toMatchObject({
      event_type: "postponed",
      new_due_on: addDays(clientDate, 2),
      prev_due_on: addDays(clientDate, 2),
    });
  });

  test("allows postponing a future-dated plant backwards to the action date plus two days", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const userFixture = await getIntegrationUserFixture();
    const plant = await createPlantFixture({ dueOffsetDays: 10, referenceDay: clientDate, userFixture });

    await postponePlant(plant.id, clientDate);

    const state = await readPlantState(userFixture, plant.id);

    // V11: the RPC has no due-state precondition, so this surprising behaviour is intentional today.
    expect(state.plant.next_due_on).toBe(addDays(clientDate, 2));
    expect(state.wateringEvents).toEqual([
      expect.objectContaining({ event_type: "postponed", prev_due_on: plant.next_due_on }),
    ]);
  });

  // V1 defect: undo must reject an out-of-order event when new_due_on collides; the value-based
  // guard currently accepts it and strands the second event. Expected correction is tracked by
  // context/changes/undo-integrity-defects/.
  test.skip("rejects an out-of-order undo when same-day postpones share a due date", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const userFixture = await getIntegrationUserFixture();
    const plant = await createPlantFixture({ dueOffsetDays: -3, referenceDay: clientDate, userFixture });
    const firstEvent = await postponePlant(plant.id, clientDate);

    await postponePlant(plant.id, clientDate);

    await expect(undoWateringEvent(firstEvent.event_id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // V3 defect: a schedule-changing edit must preserve the active undo transition; currently the
  // edit moves next_due_on without a journal row, so undo returns CONFLICT. Expected correction
  // is tracked by context/changes/undo-integrity-defects/.
  test.skip("keeps a pending undo valid after a schedule-changing plant edit", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const originalDueOn = addDays(clientDate, -2);
    const userFixture = await getIntegrationUserFixture();
    const plant = await createPlantFixture({
      dormancyIntervalDays: 30,
      dueOffsetDays: -2,
      growingIntervalDays: 7,
      referenceDay: clientDate,
      userFixture,
    });
    const event = await markPlantWatered(plant.id, clientDate);
    const wateredState = await readPlantState(userFixture, plant.id);

    await updatePlantSchedule({
      clientDate,
      dormancyIntervalDays: wateredState.plant.dormancy_interval_days + 1,
      growingIntervalDays: wateredState.plant.growing_interval_days + 1,
      name: wateredState.plant.name,
      plantId: plant.id,
      updatedAt: wateredState.plant.updated_at,
    });
    await undoWateringEvent(event.event_id);

    const state = await readPlantState(userFixture, plant.id);

    expect(state.plant.next_due_on).toBe(originalDueOn);
    expect(state.wateringEvents).toEqual([]);
  });
});
