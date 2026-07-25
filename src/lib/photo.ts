// Keep this module isomorphic: client islands import its constants and validation, so do not
// import the server-only Supabase client factory here. The resolver accepts an existing client.
import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

export const PHOTO_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const PHOTO_GUIDANCE = "Choose a JPEG, PNG, or WebP image up to 4 MB.";
export const PHOTO_ACCEPT = Object.keys(PHOTO_MIME_EXTENSIONS).join(",");
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

export function isValidPhoto(file: File): boolean {
  return file.size <= MAX_PHOTO_BYTES && file.type in PHOTO_MIME_EXTENSIONS;
}

export function buildPhotoPath(userId: string, mimeType: string): string {
  const extension = PHOTO_MIME_EXTENSIONS[mimeType];

  if (!extension) {
    throw new RangeError("Unsupported photo type");
  }

  return `${userId}/${crypto.randomUUID()}.${extension}`;
}

export async function resolvePhotoUrl(supabase: SupabaseClient, photoPath: string): Promise<string | null> {
  const { data: signedUrls } = await supabase.storage
    .from("plant-photos")
    .createSignedUrls([photoPath], SIGNED_URL_TTL_SECONDS);
  const signedUrl = signedUrls?.[0];

  return signedUrl && !signedUrl.error ? signedUrl.signedUrl : null;
}
