import type { MarkWateredOutput, PlantListItem, PostponePlantOutput } from "@/types";

export type ActionKind = "watered" | "postponed";
export type MutationResult = MarkWateredOutput | PostponePlantOutput;

export type TodayListProps = {
  plants: PlantListItem[];
  fetchError?: boolean;
};

export type NoticeContext = {
  kind: ActionKind;
  plant: PlantListItem;
  result: MutationResult;
  keyboard: boolean;
};
