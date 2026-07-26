import { ActionError, defineAction, type ActionAPIContext } from "astro:actions";
import { z } from "astro/zod";
import { createClient } from "@/lib/supabase";
import { nextDue } from "@/lib/interval";
import { buildPhotoPath, isValidPhoto, PHOTO_GUIDANCE } from "@/lib/photo";
import { selectSeasonInterval } from "@/lib/season";
import { resolveScheduleChange } from "@/lib/schedule";
import { CLIENT_DATE_ERROR_CODE, CLIENT_DATE_ERROR_MESSAGE, isPlausibleClientDate } from "@/lib/date";
import { getTodayInTimeZone } from "@/lib/timezone";

const photoSchema = z.instanceof(File).refine(isValidPhoto, PHOTO_GUIDANCE);

function requireSession(context: ActionAPIContext) {
  const supabase = createClient(context.request.headers, context.cookies);

  if (!supabase || !context.locals.user) {
    throw new ActionError({ code: "UNAUTHORIZED", message: "You must be signed in." });
  }

  return { supabase, user: context.locals.user };
}

function getActionDate(clientDate: string | undefined): string {
  const utcToday = getTodayInTimeZone("UTC");

  if (!clientDate || !isPlausibleClientDate(clientDate, utcToday)) {
    throw new ActionError({ code: CLIENT_DATE_ERROR_CODE, message: CLIENT_DATE_ERROR_MESSAGE });
  }

  return clientDate;
}

