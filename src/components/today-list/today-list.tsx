import { startTransition, useEffect, useRef, useState } from "react";
import { actions } from "astro:actions";
import { toast } from "sonner";
import { Button, LinkButton } from "@/components/ui/button";
import {
  classifyDueStatus,
  compareDueRecords,
  formatDueLabel,
  formatIntervalLabel,
  formatShortDate,
  msUntilNextLocalMidnight,
  todayLocalDateString,
} from "@/lib/date";
import { getSeasonLabel, getSeason, selectSeasonInterval } from "@/lib/season";
import { cn, prefersReducedMotion } from "@/lib/utils";
import type { PlantListItem } from "@/types";
import {
  ANIMATION_MS,
  BOOTSTRAP_ROW_COUNT,
  formatOverdueDate,
  getActionLabel,
  getFailureMessage,
  getSuccessMessage,
} from "./utils";
import type { ActionKind, MutationResult, NoticeContext, TodayListProps } from "./types";

type OptimisticPlant = PlantListItem & { leaving?: boolean };

function updateSet(ids: Set<string>, id: string, present: boolean): Set<string> {
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
  const [leavingIds, setLeavingIds] = useState<Set<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const removalTimeouts = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const notices = useRef(new Map<string, NoticeContext>());

  function getRowButton(plantId: string, kind: ActionKind) {
    return buttonRefs.current.get(`${plantId}:${kind}`) ?? buttonRefs.current.get(`${plantId}:watered`);
  }

  function focusNextAction(plantId: string, kind: ActionKind) {
    const currentIndex = dueList.findIndex((plant) => plant.id === plantId);
    const nextButton =
      currentIndex >= 0 && currentIndex + 1 < dueList.length
        ? getRowButton(dueList[currentIndex + 1].id, kind)
        : undefined;

    if (nextButton) {
      nextButton.focus();

      return;
    }

    const alternateButton = dueList
      .filter((plant) => plant.id !== plantId)
      .map((plant) => getRowButton(plant.id, kind))
      .find(Boolean);

    if (alternateButton) {
      alternateButton.focus();

      return;
    }

    headingRef.current?.focus();
  }

  function clearPending(plantId: string) {
    setPendingIds((current) => updateSet(current, plantId, false));
  }

  function removePlant(plantId: string) {
    setBasePlants((current) => current.filter((plant) => plant.id !== plantId));
    setLeavingIds((current) => updateSet(current, plantId, false));
  }

  function scheduleRemoval(plantId: string, callback: () => void) {
    if (prefersReducedMotion()) {
      callback();

      return;
    }

    const timeoutId = setTimeout(() => {
      removalTimeouts.current.delete(plantId);
      callback();
    }, ANIMATION_MS);

    removalTimeouts.current.set(plantId, timeoutId);
  }

  function showUndoNotice(result: MutationResult, kind: ActionKind, plant: PlantListItem, keyboard: boolean) {
    const noticeId = result.event_id;
    const context = { kind, plant, result, keyboard } satisfies NoticeContext;

    notices.current.set(noticeId, context);
    toast.success(getSuccessMessage(kind, plant.name, result.new_due_on), {
      id: noticeId,
      duration: 10_000,
      action: {
        label: "Undo",
        onClick: () => {
          handleUndo(noticeId);
        },
      },
    });
  }

  function showActionFailure(kind: ActionKind, plant: PlantListItem) {
    toast.error(getFailureMessage(kind, plant.name), {
      action: {
        label: "Retry",
        onClick: () => {
          handleAction(plant, kind, false);
        },
      },
    });
  }

  function handleAction(plant: PlantListItem, kind: ActionKind, keyboard: boolean) {
    if (pendingIds.has(plant.id)) {
      return;
    }

    setPendingIds((current) => updateSet(current, plant.id, true));
    setLeavingIds((current) => updateSet(current, plant.id, true));

    if (keyboard) {
      focusNextAction(plant.id, kind);
    }

    const clientDate = todayLocalDateString();
    const formData = new FormData();
    const mutation = kind === "watered" ? actions.markWatered : actions.postponePlant;

    formData.set("plantId", plant.id);
    formData.set("clientDate", clientDate);

    startTransition(async () => {
      try {
        const { data, error } = await mutation(formData);

        if (error) {
          throw error;
        }

        scheduleRemoval(plant.id, () => {
          removePlant(plant.id);
          clearPending(plant.id);
          showUndoNotice(data as MutationResult, kind, plant, keyboard);
        });
      } catch {
        setLeavingIds((current) => updateSet(current, plant.id, false));
        clearPending(plant.id);
        showActionFailure(kind, plant);

        if (keyboard) {
          requestAnimationFrame(() => {
            buttonRefs.current.get(`${plant.id}:${kind}`)?.focus();
          });
        }
      }
    });
  }

  function handleUndo(noticeId: string) {
    const context = notices.current.get(noticeId);

    if (!context) {
      return;
    }

    toast.loading(`Undoing ${context.plant.name}…`, { id: noticeId, duration: Infinity });

    startTransition(async () => {
      const formData = new FormData();

      formData.set("eventId", noticeId);

      try {
        const { data, error } = await actions.undoWateringEvent(formData);

        if (error) {
          throw error;
        }

        setToday(todayLocalDateString());
        setBasePlants((current) => {
          const restoredPlant = { ...context.plant, next_due_on: data.restored_due_on };

          if (data.restored_due_on > todayLocalDateString()) {
            return current;
          }

          return [...current.filter((plant) => plant.id !== context.plant.id), restoredPlant].sort(compareDueRecords);
        });
        notices.current.delete(noticeId);
        toast.dismiss(noticeId);

        if (context.keyboard) {
          requestAnimationFrame(() => {
            getRowButton(context.plant.id, context.kind)?.focus();
          });
        }
      } catch {
        toast.error(`Couldn't undo ${context.plant.name}. Try again.`, {
          id: noticeId,
          duration: 10_000,
          action: {
            label: "Retry",
            onClick: () => {
              handleUndo(noticeId);
            },
          },
        });
      }
    });
  }

  const optimisticPlants: OptimisticPlant[] = basePlants.map((plant) => ({
    ...plant,
    leaving: leavingIds.has(plant.id),
  }));
  const dueList = today === null ? [] : optimisticPlants.filter((plant) => plant.next_due_on <= today);
  const activeDueList = dueList.filter((plant) => !plant.leaving);
  const nextUpcoming = today === null ? null : (basePlants.find((plant) => plant.next_due_on > today) ?? null);

  useEffect(() => {
    // The Worker cannot know the browser's calendar date on the first request, so the
    // client-local date is only known once this effect runs after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reveals the browser-local bootstrap contract
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
        <ul aria-label="Loading plants">
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
        <h1 ref={headingRef} tabIndex={-1} className="mb-6 text-2xl font-medium outline-none">
          Today
        </h1>
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
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-medium outline-none">
            Today
          </h1>
          {activeDueList.length > 0 && (
            <p className="text-muted-foreground text-sm">
              {activeDueList.length} plant{activeDueList.length === 1 ? "" : "s"}{" "}
              {activeDueList.length === 1 ? "needs" : "need"} water
            </p>
          )}
        </div>
        <LinkButton href="/plants/new" size="sm">
          Add plant
        </LinkButton>
      </div>

      {activeDueList.length === 0 ? (
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
            const isLeaving = plant.leaving ?? false;
            const initial = plant.name.trim().charAt(0).toUpperCase() || "?";
            const dueStatus = classifyDueStatus(plant.next_due_on, today);
            const isOverdue = dueStatus !== "due-today";
            const isStrongOverdue = dueStatus === "overdue-strong";
            const pending = pendingIds.has(plant.id);
            const linkClasses = cn(
              "col-span-2 -m-3 flex gap-3 p-3 outline-0 focus-visible:after:border-ring focus-visible:after:ring-3 focus-visible:after:ring-ring/50 after:block after:absolute after:inset-0 after:content-[''] after:border after:border-transparent after:transition-all",
            );
            const metadataClasses = cn("text-sm", isOverdue ? "text-warning-foreground" : "text-muted-foreground");

            return (
              <li
                key={plant.id}
                className={cn(
                  "border-border relative -mx-4 grid grid-cols-[auto_1fr_auto] items-center gap-3 overflow-hidden border-b px-4 transition-[opacity,max-height,padding,background-color] duration-200 ease-out motion-reduce:transition-none",
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
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-4 shrink-0 rounded-full border-2",
                          isStrongOverdue ? "border-warning-accent bg-warning-accent" : "border-warning-foreground",
                        )}
                      />
                      <span className={metadataClasses}>
                        Overdue · Due {formatOverdueDate(plant.next_due_on, today)}
                      </span>
                      <span className={metadataClasses}>·</span>
                      <span className={cn("line-clamp-1", metadataClasses)}>
                        {getSeasonLabel(getSeason(today))} ·{" "}
                        {formatIntervalLabel(
                          selectSeasonInterval(today, plant.growing_interval_days, plant.dormancy_interval_days),
                        )}
                      </span>
                    </div>
                  ) : (
                    <p className={metadataClasses}>
                      {formatDueLabel(plant.next_due_on, today)} · {getSeasonLabel(getSeason(today))} ·{" "}
                      {formatIntervalLabel(
                        selectSeasonInterval(today, plant.growing_interval_days, plant.dormancy_interval_days),
                      )}
                    </p>
                  )}
                </div>
                <div className="z-1 flex min-w-0 flex-col items-stretch gap-1 sm:flex-row">
                  {(["watered", "postponed"] as const).map((kind) => (
                    <Button
                      key={kind}
                      ref={(node) => {
                        if (node) buttonRefs.current.set(`${plant.id}:${kind}`, node);
                        else buttonRefs.current.delete(`${plant.id}:${kind}`);
                      }}
                      variant={kind === "postponed" ? "secondary" : "default"}
                      size="sm"
                      aria-label={`${getActionLabel(kind)} ${plant.name}`}
                      isDisabled={pending}
                      onPress={(event) => {
                        handleAction(plant, kind, event.pointerType === "keyboard");
                      }}
                    >
                      {getActionLabel(kind)}
                    </Button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
