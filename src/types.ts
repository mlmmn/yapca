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
