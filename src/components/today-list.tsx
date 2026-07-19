import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useOptimistic } from "react";
import { actions } from "astro:actions";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button, LinkButton } from "@/components/ui/button";
import type { PlantListItem } from "@/types";

const ANIMATION_MS = 190;
const BOOTSTRAP_ROW_COUNT = 3;

type TodayListProps = {
  plants: PlantListItem[];
  fetchError?: boolean;
};

function todayLocalDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function msUntilNextLocalMidnight(): number {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return nextMidnight.getTime() - now.getTime();
}

function parseLocalDateString(dateString: string): Date {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatShortDate(dateString: string): string {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(
    parseLocalDateString(dateString),
  );
}

function formatDueLabel(dateString: string, today: string): string {
  return dateString === today ? "Due today" : `Due ${formatShortDate(dateString)}`;
}

function formatIntervalLabel(intervalDays: number): string {
  return `Every ${intervalDays} day${intervalDays === 1 ? "" : "s"}`;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function toggleId(ids: Set<string>, id: string, present: boolean): Set<string> {
  const next = new Set(ids);
  if (present) {
    next.add(id);
  } else {
    next.delete(id);
  }
  return next;
}

export default function TodayList({ plants, fetchError = false }: TodayListProps) {
  const [today, setToday] = useState<string | null>(null);
  const [basePlants, setBasePlants] = useState<PlantListItem[]>(plants);
  const [optimisticPlants, removeOptimistically] = useOptimistic(
    basePlants,
    (state: PlantListItem[], removedId: string) => state.filter((plant) => plant.id !== removedId),
  );
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [leavingIds, setLeavingIds] = useState<Set<string>>(new Set());
  const [enteringIds, setEnteringIds] = useState<Set<string>>(new Set());
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const removalTimeouts = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    // The Worker cannot know the browser's calendar date on the first request, so the
    // client-local date is only known once this effect runs after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reveals the browser-local bootstrap; see the SSR/hydration contract in plan.md Phase 4
    setToday(todayLocalDateString());
    let timer: ReturnType<typeof setTimeout>;
    function scheduleRollover() {
      timer = setTimeout(() => {
        setToday(todayLocalDateString());
        scheduleRollover();
      }, msUntilNextLocalMidnight());
    }
    scheduleRollover();
    return () => {
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const timeouts = removalTimeouts.current;
    return () => {
      timeouts.forEach((timeoutId) => {
        clearTimeout(timeoutId);
      });
    };
  }, []);

  function handleWatered(plant: PlantListItem) {
    if (pendingIds.has(plant.id)) {
      return;
    }

    setPendingIds((prev) => toggleId(prev, plant.id, true));
    setLeavingIds((prev) => toggleId(prev, plant.id, true));

    const clientDate = todayLocalDateString();
    const formData = new FormData();
    formData.set("plantId", plant.id);
    formData.set("clientDate", clientDate);

    function commitRemoval() {
      removalTimeouts.current.delete(plant.id);
      startTransition(() => {
        removeOptimistically(plant.id);
      });
    }

    if (prefersReducedMotion()) {
      commitRemoval();
    } else {
      removalTimeouts.current.set(plant.id, setTimeout(commitRemoval, ANIMATION_MS));
    }

    async function run() {
      try {
        const { error } = await actions.markWatered(formData);
        if (error) {
          throw error;
        }

        startTransition(() => {
          setBasePlants((prev) => prev.filter((p) => p.id !== plant.id));
          setPendingIds((prev) => toggleId(prev, plant.id, false));
          setLeavingIds((prev) => toggleId(prev, plant.id, false));
        });
      } catch {
        const scheduledRemoval = removalTimeouts.current.get(plant.id);
        if (scheduledRemoval) {
          clearTimeout(scheduledRemoval);
          removalTimeouts.current.delete(plant.id);
        }

        startTransition(() => {
          setBasePlants((prev) => [...prev]);
          setPendingIds((prev) => toggleId(prev, plant.id, false));
          setLeavingIds((prev) => toggleId(prev, plant.id, false));
        });

        if (!prefersReducedMotion()) {
          setEnteringIds((prev) => toggleId(prev, plant.id, true));
          setTimeout(() => {
            setEnteringIds((prev) => toggleId(prev, plant.id, false));
          }, ANIMATION_MS);
        }

        toast.error(`Couldn't mark ${plant.name} watered. Try again.`, {
          action: {
            label: "Retry",
            onClick: () => {
              handleWatered(plant);
            },
          },
        });

        requestAnimationFrame(() => {
          buttonRefs.current.get(plant.id)?.focus();
        });
      }
    }

    void run();
  }

  const dueList = useMemo(() => {
    if (today === null) {
      return [];
    }
    return optimisticPlants.filter((plant) => plant.next_due_on <= today);
  }, [optimisticPlants, today]);

  const nextUpcoming = useMemo(() => {
    if (today === null) {
      return null;
    }
    return basePlants.find((plant) => plant.next_due_on > today) ?? null;
  }, [basePlants, today]);

  if (fetchError) {
    return (
      <div className="py-16 text-center">
        <h1 className="mb-4 text-2xl font-medium">Today</h1>
        <p className="text-muted-foreground mb-6 text-sm">We couldn&apos;t load your plants.</p>
        <Button
          onPress={() => {
            window.location.reload();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (today === null) {
    return (
      <div>
        <div className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-medium">Today</h1>
          <LinkButton href="/plants/new" size="sm">
            Add plant
          </LinkButton>
        </div>
        <ul>
          {Array.from({ length: BOOTSTRAP_ROW_COUNT }).map((_, index) => (
            <li key={index} className="border-border grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b py-3">
              <div className="bg-muted size-12 shrink-0 animate-pulse rounded-lg md:size-14" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="bg-muted h-4 w-2/3 animate-pulse rounded" />
                <div className="bg-muted h-3 w-1/3 animate-pulse rounded" />
              </div>
              <div className="bg-muted h-8 w-20 animate-pulse rounded-lg" />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (basePlants.length === 0) {
    return (
      <div className="py-16 text-center">
        <h1 className="mb-6 text-2xl font-medium">Today</h1>
        <p className="mb-1 font-medium">Add your first plant</p>
        <p className="text-muted-foreground mb-6 text-sm">
          Set a watering interval and it will appear here when it&apos;s due.
        </p>
        <LinkButton href="/plants/new">Add plant</LinkButton>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium">Today</h1>
          {dueList.length > 0 && (
            <p className="text-muted-foreground text-sm">
              {dueList.length} plant{dueList.length === 1 ? "" : "s"} {dueList.length === 1 ? "needs" : "need"} water
            </p>
          )}
        </div>
        <LinkButton href="/plants/new" size="sm">
          Add plant
        </LinkButton>
      </div>

      {dueList.length === 0 ? (
        <div className="py-10 text-center">
          <p className="mb-1 font-medium">Nothing needs water today.</p>
          {nextUpcoming && (
            <p className="text-muted-foreground mb-6 text-sm">
              Next: {nextUpcoming.name} on {formatShortDate(nextUpcoming.next_due_on)}
            </p>
          )}
          <LinkButton href="/plants/new" variant="secondary">
            Add plant
          </LinkButton>
        </div>
      ) : (
        <ul>
          {dueList.map((plant) => {
            const isLeaving = leavingIds.has(plant.id);
            const isEntering = enteringIds.has(plant.id);
            const initial = plant.name.trim().charAt(0).toUpperCase() || "?";

            return (
              <li
                key={plant.id}
                className={cn(
                  "border-border grid grid-cols-[auto_1fr_auto] items-center gap-3 overflow-hidden border-b transition-[opacity,max-height,padding] duration-200 ease-out motion-reduce:transition-none",
                  isLeaving ? "max-h-0 py-0 opacity-0" : "max-h-40 py-3 opacity-100",
                  isEntering && "animate-in fade-in duration-200 motion-reduce:animate-none",
                )}
              >
                <div className="bg-muted text-muted-foreground flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg md:size-14">
                  {plant.photoUrl ? (
                    <img src={plant.photoUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <span className="text-lg font-medium">{initial}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 font-medium">{plant.name}</p>
                  <p className="text-muted-foreground text-sm">
                    {formatDueLabel(plant.next_due_on, today)} · {formatIntervalLabel(plant.interval_days)}
                  </p>
                </div>
                <Button
                  ref={(node) => {
                    if (node) {
                      buttonRefs.current.set(plant.id, node);
                    } else {
                      buttonRefs.current.delete(plant.id);
                    }
                  }}
                  size="sm"
                  isDisabled={pendingIds.has(plant.id)}
                  onPress={() => {
                    handleWatered(plant);
                  }}
                >
                  Watered
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
