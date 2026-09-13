import { useEffect } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { takeDeletedPlantNotice } from "@/lib/deleted-plant-notice";

export function ToastHost() {
  useEffect(() => {
    const name = takeDeletedPlantNotice();

    if (name) {
      toast.success(`${name} deleted`);
    }
  }, []);

  return <Toaster />;
}
