import type { AstroCookies } from "astro";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/photo";
import { createClient } from "@/lib/supabase";
import type { PlantListItem } from "@/types";

export async function loadTodayPlants(
  requestHeaders: Headers,
  cookies: AstroCookies,
): Promise<{ plants: PlantListItem[] } | { plants: null }> {
  const supabase = createClient(requestHeaders, cookies);

  if (!supabase) {
    return { plants: null };
  }

  // PostgREST's `max_rows` silently truncates an unpaginated response, so this loader's
  // contract is deliberately unfiltered: it returns every row PostgREST provides to the island.
  const { data, error } = await supabase
    .from("plants")
    .select("id, name, growing_interval_days, dormancy_interval_days, next_due_on, photo_path")
    .order("next_due_on", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    return { plants: null };
  }

  const photoPaths = data.flatMap((plant) => (plant.photo_path ? [plant.photo_path] : []));
  const signedUrlByPath = new Map<string, string>();

  if (photoPaths.length > 0) {
    const { data: signedUrls } = await supabase.storage
      .from("plant-photos")
      .createSignedUrls(photoPaths, SIGNED_URL_TTL_SECONDS);

    for (const item of signedUrls ?? []) {
      if (item.path && item.signedUrl && !item.error) {
        signedUrlByPath.set(item.path, item.signedUrl);
      }
    }
  }

  const plants: PlantListItem[] = data.map((plant) => ({
    id: plant.id,
    name: plant.name,
    growing_interval_days: plant.growing_interval_days,
    dormancy_interval_days: plant.dormancy_interval_days,
    next_due_on: plant.next_due_on,
    photoUrl: plant.photo_path ? (signedUrlByPath.get(plant.photo_path) ?? null) : null,
  }));

  return { plants };
}
