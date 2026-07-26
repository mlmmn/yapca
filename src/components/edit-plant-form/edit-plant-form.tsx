import { useEffect, useRef, useState, type ChangeEvent, type SyntheticEvent } from "react";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { z } from "astro/zod";
import { actions } from "astro:actions";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NumberField, NumberFieldGroup, NumberFieldInput, NumberFieldSuffix } from "@/components/ui/number-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { useBrowserToday } from "@/components/hooks/use-browser-today";
import { Input } from "@/components/ui/input";
import { getBrowserToday } from "@/lib/timezone";
import { buildSchedulePreview, getSaveErrorState, SAVE_ERROR_MESSAGES } from "./utils";
import { isValidPhoto, PHOTO_ACCEPT, PHOTO_GUIDANCE } from "@/lib/photo";
import { cn } from "@/lib/utils";
import type { EditPlantFormProps, PhotoIntent } from "./types";
import type { SaveErrorState } from "./utils";

const editPlantSchema = z.object({
  name: z.string().trim().min(1, "Enter a plant name"),
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
});

export default function EditPlantForm({
  plantId,
  name,
  growingIntervalDays,
  dormancyIntervalDays,
  nextDueOn,
  updatedAt,
  photoUrl,
  today,
}: EditPlantFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveAlertRef = useRef<HTMLDivElement>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoIntent, setPhotoIntent] = useState<PhotoIntent>("keep");
  const [saveError, setSaveError] = useState<SaveErrorState | null>(null);
  const [announcedPreview, setAnnouncedPreview] = useState("");
  const browserToday = useBrowserToday(today);
  const form = useForm({
    defaultValues: {
      name,
      growingIntervalDays,
      dormancyIntervalDays,
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: editPlantSchema,
    },
    onSubmit: async ({ value }) => {
      const clientDate = getBrowserToday();

      setSaveError(null);

      if (clientDate === null) {
        setSaveError("client-date-unavailable");

        return;
      }

      const formData = new FormData();

      formData.set("plantId", plantId);
      formData.set("name", value.name.trim());
      formData.set("growing_interval_days", String(value.growingIntervalDays));
      formData.set("dormancy_interval_days", String(value.dormancyIntervalDays));
      formData.set("removePhoto", String(photoIntent === "remove"));
      formData.set("updated_at", updatedAt);
      formData.set("clientDate", clientDate);

      if (photoIntent === "replace" && photoFile) {
        formData.set("photo", photoFile);
      }

      try {
        const { error } = await actions.updatePlant(formData);

        if (error) {
          const errorState = getSaveErrorState(error.code);

          if (errorState === "not-found") {
            window.location.assign(`/plants/${plantId}`);

            return;
          }

          setSaveError(errorState);

          return;
        }
      } catch {
        setSaveError("generic");

        return;
      }

      window.location.assign(`/plants/${plantId}`);
    },
  });

  const photoUrlToShow = photoIntent === "remove" ? null : (photoPreview ?? photoUrl);
  const photoRemovable = photoUrl !== null || photoIntent === "replace";
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  function updatePreviewAnnouncement() {
    const { growingIntervalDays: currentGrowingIntervalDays, dormancyIntervalDays: currentDormancyIntervalDays } =
      form.state.values;

    setAnnouncedPreview(
      buildSchedulePreview({
        today: browserToday,
        oldNextDue: nextDueOn,
        oldGrowingIntervalDays: growingIntervalDays,
        oldDormancyIntervalDays: dormancyIntervalDays,
        newGrowingIntervalDays: currentGrowingIntervalDays,
        newDormancyIntervalDays: currentDormancyIntervalDays,
      }),
    );
  }

  function focusFirstInvalidControl() {
    const invalidControl = formRef.current?.querySelector<HTMLElement>(
      "input[aria-invalid='true'], button[aria-invalid='true'], [role='spinbutton'][aria-invalid='true']",
    );

    invalidControl?.focus();
  }

  async function handleFormSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    setSaveError(null);
    updatePreviewAnnouncement();

    await form.handleSubmit();
    focusFirstInvalidControl();
  }

  function handleIntervalBlur() {
    updatePreviewAnnouncement();
  }

  function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!isValidPhoto(file)) {
      setPhotoError(PHOTO_GUIDANCE);
      event.target.value = "";

      return;
    }

    setPhotoError(null);
    setPhotoFile(file);
    setPhotoIntent("replace");
    setPhotoPreview(URL.createObjectURL(file));
  }

  function handleRemovePhoto() {
    setPhotoError(null);
    setPhotoFile(null);
    setPhotoIntent("remove");
    setPhotoPreview(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleUndoPhotoRemoval() {
    setPhotoError(null);
    setPhotoFile(null);
    setPhotoIntent("keep");
    setPhotoPreview(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function openPhotoPicker() {
    fileInputRef.current?.click();
  }

  function reloadPlant() {
    window.location.reload();
  }

  function renderPhotoAction() {
    if (photoIntent === "remove") {
      return (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onPress={handleUndoPhotoRemoval}
          className="min-h-11 w-fit px-0"
        >
          Undo photo removal
        </Button>
      );
    }

    if (!photoRemovable) {
      return null;
    }

    return (
      <Button type="button" variant="ghost" size="sm" onPress={handleRemovePhoto} className="min-h-11 w-fit px-0">
        Remove photo
      </Button>
    );
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

  useEffect(() => {
    if (saveError) {
      saveAlertRef.current?.focus();
    }
  }, [saveError]);

  return (
    <form ref={formRef} className="space-y-6" onSubmit={(event) => void handleFormSubmit(event)}>
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
                  aria-describedby={`${field.name}-error`}
                />
                <FieldError id={`${field.name}-error`} errors={field.state.meta.errors} />
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
                  onBlur={() => {
                    field.handleBlur();
                    handleIntervalBlur();
                  }}
                  isInvalid={field.state.meta.errors.length > 0}
                  aria-describedby={`${field.name}-description ${field.name}-error`}
                >
                  <NumberFieldGroup>
                    <NumberFieldInput
                      aria-invalid={field.state.meta.errors.length > 0}
                      aria-describedby={`${field.name}-description ${field.name}-error`}
                    />
                    <NumberFieldSuffix>days</NumberFieldSuffix>
                  </NumberFieldGroup>
                </NumberField>
                <FieldDescription id={`${field.name}-description`}>March–October</FieldDescription>
                <FieldError id={`${field.name}-error`} errors={field.state.meta.errors} />
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
                  onBlur={() => {
                    field.handleBlur();
                    handleIntervalBlur();
                  }}
                  isInvalid={field.state.meta.errors.length > 0}
                  aria-describedby={`${field.name}-description ${field.name}-error`}
                >
                  <NumberFieldGroup>
                    <NumberFieldInput
                      aria-invalid={field.state.meta.errors.length > 0}
                      aria-describedby={`${field.name}-description ${field.name}-error`}
                    />
                    <NumberFieldSuffix>days</NumberFieldSuffix>
                  </NumberFieldGroup>
                </NumberField>
                <FieldDescription id={`${field.name}-description`}>November–February</FieldDescription>
                <FieldError id={`${field.name}-error`} errors={field.state.meta.errors} />
              </FieldContent>
            </Field>
          )}
        </form.Field>

        <form.Subscribe
          selector={(state) => ({
            growingIntervalDays: state.values.growingIntervalDays,
            dormancyIntervalDays: state.values.dormancyIntervalDays,
          })}
        >
          {({ growingIntervalDays: currentGrowingIntervalDays, dormancyIntervalDays: currentDormancyIntervalDays }) => {
            const previewText = buildSchedulePreview({
              today: browserToday,
              oldNextDue: nextDueOn,
              oldGrowingIntervalDays: growingIntervalDays,
              oldDormancyIntervalDays: dormancyIntervalDays,
              newGrowingIntervalDays: currentGrowingIntervalDays,
              newDormancyIntervalDays: currentDormancyIntervalDays,
            });

            return (
              <div
                className="border-border focus-visible:ring-ring/50 focus-visible:border-ring border-y py-4 outline-none focus-visible:ring-3"
                role="group"
                tabIndex={0}
                aria-labelledby="schedule-preview-label"
                aria-describedby="schedule-preview-value"
              >
                <p id="schedule-preview-label" className="mb-1 text-sm font-medium">
                  Schedule preview
                </p>
                <p id="schedule-preview-value" className="text-muted-foreground text-sm break-words">
                  {previewText}
                </p>
              </div>
            );
          }}
        </form.Subscribe>

        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {announcedPreview}
        </p>

        <Field data-invalid={photoError !== null || undefined}>
          <FieldLabel htmlFor="photo">Photo</FieldLabel>
          <FieldContent>
            <div className="flex items-center gap-3">
              <div className="bg-muted text-muted-foreground flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg">
                {photoUrlToShow ? (
                  <img src={photoUrlToShow} alt="" className="size-full object-cover" />
                ) : (
                  <span className="text-xl font-medium">{initial}</span>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <Button type="button" variant="outline" size="sm" onPress={openPhotoPicker} className="min-h-11">
                  Replace photo
                </Button>
                {renderPhotoAction()}
              </div>
            </div>
            <input
              ref={fileInputRef}
              id="photo"
              name="photo"
              type="file"
              accept={PHOTO_ACCEPT}
              onChange={handlePhotoChange}
              tabIndex={-1}
              className="sr-only"
              aria-invalid={photoError !== null}
              aria-describedby="photo-guidance photo-error"
            />
            <FieldDescription id="photo-guidance">
              {photoIntent === "remove" ? "Photo will be removed when you save." : PHOTO_GUIDANCE}
            </FieldDescription>
            {photoError && <FieldError id="photo-error">{photoError}</FieldError>}
          </FieldContent>
        </Field>
      </FieldGroup>

      {saveError && (
        <div
          ref={saveAlertRef}
          tabIndex={-1}
          className="border-border bg-muted space-y-3 rounded-lg border p-3 outline-none"
          role="alert"
        >
          <p className="text-sm">{SAVE_ERROR_MESSAGES[saveError]}</p>
          {saveError === "conflict" && (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onPress={reloadPlant} className="min-h-11">
                Reload plant
              </Button>
              <a href={`/plants/${plantId}`} className={cn(buttonVariants({ variant: "ghost" }), "min-h-11")}>
                Back to plant
              </a>
            </div>
          )}
        </div>
      )}

      <form.Subscribe selector={(state) => ({ valid: state.isValid, submitting: state.isSubmitting })}>
        {({ valid, submitting }) => {
          const submitReady = valid && !submitting && browserToday !== null;

          return (
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              <Button type="submit" isDisabled={!submitReady} className="min-h-11 w-full sm:w-fit">
                {submitting ? "Saving changes…" : "Save changes"}
              </Button>
              <a
                href={`/plants/${plantId}`}
                className={cn(buttonVariants({ variant: "ghost" }), "min-h-11 w-full sm:w-fit")}
              >
                Cancel
              </a>
            </div>
          );
        }}
      </form.Subscribe>
    </form>
  );
}
