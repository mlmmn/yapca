import { useEffect, useRef, useState } from "react";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { z } from "astro/zod";
import { actions } from "astro:actions";
import { toast } from "sonner";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NumberField, NumberFieldGroup, NumberFieldInput, NumberFieldSuffix } from "@/components/ui/number-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildSchedulePreview } from "./utils";
import { isValidPhoto, PHOTO_ACCEPT, PHOTO_GUIDANCE } from "@/lib/photo";
import { cn } from "@/lib/utils";
import type { EditPlantFormProps, PhotoIntent } from "./types";

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
  const nameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoIntent, setPhotoIntent] = useState<PhotoIntent>("keep");
  const photoUrlToShow = photoIntent === "remove" ? null : (photoPreview ?? photoUrl);
  const photoRemovable = photoUrl !== null || photoIntent === "replace";
  const initial = name.trim().charAt(0).toUpperCase() || "?";
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
      const formData = new FormData();

      formData.set("plantId", plantId);
      formData.set("name", value.name.trim());
      formData.set("growing_interval_days", String(value.growingIntervalDays));
      formData.set("dormancy_interval_days", String(value.dormancyIntervalDays));
      formData.set("removePhoto", String(photoIntent === "remove"));
      formData.set("updated_at", updatedAt);

      if (photoIntent === "replace" && photoFile) {
        formData.set("photo", photoFile);
      }

      try {
        const { error } = await actions.updatePlant(formData);

        if (error) {
          toast.error("We couldn't save these changes. Check your connection and try again.");

          return;
        }
      } catch {
        toast.error("We couldn't save these changes. Check your connection and try again.");

        return;
      }

      window.location.assign(`/plants/${plantId}`);
    },
  });

  function handlePhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
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

  function renderPhotoAction() {
    if (photoIntent === "remove") {
      return (
        <Button type="button" variant="ghost" size="sm" onPress={handleUndoPhotoRemoval} className="w-fit px-0">
          Undo photo removal
        </Button>
      );
    }

    if (!photoRemovable) {
      return null;
    }

    return (
      <Button type="button" variant="ghost" size="sm" onPress={handleRemovePhoto} className="w-fit px-0">
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

        <form.Subscribe
          selector={(state) => ({
            growingIntervalDays: state.values.growingIntervalDays,
            dormancyIntervalDays: state.values.dormancyIntervalDays,
          })}
        >
          {({ growingIntervalDays: currentGrowingIntervalDays, dormancyIntervalDays: currentDormancyIntervalDays }) => (
            <div className="border-border border-y py-4" aria-label="Schedule preview">
              <p className="mb-1 text-sm font-medium">Schedule preview</p>
              <p className="text-muted-foreground text-sm">
                {buildSchedulePreview({
                  today,
                  oldNextDue: nextDueOn,
                  oldGrowingIntervalDays: growingIntervalDays,
                  oldDormancyIntervalDays: dormancyIntervalDays,
                  newGrowingIntervalDays: currentGrowingIntervalDays,
                  newDormancyIntervalDays: currentDormancyIntervalDays,
                })}
              </p>
            </div>
          )}
        </form.Subscribe>

        <Field>
          <FieldLabel>Photo</FieldLabel>
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
                <Button type="button" variant="outline" size="sm" onPress={openPhotoPicker}>
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
            />
            <FieldDescription>{PHOTO_GUIDANCE}</FieldDescription>
            {photoError && <FieldError>{photoError}</FieldError>}
          </FieldContent>
        </Field>
      </FieldGroup>

      <form.Subscribe selector={(state) => ({ valid: state.isValid, submitting: state.isSubmitting })}>
        {({ valid, submitting }) => {
          const canSubmit = valid && !submitting && photoError === null;

          return (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" isDisabled={!canSubmit} className={cn("w-full sm:w-fit")}>
                {submitting ? "Saving changes…" : "Save changes"}
              </Button>
              <a href={`/plants/${plantId}`} className={cn(buttonVariants({ variant: "ghost" }))}>
                Cancel
              </a>
            </div>
          );
        }}
      </form.Subscribe>
    </form>
  );
}
