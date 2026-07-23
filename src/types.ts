import type { Database } from "@/lib/database.types";

export type Plant = Database["public"]["Tables"]["plants"]["Row"];

export type AddPlantInput = {
  name: string;
  interval_days: number;
  alreadyWatered: boolean;
  clientDate: string;
  photo?: File;
};

export type AddPlantOutput = Plant;

export type MarkWateredInput = {
  plantId: string;
  clientDate: string;
};

export type MarkWateredOutput = {
  event_id: string;
  plant_id: string;
  event_type: "watered";
  acted_on: string;
  prev_due_on: string;
  new_due_on: string;
};

export type PostponePlantInput = MarkWateredInput;

export type PostponePlantOutput = Omit<MarkWateredOutput, "event_type"> & {
  event_type: "postponed";
};

export type UndoWateringEventInput = {
  eventId: string;
};

export type UndoWateringEventOutput = {
  event_id: string;
  plant_id: string;
  restored_due_on: string;
};

export type PlantListItem = {
  id: string;
  name: string;
  interval_days: number;
  next_due_on: string;
  photoUrl: string | null;
};

export type WateringEvent = Database["public"]["Tables"]["watering_events"]["Row"];

export type JournalEntry = {
  id: string;
  event_type: "watered" | "postponed";
  acted_on: string;
  prev_due_on: string;
  new_due_on: string;
};