export const server = {
  addPlant: defineAction({
    accept: "form",
    input: z.object({
      name: z.string().min(1, "Name is required"),
      growing_interval_days: z.coerce.number().int().min(1).max(365),
      dormancy_interval_days: z.coerce.number().int().min(1).max(365),
      alreadyWatered: z.preprocess((v) => v === "true", z.boolean()),
      clientDate: z.string().optional(),
      photo: photoSchema.optional(),
    }),
    handler: async (input, context) => {
      const { supabase, user } = requireSession(context);
      const actionDate = getActionDate(input.clientDate);
      const activeInterval = selectSeasonInterval(
        actionDate,
        input.growing_interval_days,
        input.dormancy_interval_days,
      );
      const next_due_on = input.alreadyWatered ? nextDue(actionDate, activeInterval) : actionDate;
      let photo_path: string | null = null;

      if (input.photo) {
        photo_path = buildPhotoPath(user.id, input.photo.type);

        const { error: uploadError } = await supabase.storage
          .from("plant-photos")
          .upload(photo_path, input.photo, { contentType: input.photo.type });

        if (uploadError) {
          throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to upload photo." });
        }
      }

      const { data, error } = await supabase
        .from("plants")
        .insert({
          user_id: user.id,
          name: input.name,
          growing_interval_days: input.growing_interval_days,
          dormancy_interval_days: input.dormancy_interval_days,
          next_due_on,
          photo_path,
        })
        .select()
        .single();

      if (error) {
        if (photo_path) {
          const { error: cleanupError } = await supabase.storage.from("plant-photos").remove([photo_path]);

          if (cleanupError) {
            // eslint-disable-next-line no-console -- best-effort cleanup failure must not mask the original insert error
            console.error("Failed to clean up uploaded photo after insert failure:", cleanupError);
          }
        }

        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to save plant." });
      }

      return data;
    },
  }),

  updatePlant: defineAction({
    accept: "form",
    input: z.object({
      plantId: z.uuid(),
      name: z.string().trim().min(1, "Enter a plant name"),
      growing_interval_days: z.coerce.number().int().min(1).max(365),
      dormancy_interval_days: z.coerce.number().int().min(1).max(365),
      photo: photoSchema.optional(),
      removePhoto: z.preprocess((value) => value === "true", z.boolean()),
      updated_at: z.string().min(1),
      clientDate: z.string().optional(),
    }),
    handler: async (input, context) => {
      const { supabase, user } = requireSession(context);
      const actionDate = getActionDate(input.clientDate);
      const { data: currentPlant, error: readError } = await supabase
        .from("plants")
        .select(
          "id, name, growing_interval_days, dormancy_interval_days, next_due_on, photo_path, updated_at, user_id, created_at",
        )
        .eq("id", input.plantId)
        .maybeSingle();

      if (readError) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to load plant." });
      }

      if (!currentPlant) {
        throw new ActionError({ code: "NOT_FOUND", message: "Plant not found." });
      }

      const scheduleChange = resolveScheduleChange({
        activeDay: actionDate,
        oldNextDue: currentPlant.next_due_on,
        oldGrowingIntervalDays: currentPlant.growing_interval_days,
        oldDormancyIntervalDays: currentPlant.dormancy_interval_days,
        newGrowingIntervalDays: input.growing_interval_days,
        newDormancyIntervalDays: input.dormancy_interval_days,
      });
      let nextPhotoPath: string | null | undefined;

      if (input.photo) {
        nextPhotoPath = buildPhotoPath(user.id, input.photo.type);
      } else if (input.removePhoto) {
        nextPhotoPath = null;
      }

      let uploadedPhotoPath: string | null = null;

      try {
        if (input.photo && nextPhotoPath) {
          const { error: uploadError } = await supabase.storage
            .from("plant-photos")
            .upload(nextPhotoPath, input.photo, { contentType: input.photo.type });

          if (uploadError) {
            throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to upload photo." });
          }

          uploadedPhotoPath = nextPhotoPath;
        }

        const payload = {
          name: input.name,
          growing_interval_days: input.growing_interval_days,
          dormancy_interval_days: input.dormancy_interval_days,
          ...(nextPhotoPath !== undefined ? { photo_path: nextPhotoPath } : {}),
          ...(scheduleChange.deltaDays !== 0 ? { next_due_on: scheduleChange.newNextDue } : {}),
        };
        let query = supabase.from("plants").update(payload).eq("id", input.plantId);

        if (scheduleChange.deltaDays !== 0) {
          query = query.eq("updated_at", input.updated_at);
        }

        const { data, error } = await query.select().maybeSingle();

        if (error) {
          throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to save plant." });
        }

        if (!data) {
          if (scheduleChange.deltaDays !== 0) {
            throw new ActionError({ code: "CONFLICT", message: "This plant changed elsewhere." });
          }

          throw new ActionError({ code: "NOT_FOUND", message: "Plant not found." });
        }

        if (currentPlant.photo_path && nextPhotoPath !== undefined && currentPlant.photo_path !== nextPhotoPath) {
          const { error: cleanupError } = await supabase.storage.from("plant-photos").remove([currentPlant.photo_path]);

          if (cleanupError) {
            // eslint-disable-next-line no-console -- best-effort old-photo cleanup must not mask a successful update
            console.error("Failed to clean up superseded plant photo:", cleanupError);
          }
        }

        return data;
      } catch (error) {
        if (uploadedPhotoPath) {
          const { error: cleanupError } = await supabase.storage.from("plant-photos").remove([uploadedPhotoPath]);

          if (cleanupError) {
            // eslint-disable-next-line no-console -- best-effort cleanup failure must not mask the original action error
            console.error("Failed to clean up uploaded photo after update failure:", cleanupError);
          }
        }

        if (error instanceof ActionError) {
          throw error;
        }

        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to save plant." });
      }
    },
  }),

  markWatered: defineAction({
    accept: "form",
    input: z.object({
      plantId: z.uuid(),
      clientDate: z.string().optional(),
    }),
    handler: async (input, context) => {
      const { supabase } = requireSession(context);
      const actionDate = getActionDate(input.clientDate);

      const { data, error } = await supabase.rpc("mark_watered", {
        p_plant_id: input.plantId,
        p_acted_on: actionDate,
      });

      if (error) {
        // eslint-disable-next-line no-console -- debug RPC errors
        console.error("mark_watered RPC error:", { code: error.code, message: error.message, details: error.details });

        if (error.code === "P0002") {
          throw new ActionError({ code: "NOT_FOUND", message: "Plant not found." });
        }

        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to mark plant watered." });
      }

      return data[0];
    },
  }),

  postponePlant: defineAction({
    accept: "form",
    input: z.object({
      plantId: z.uuid(),
      clientDate: z.string().optional(),
    }),
    handler: async (input, context) => {
      const { supabase } = requireSession(context);
      const actionDate = getActionDate(input.clientDate);
      const { data, error } = await supabase.rpc("postpone_plant", {
        p_plant_id: input.plantId,
        p_acted_on: actionDate,
      });

      if (error) {
        // eslint-disable-next-line no-console -- debug RPC errors
        console.error("postpone_plant RPC error:", {
          code: error.code,
          message: error.message,
          details: error.details,
        });

        if (error.code === "P0002") {
          throw new ActionError({ code: "NOT_FOUND", message: "Plant not found." });
        }

        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to postpone plant." });
      }

      return data[0];
    },
  }),

  undoWateringEvent: defineAction({
    accept: "form",
    input: z.object({ eventId: z.uuid() }),
    handler: async (input, context) => {
      const { supabase } = requireSession(context);
      const { data, error } = await supabase.rpc("undo_watering_event", {
        p_event_id: input.eventId,
      });

      if (error) {
        // eslint-disable-next-line no-console -- debug RPC errors
        console.error("undo_watering_event RPC error:", {
          code: error.code,
          message: error.message,
          details: error.details,
        });

        if (error.code === "P0002") {
          throw new ActionError({ code: "NOT_FOUND", message: "Event not found." });
        }

        if (error.code === "P0003") {
          throw new ActionError({ code: "CONFLICT", message: "This event is no longer current." });
        }

        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to undo event." });
      }

      return data[0];
    },
  }),
};
