import { useCallback, useState } from "react";
import { actions } from "astro:actions";
import { Button } from "@/components/ui/button";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { useHydrated } from "@/components/hooks/use-hydrated";
import { setDeletedPlantNotice } from "@/lib/deleted-plant-notice";

type DeletePlantDialogProps = {
  plantId: string;
  plantName: string;
};

export default function DeletePlantDialog({ plantId, plantName }: DeletePlantDialogProps) {
  const hydrated = useHydrated();
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        setIsOpen(true);
        setError(null);
      } else if (!isPending) {
        setIsOpen(false);
      }
    },
    [isPending],
  );

  const handleConfirm = useCallback(async () => {
    setIsPending(true);
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
      setIsPending(false);
    }
  }, [plantId, plantName]);

  if (!hydrated) {
    return (
      <Button variant="destructive" isDisabled>
        Delete plant
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="destructive"
        onClick={() => {
          setIsOpen(true);
        }}
      >
        Delete plant
      </Button>

      <AlertDialog
        isOpen={isOpen}
        onOpenChange={handleOpenChange}
        isDismissDisabled={isPending}
        title={`Delete ${plantName}?`}
        description={
          <div className="space-y-4">
            <p>This plant and its entire watering history will be removed permanently. This action cannot be undone.</p>
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
            onPress={() => {
              setIsOpen(false);
            }}
            isDisabled={isPending}
            slot="close"
          >
            Cancel
          </Button>
          <Button variant="destructive" onPress={handleConfirm} isDisabled={isPending}>
            {isPending ? "Deleting..." : "Delete plant"}
          </Button>
        </div>
      </AlertDialog>
    </>
  );
}
