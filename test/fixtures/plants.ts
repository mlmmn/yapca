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
  photoPath?: string | null;
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
  photoPath = null,
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
      photo_path: photoPath,
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

  const wateringEvents = await tryReadWateringEvents(userFixture, plantId);

  return { plant, wateringEvents };
}

export async function tryReadPlant(userFixture: IntegrationUserFixture, plantId: string): Promise<PlantRow | null> {
  const { data, error } = await userFixture.client.from("plants").select("*").eq("id", plantId).maybeSingle();

  if (error) {
    throw new Error(`Failed to read plant ${plantId}: ${error.message}`);
  }

  return data;
}

export async function tryReadWateringEvents(
  userFixture: IntegrationUserFixture,
  plantId: string,
): Promise<WateringEventRow[]> {
  const { data, error } = await userFixture.client
    .from("watering_events")
    .select("*")
    .eq("plant_id", plantId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to read watering events for ${plantId}: ${error.message}`);
  }

  return data;
}

export async function tryReadWateringEventById(
  userFixture: IntegrationUserFixture,
  eventId: string,
): Promise<WateringEventRow | null> {
  const { data, error } = await userFixture.client.from("watering_events").select("*").eq("id", eventId).maybeSingle();

  if (error) {
    throw new Error(`Failed to read watering event ${eventId}: ${error.message}`);
  }

  return data;
}
