import { useCallback, useState } from "react";
import { actions } from "astro:actions";
import { Button } from "@/components/ui/button";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { useHydrated } from "@/components/hooks/use-hydrated";
import { setDeletedPlantNotice } from "@/lib/deleted-plant-notice";
import type { DeletePlantDialogProps } from "./types";

export default function DeletePlantDialog({ plantId, plantName }: DeletePlantDialogProps) {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        setOpen(true);
        setError(null);
      } else if (!pending) {
        setOpen(false);
      }
    },
    [pending],
  );

  const handleConfirm = useCallback(async () => {
    setPending(true);
    setError(null);

    const formData = new FormData();

    formData.set("plantId", plantId);

    try {
      const { error: actionError } = await actions.deletePlant(formData);

      if (actionError) {
        if (actionError.code === "UNAUTHORIZED") {
          window.location.assign(
            `/auth/signin?error=${encodeURIComponent("Your session expired. Sign in again to continue.")}`,
          );

          return;
        }

        if (actionError.code === "NOT_FOUND") {
          setDeletedPlantNotice(plantName);
          window.location.assign("/plants");

          return;
        }

        setError(`Couldn't delete ${plantName}. Try again.`);

        return;
      }

      setDeletedPlantNotice(plantName);
      window.location.assign("/plants");
    } catch {
      setError(`Couldn't delete ${plantName}. Try again.`);
    } finally {
      setPending(false);
    }
  }, [plantId, plantName]);

  if (!hydrated) {
    return (
      <Button variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" isDisabled>
        Delete plant
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="ghost"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => {
          setOpen(true);
        }}
      >
        Delete plant
      </Button>

      <AlertDialog
        open={open}
        onOpenChange={handleOpenChange}
        dismissDisabled={pending}
        title={`Delete ${plantName}?`}
        description={
          <div className="space-y-4">
            <p>
              This plant, its photo, and its entire watering history will be removed permanently. This action cannot be
              undone.
            </p>
            {error && (
              <div className="text-destructive text-sm" role="alert">
                {error}
              </div>
            )}
          </div>
        }
      >
        <div className="flex justify-end gap-2 pt-4">
          <Button
            variant="outline"
            className="min-h-11"
            autoFocus
            onPress={() => {
              setOpen(false);
            }}
            isDisabled={pending}
            slot="close"
          >
            Cancel
          </Button>
          <Button
            variant="default"
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 min-h-11"
            onPress={handleConfirm}
            isDisabled={pending}
          >
            {pending ? "Deleting..." : "Delete plant"}
          </Button>
        </div>
      </AlertDialog>
    </>
  );
}
