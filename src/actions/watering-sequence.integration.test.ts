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
      // Both intervals pinned so the reschedule assertion below is season-independent — mark_watered
      // selects the interval from the season of acted_on, so a growing-only value would make this
      // test fail from 1 Nov. Matches harness.integration.test.ts.
      dormancyIntervalDays: 7,
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

    // Known PRD divergence, pinned deliberately. The PRD's prose says the task moves "exactly 2 days
    // forward" (`context/foundation/prd.md:56`) / "forward by two days" (`:141`), which reads as
    // prev_due_on + 2; FR-012 itself (`:111`) is neutral — "postpone a watering task by 2 days". The
    // shipped contract is *action date* + 2, chosen deliberately so postponing an overdue task cannot
    // leave it still overdue in Today (`context/archive/2026-07-23-postpone-and-undo/plan.md:34`), and
    // the UI copy says only "Postpone 2 days" (`src/components/today-list/utils.ts:14`), so nothing
    // user-facing promises the other reading. The assertion below discriminates: this plant is overdue
    // by 10, so prev_due_on + 2 would be -8. Awaiting a product decision — see the plan's Open Risks.
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

  // Regression: undo rejects an out-of-order event when new_due_on collides. A value-based guard
  // is ambiguous here, so the explicit event stack provides the LIFO identity instead.
  //
  // Two same-day postpones write E1{prev: D0, new: T+2} and E2{prev: T+2, new: T+2} — the second's
  // prev and new are equal, because the plant was already at T+2. Undo's currency guard compares
  // `plants.next_due_on = event.new_due_on` by *value*, so E1 passes it despite E2 being the later
  // event: undoing E1 sets the plant to D0 and deletes E1, leaving E2 claiming a transition from
  // T+2 that no longer holds and permanently un-undoable with P0003. The same collision occurs for
  // any plant whose interval is 2.
  //
  test("rejects an out-of-order undo when same-day postpones share a due date", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const originalDueOn = addDays(clientDate, -3);
    const postponedDueOn = addDays(clientDate, 2);
    const userFixture = await getIntegrationUserFixture();
    const plant = await createPlantFixture({ dueOffsetDays: -3, referenceDay: clientDate, userFixture });
    const firstEvent = await postponePlant(plant.id, clientDate);
    const secondEvent = await postponePlant(plant.id, clientDate);
    const postponedState = await readPlantState(userFixture, plant.id);

    // The colliding journal shape itself — this is what makes the value-based guard ambiguous.
    expect(postponedState.plant.next_due_on).toBe(postponedDueOn);
    expect(postponedState.wateringEvents).toEqual([
      expect.objectContaining({ id: firstEvent.event_id, new_due_on: postponedDueOn, prev_due_on: originalDueOn }),
      expect.objectContaining({
        id: secondEvent.event_id,
        new_due_on: postponedDueOn,
        prev_due_on: postponedDueOn,
        previous_event_id: firstEvent.event_id,
      }),
    ]);
    expect(postponedState.plant.current_watering_event_id).toBe(secondEvent.event_id);

    // Out of order: E2 is the current transition, so undoing E1 must be refused rather than
    // silently accepted on a value match.
    await expect(undoWateringEvent(firstEvent.event_id)).rejects.toMatchObject({ code: "CONFLICT" });

    const refusedState = await readPlantState(userFixture, plant.id);

    expect(refusedState.plant.next_due_on).toBe(postponedDueOn);
    expect(refusedState.wateringEvents).toHaveLength(2);

    // In order: E2 then E1 — neither is stranded, and the plant returns to where it started.
    await undoWateringEvent(secondEvent.event_id);

    const afterSecondUndoState = await readPlantState(userFixture, plant.id);

    expect(afterSecondUndoState.plant.current_watering_event_id).toBe(firstEvent.event_id);

    await undoWateringEvent(firstEvent.event_id);

    const unwoundState = await readPlantState(userFixture, plant.id);

    expect(unwoundState.plant.next_due_on).toBe(originalDueOn);
    expect(unwoundState.wateringEvents).toEqual([]);
    expect(unwoundState.plant.current_watering_event_id).toBeNull();
  });

  // Regression: a schedule-changing edit moves every reachable undo window by its delta, so undo
  // reverses the action while preserving the interval edit's immediate schedule effect.
  test("keeps a pending undo valid after a schedule-changing plant edit", async () => {
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

    const amendedState = await readPlantState(userFixture, plant.id);

    expect(amendedState.plant.next_due_on).toBe(addDays(wateredState.plant.next_due_on, 1));
    expect(amendedState.wateringEvents).toEqual([
      expect.objectContaining({
        id: event.event_id,
        new_due_on: addDays(wateredState.wateringEvents[0].new_due_on, 1),
        prev_due_on: addDays(wateredState.wateringEvents[0].prev_due_on, 1),
      }),
    ]);

    await undoWateringEvent(event.event_id);

    const state = await readPlantState(userFixture, plant.id);

    expect(state.plant.next_due_on).toBe(addDays(originalDueOn, 1));
    expect(state.wateringEvents).toEqual([]);
  });

  test("retains a schedule-edit delta through a two-event unwind", async () => {
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
    const firstEvent = await markPlantWatered(plant.id, clientDate);
    const secondEvent = await markPlantWatered(plant.id, clientDate);
    const wateredState = await readPlantState(userFixture, plant.id);

    await updatePlantSchedule({
      clientDate,
      dormancyIntervalDays: wateredState.plant.dormancy_interval_days + 1,
      growingIntervalDays: wateredState.plant.growing_interval_days + 1,
      name: wateredState.plant.name,
      plantId: plant.id,
      updatedAt: wateredState.plant.updated_at,
    });

    const amendedState = await readPlantState(userFixture, plant.id);

    for (const event of wateredState.wateringEvents) {
      expect(amendedState.wateringEvents).toContainEqual(
        expect.objectContaining({
          id: event.id,
          new_due_on: addDays(event.new_due_on, 1),
          prev_due_on: addDays(event.prev_due_on, 1),
        }),
      );
    }

    await undoWateringEvent(secondEvent.event_id);

    const afterSecondUndoState = await readPlantState(userFixture, plant.id);

    expect(afterSecondUndoState.plant.next_due_on).toBe(addDays(wateredState.wateringEvents[1].prev_due_on, 1));

    await undoWateringEvent(firstEvent.event_id);

    const unwoundState = await readPlantState(userFixture, plant.id);

    expect(unwoundState.plant.next_due_on).toBe(addDays(originalDueOn, 1));
    expect(unwoundState.plant.current_watering_event_id).toBeNull();
    expect(unwoundState.wateringEvents).toEqual([]);
  });

  test("preserves a divergent legacy stack during a later schedule edit", async () => {
    const clientDate = getTodayInTimeZone("UTC");
    const userFixture = await getIntegrationUserFixture();
    const plant = await createPlantFixture({ dueOffsetDays: -2, referenceDay: clientDate, userFixture });
    const event = await markPlantWatered(plant.id, clientDate);
    const wateredState = await readPlantState(userFixture, plant.id);
    const divergentDueOn = addDays(wateredState.plant.next_due_on, 3);
    const { error } = await userFixture.client
      .from("plants")
      .update({ next_due_on: divergentDueOn })
      .eq("id", plant.id);

    expect(error).toBeNull();

    const divergentState = await readPlantState(userFixture, plant.id);

    await updatePlantSchedule({
      clientDate,
      dormancyIntervalDays: divergentState.plant.dormancy_interval_days + 1,
      growingIntervalDays: divergentState.plant.growing_interval_days + 1,
      name: divergentState.plant.name,
      plantId: plant.id,
      updatedAt: divergentState.plant.updated_at,
    });

    const amendedState = await readPlantState(userFixture, plant.id);

    expect(amendedState.plant.next_due_on).toBe(addDays(divergentDueOn, 1));
    expect(amendedState.wateringEvents).toEqual(divergentState.wateringEvents);

    await expect(undoWateringEvent(event.event_id)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    const refusedState = await readPlantState(userFixture, plant.id);

    expect(refusedState).toEqual(amendedState);
  });
});
