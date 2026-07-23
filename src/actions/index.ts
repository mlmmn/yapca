import { ActionError, defineAction, type ActionAPIContext } from "astro:actions";
import { z } from "astro/zod";
import { createClient } from "@/lib/supabase";
import { isValidDateString, nextDue } from "@/lib/interval";

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

const PHOTO_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const clientDateSchema = z.string().refine(isValidDateString, "Invalid date");

const photoSchema = z
  .instanceof(File)
  .refine((file) => file.size <= MAX_PHOTO_BYTES, "Photo must be 4 MB or smaller")
  .refine((file) => file.type in PHOTO_MIME_EXTENSIONS, "Photo must be a JPEG, PNG, or WebP image");

function requireSession(context: ActionAPIContext) {
  const supabase = createClient(context.request.headers, context.cookies);

  if (!supabase || !context.locals.user) {
    throw new ActionError({ code: "UNAUTHORIZED", message: "You must be signed in." });
  }

  return { supabase, user: context.locals.user };
}

export const server = {
  addPlant: defineAction({
    accept: "form",
    input: z.object({
      name: z.string().min(1, "Name is required"),
      interval_days: z.coerce.number().int().min(1).max(365),
      alreadyWatered: z.preprocess((v) => v === "true", z.boolean()),
      clientDate: clientDateSchema,
      photo: photoSchema.optional(),
    }),
    handler: async (input, context) => {
      const { supabase, user } = requireSession(context);
      const next_due_on = input.alreadyWatered ? nextDue(input.clientDate, input.interval_days) : input.clientDate;
      let photo_path: string | null = null;

      if (input.photo) {
        const extension = PHOTO_MIME_EXTENSIONS[input.photo.type];

        photo_path = `${user.id}/${crypto.randomUUID()}.${extension}`;

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
          interval_days: input.interval_days,
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

  markWatered: defineAction({
    accept: "form",
    input: z.object({
      plantId: z.uuid(),
      clientDate: clientDateSchema,
    }),
    handler: async (input, context) => {
      const { supabase } = requireSession(context);

      const { data, error } = await supabase.rpc("mark_watered", {
        p_plant_id: input.plantId,
        p_acted_on: input.clientDate,
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
      clientDate: clientDateSchema,
    }),
    handler: async (input, context) => {
      const { supabase } = requireSession(context);
      const { data, error } = await supabase.rpc("postpone_plant", {
        p_plant_id: input.plantId,
        p_acted_on: input.clientDate,
      });

      if (error) {
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
