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

  // PostgREST caps an unpaginated response at `max_rows = 1000` (`supabase/config.toml:18`) and
  // truncates *silently* — the cut-off arrives with `error === null`, so neither this loader nor
  // its caller can tell a truncated page from a complete one. This loader's contract is therefore
  // deliberately unfiltered: it returns every row PostgREST provides, and the island filters.
  const { data, error } = await supabase
    .from("plants")
    .select("id, name, growing_interval_days, dormancy_interval_days, next_due_on, photo_path")
    .order("next_due_on", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    // eslint-disable-next-line no-console -- the caller only sees `plants: null`, so the cause is otherwise unrecoverable
    console.error("Failed to load plants for the today view:", error);

    return { plants: null };
  }

  const photoPaths = data.flatMap((plant) => (plant.photo_path ? [plant.photo_path] : []));
  const signedUrlByPath = new Map<string, string>();

  if (photoPaths.length > 0) {
    const { data: signedUrls, error: signedUrlsError } = await supabase.storage
      .from("plant-photos")
      .createSignedUrls(photoPaths, SIGNED_URL_TTL_SECONDS);

    if (signedUrlsError) {
      // eslint-disable-next-line no-console -- best-effort photo signing must not fail the view, but a total Storage outage still needs a signal
      console.error("Failed to sign plant photo URLs; falling back to initial-letter placeholders:", signedUrlsError);
    }

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
