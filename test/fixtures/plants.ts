import { addDays } from "@/lib/date";
import type { Tables } from "@/lib/database.types";
import { getTodayInTimeZone } from "@/lib/timezone";
import type { IntegrationUserFixture } from "./user";

type PlantRow = Tables<"plants">;
type WateringEventRow = Tables<"watering_events">;

export type CreatePlantFixtureInput = {
  dueOffsetDays: number;
  dormancyIntervalDays?: number;
  growingIntervalDays?: number;
  name?: string;
  referenceDay?: string;
  userFixture: IntegrationUserFixture;
};

export type PlantState = {
  plant: PlantRow;
  wateringEvents: WateringEventRow[];
};

export async function createPlantFixture({
  dueOffsetDays,
  dormancyIntervalDays = 30,
  growingIntervalDays = 7,
  name,
  referenceDay = getTodayInTimeZone("UTC"),
  userFixture,
}: CreatePlantFixtureInput) {
  const plantName = name ?? userFixture.createUniqueName("plant");
  const nextDueOn = addDays(referenceDay, dueOffsetDays);
  const plantId = crypto.randomUUID();
  const { data, error } = await userFixture.client
    .from("plants")
    .insert({
      dormancy_interval_days: dormancyIntervalDays,
      growing_interval_days: growingIntervalDays,
      id: plantId,
      name: plantName,
      next_due_on: nextDueOn,
      user_id: userFixture.userId,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create plant fixture ${plantName}: ${error.message}`);
  }

  return data;
}

export async function readPlantState(userFixture: IntegrationUserFixture, plantId: string): Promise<PlantState> {
  const { data: plant, error: plantError } = await userFixture.client
    .from("plants")
    .select("*")
    .eq("id", plantId)
    .single();

  if (plantError) {
    throw new Error(`Failed to read plant ${plantId}: ${plantError.message}`);
  }

  const { data: wateringEvents, error: wateringEventsError } = await userFixture.client
    .from("watering_events")
    .select("*")
    .eq("plant_id", plantId)
    .order("created_at", { ascending: true });

  if (wateringEventsError) {
    throw new Error(`Failed to read watering events for ${plantId}: ${wateringEventsError.message}`);
  }

  return { plant, wateringEvents };
}
