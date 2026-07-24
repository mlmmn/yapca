import { useEffect, useMemo, useRef, useState } from "react";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { z } from "astro/zod";
import { actions } from "astro:actions";
import { toast } from "sonner";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NumberField, NumberFieldGroup, NumberFieldInput, NumberFieldSuffix } from "@/components/ui/number-field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { todayLocalDateString } from "@/lib/date";
import { getSeason, getSeasonLabel, selectSeasonInterval } from "@/lib/season";
import { cn } from "@/lib/utils";

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PHOTO_GUIDANCE = "Choose a JPEG, PNG, or WebP image up to 4 MB.";

const addPlantSchema = z.object({
  name: z.string().min(1, "Enter a plant name"),
  growingIntervalDays: z
    .number({ error: "Choose a number from 1 to 365" })
    .refine((value) => Number.isInteger(value) && value >= 1 && value <= 365, {
      error: "Choose a number from 1 to 365",
    }),
  dormancyIntervalDays: z
    .number({ error: "Choose a number from 1 to 365" })
    .refine((value) => Number.isInteger(value) && value >= 1 && value <= 365, {
      error: "Choose a number from 1 to 365",
    }),
  firstAppearance: z.enum(["today", "after"]),
});

export default function AddPlantForm() {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const localDate = useMemo(() => todayLocalDateString(), []);
  const activeSeason = getSeason(localDate);
  const activeSeasonLabel = getSeasonLabel(activeSeason);

  const form = useForm({
    defaultValues: {
      name: "",
      growingIntervalDays: 7,
      dormancyIntervalDays: 7,
      firstAppearance: "today" as "today" | "after",
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: addPlantSchema,
    },
    onSubmit: async ({ value }) => {
      const formData = new FormData();

      formData.set("name", value.name);
      formData.set("growing_interval_days", String(value.growingIntervalDays));
      formData.set("dormancy_interval_days", String(value.dormancyIntervalDays));
      formData.set("clientDate", localDate);

      if (value.firstAppearance === "after") {
        formData.set("alreadyWatered", "true");
      }

      if (photoFile) {
        formData.set("photo", photoFile);
      }

      const message = "We couldn't save this plant. Check your connection and try again.";

      try {
        const { error } = await actions.addPlant(formData);

        if (error) {
          toast.error(message);

          return;
        }
      } catch {
        // actions.addPlant rejects (rather than resolving to { error }) on a
        // network-level failure such as being offline, so it must be caught here too.
        toast.error(message);

        return;
      }

      window.location.assign("/");
    },
  });

  function handlePhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      setPhotoFile(null);
      setPhotoPreview(null);
      setPhotoError(null);

      return;
    }

    if (!ALLOWED_PHOTO_TYPES.has(file.type) || file.size > MAX_PHOTO_BYTES) {
      setPhotoError(PHOTO_GUIDANCE);
      event.target.value = "";

      return;
    }

    setPhotoError(null);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  function handleRemovePhoto() {
    setPhotoFile(null);
    setPhotoPreview(null);
    setPhotoError(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) {
      nameInputRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    return () => {
      if (photoPreview) {
        URL.revokeObjectURL(photoPreview);
      }
    };
  }, [photoPreview]);

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field name="name">
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
              <FieldLabel htmlFor={field.name}>Plant name</FieldLabel>
              <FieldContent>
                <Input
                  ref={nameInputRef}
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                  aria-invalid={field.state.meta.errors.length > 0}
                />
                <FieldError errors={field.state.meta.errors} />
              </FieldContent>
            </Field>
          )}
        </form.Field>

        <form.Field name="growingIntervalDays">
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
              <FieldLabel htmlFor={field.name}>Growing season</FieldLabel>
              <FieldContent>
                <NumberField
                  id={field.name}
                  name={field.name}
                  minValue={1}
                  maxValue={365}
                  value={field.state.value}
                  onChange={(value) => {
                    field.handleChange(value);
                  }}
                  onBlur={field.handleBlur}
                  isInvalid={field.state.meta.errors.length > 0}
                >
                  <NumberFieldGroup>
                    <NumberFieldInput />
                    <NumberFieldSuffix>days</NumberFieldSuffix>
                  </NumberFieldGroup>
                </NumberField>
                <FieldDescription>March–October</FieldDescription>
                <FieldError errors={field.state.meta.errors} />
              </FieldContent>
            </Field>
          )}
        </form.Field>

        <form.Field name="dormancyIntervalDays">
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
              <FieldLabel htmlFor={field.name}>Dormancy season</FieldLabel>
              <FieldContent>
                <NumberField
                  id={field.name}
                  name={field.name}
                  minValue={1}
                  maxValue={365}
                  value={field.state.value}
                  onChange={(value) => {
                    field.handleChange(value);
                  }}
                  onBlur={field.handleBlur}
                  isInvalid={field.state.meta.errors.length > 0}
                >
                  <NumberFieldGroup>
                    <NumberFieldInput />
                    <NumberFieldSuffix>days</NumberFieldSuffix>
                  </NumberFieldGroup>
                </NumberField>
                <FieldDescription>November–February</FieldDescription>
                <FieldError errors={field.state.meta.errors} />
              </FieldContent>
            </Field>
          )}
        </form.Field>

        <form.Field name="firstAppearance">
          {(field) => (
            <form.Subscribe
              selector={(state) => ({
                growingIntervalDays: state.values.growingIntervalDays,
                dormancyIntervalDays: state.values.dormancyIntervalDays,
              })}
            >
              {({ growingIntervalDays, dormancyIntervalDays }) => {
                const growingInterval =
                  Number.isInteger(growingIntervalDays) && growingIntervalDays > 0 ? growingIntervalDays : 1;
                const dormancyInterval =
                  Number.isInteger(dormancyIntervalDays) && dormancyIntervalDays > 0 ? dormancyIntervalDays : 1;
                const activeInterval = selectSeasonInterval(localDate, growingInterval, dormancyInterval);

                return (
                  <Field>
                    <FieldLabel>When should it first appear?</FieldLabel>
                    <FieldContent>
                      <RadioGroup
                        value={field.state.value}
                        onChange={(value) => {
                          field.handleChange(value as "today" | "after");
                        }}
                      >
                        <RadioGroupItem value="today">
                          <span>Today</span>
                          <FieldDescription>It needs water now.</FieldDescription>
                        </RadioGroupItem>
                        <RadioGroupItem value="after">
                          <span>
                            After {activeInterval} day{activeInterval === 1 ? "" : "s"}
                          </span>
                          <FieldDescription>I watered it today · {activeSeasonLabel}</FieldDescription>
                        </RadioGroupItem>
                      </RadioGroup>
                    </FieldContent>
                  </Field>
                );
              }}
            </form.Subscribe>
          )}
        </form.Field>

        <Field>
          <FieldLabel htmlFor="photo">Photo (optional)</FieldLabel>
          <FieldContent>
            {photoPreview ? (
              <div className="flex items-center gap-3">
                <img
                  src={photoPreview}
                  alt=""
                  className="border-border h-16 w-16 shrink-0 rounded-lg border object-cover"
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-sm">{photoFile?.name}</span>
                  <Button type="button" variant="ghost" size="sm" onPress={handleRemovePhoto} className="w-fit px-0">
                    Remove photo
                  </Button>
                </div>
              </div>
            ) : (
              <input
                ref={fileInputRef}
                id="photo"
                name="photo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handlePhotoChange}
                className="text-muted-foreground file:text-foreground file:bg-secondary w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:px-3 file:py-1.5 file:text-sm file:font-medium"
              />
            )}
            <FieldDescription>{PHOTO_GUIDANCE}</FieldDescription>
            {photoError && <FieldError>{photoError}</FieldError>}
          </FieldContent>
        </Field>
      </FieldGroup>

      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(submitting) => (
          <Button type="submit" isDisabled={submitting} className={cn("w-full sm:w-fit")}>
            {submitting ? "Saving plant…" : "Save plant"}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
