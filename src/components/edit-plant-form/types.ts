export type EditPlantFormProps = {
  plantId: string;
  name: string;
  growingIntervalDays: number;
  dormancyIntervalDays: number;
  nextDueOn: string;
  updatedAt: string;
  photoUrl: string | null;
  today: string | null;
};

export type PhotoIntent = "keep" | "replace" | "remove";
