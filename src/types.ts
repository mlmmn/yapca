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
  plantId: string;
  next_due_on: string;
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
  event_type: string;
  watered_on: string;
  prev_due_on: string;
  new_due_on: string;
};
