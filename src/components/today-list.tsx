import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useOptimistic } from "react";
import { actions } from "astro:actions";
import { toast } from "sonner";

import { cn, prefersReducedMotion } from "@/lib/utils";
import {
  classifyDueStatus,
  formatDueLabel,
  formatIntervalLabel,
  formatShortDate,
  msUntilNextLocalMidnight,
  todayLocalDateString,
} from "@/lib/date";
import { Button, LinkButton } from "@/components/ui/button";
import type { PlantListItem } from "@/types";

const ANIMATION_MS = 190;
const BOOTSTRAP_ROW_COUNT = 3;

function formatOverdueDate(dateString: string, today: string): string {
  const [dueYear, dueMonth, dueDay] = dateString.split("-").map(Number);
  const [todayYear] = today.split("-").map(Number);

  const date = new Date(dueYear, dueMonth - 1, dueDay);

  if (dueYear === todayYear) {
    return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

type TodayListProps = {
  plants: PlantListItem[];
  fetchError?: boolean;
};

// While a "Watered" action is in flight the row stays mounted with `deleting`
// set, so it can animate its collapse; `basePlants` commits the real removal.
type OptimisticPlant = PlantListItem & { deleting?: boolean };

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
  const [optimisticPlants, markDeleting] = useOptimistic<OptimisticPlant[], string>(basePlants, (state, deletingId) =>
    state.map((plant) => (plant.id === deletingId ? { ...plant, deleting: true } : plant)),
  );
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
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

    // Urgent update so the button disables immediately, before the transition.
    setPendingIds((prev) => toggleId(prev, plant.id, true));

    const clientDate = todayLocalDateString();
    const formData = new FormData();
    formData.set("plantId", plant.id);
    formData.set("clientDate", clientDate);

    startTransition(async () => {
      // Called before any `await`, so the optimistic overlay is genuinely held
      // for the whole action: the row collapses and stays collapsed until
      // markWatered resolves, then reverts on its own if the action throws.
      markDeleting(plant.id);

      try {
        const { error } = await actions.markWatered(formData);
        if (error) {
          throw error;
        }

        // Let the collapse animation finish while the overlay still holds, then
        // commit the permanent removal so the row unmounts already-collapsed.
        if (!prefersReducedMotion()) {
          await new Promise<void>((resolve) => {
            removalTimeouts.current.set(plant.id, setTimeout(resolve, ANIMATION_MS));
          });
          removalTimeouts.current.delete(plant.id);
        }

        // State updates after an `await` must be re-wrapped to stay in the transition.
        startTransition(() => {
          setBasePlants((prev) => prev.filter((p) => p.id !== plant.id));
          setPendingIds((prev) => toggleId(prev, plant.id, false));
        });
      } catch {
        // basePlants is untouched, so ending the action reverts the optimistic
        // overlay and the row animates back open via the max-height transition.
        startTransition(() => {
          setPendingIds((prev) => toggleId(prev, plant.id, false));
        });

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
    });
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
            const isLeaving = plant.deleting ?? false;
            const initial = plant.name.trim().charAt(0).toUpperCase() || "?";
            const dueStatus = classifyDueStatus(plant.next_due_on, today);
            const isOverdue = dueStatus !== "due-today";
            const isStrongOverdue = dueStatus === "overdue-strong";

            const linkClasses = cn(
              "col-span-2 -m-3 flex gap-3 p-3 outline-0 focus-visible:after:border-ring focus-visible:after:ring-3 focus-visible:after:ring-ring/50 after:block after:absolute after:inset-0 after:content-[''] after:border after:border-transparent after:transition-all",
            );

            const metadataClasses = cn("text-sm", isOverdue ? "text-warning-foreground" : "text-muted-foreground");

            return (
              <li
                key={plant.id}
                className={cn(
                  "border-border relative -mx-4 grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b px-4 transition-[opacity,max-height,padding,background-color] duration-200 ease-out motion-reduce:transition-none",
                  isLeaving ? "max-h-0 py-0 opacity-0" : "max-h-40 py-3 opacity-100",
                  isOverdue &&
                    (isStrongOverdue ? "bg-warning hover:bg-warning/80" : "bg-warning/20 hover:bg-warning/30"),
                  !isOverdue && "hover:bg-muted",
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
                  <a href={`/plants/${plant.id}`} className={linkClasses}>
                    <p className="line-clamp-2 font-medium">{plant.name}</p>
                  </a>
                  {isOverdue ? (
                    <div className="flex flex-wrap items-center gap-1">
                      <svg
                        className={cn(
                          "size-4 shrink-0",
                          isStrongOverdue ? "text-warning-accent" : "text-warning-foreground",
                        )}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        {isStrongOverdue ? (
                          <circle cx="12" cy="12" r="10" fill="currentColor" />
                        ) : (
                          <circle cx="12" cy="12" r="10" />
                        )}
                        <path
                          className={cn(isStrongOverdue && "text-background")}
                          d="M12 6v6M12 18h.01"
                          stroke="currentColor"
                        />
                      </svg>
                      <span className={metadataClasses}>
                        Overdue · Due {formatOverdueDate(plant.next_due_on, today)}
                      </span>
                      <span className={metadataClasses}>·</span>
                      <span className={cn("line-clamp-1", metadataClasses)}>
                        {formatIntervalLabel(plant.interval_days)}
                      </span>
                    </div>
                  ) : (
                    <p className={metadataClasses}>
                      {formatDueLabel(plant.next_due_on, today)} · {formatIntervalLabel(plant.interval_days)}
                    </p>
                  )}
                </div>
                <Button
                  ref={(node) => {
                    if (node) {
                      buttonRefs.current.set(plant.id, node);
                    } else {
                      buttonRefs.current.delete(plant.id);
                    }
                  }}
                  className="z-1"
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
