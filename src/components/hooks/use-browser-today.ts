import { useEffect, useState } from "react";
import { subscribeToBrowserToday } from "@/lib/timezone";

export function useBrowserToday(initialToday: string | null): string | null {
  const [today, setToday] = useState(initialToday);

  useEffect(() => {
    return subscribeToBrowserToday(setToday, initialToday);
  }, [initialToday]);

  return today;
}
