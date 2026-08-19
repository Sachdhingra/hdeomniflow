import { supabase } from "@/integrations/supabase/client";

/**
 * Private photo buckets. Legacy rows store full `/object/public/<bucket>/<path>`
 * URLs, so we translate those back into a storage path and mint a short-lived
 * signed URL at render time.
 */
export const PRIVATE_PHOTO_BUCKETS = ["job-photos", "field-agent-photos"] as const;

export type PrivatePhotoBucket = (typeof PRIVATE_PHOTO_BUCKETS)[number];

interface Parsed {
  bucket: PrivatePhotoBucket;
  path: string;
}

export function parsePrivatePhoto(
  value: string,
  fallbackBucket?: PrivatePhotoBucket,
): Parsed | null {
  if (!value) return null;

  for (const bucket of PRIVATE_PHOTO_BUCKETS) {
    const marker = `/storage/v1/object/public/${bucket}/`;
    const signedMarker = `/storage/v1/object/sign/${bucket}/`;
    const idx = value.indexOf(marker);
    if (idx >= 0) {
      return { bucket, path: decodeURIComponent(value.slice(idx + marker.length).split("?")[0]) };
    }
    const sIdx = value.indexOf(signedMarker);
    if (sIdx >= 0) {
      return { bucket, path: decodeURIComponent(value.slice(sIdx + signedMarker.length).split("?")[0]) };
    }
  }

  // Bare storage path
  if (!/^https?:\/\//.test(value) && fallbackBucket) {
    return { bucket: fallbackBucket, path: value };
  }
  return null;
}

const cache = new Map<string, { url: string; expires: number }>();

/** Resolve a stored photo value into a viewable URL (signed when private). */
export async function resolvePhotoUrl(
  value: string,
  fallbackBucket?: PrivatePhotoBucket,
  expiresIn = 3600,
): Promise<string> {
  const parsed = parsePrivatePhoto(value, fallbackBucket);
  if (!parsed) return value;

  const key = `${parsed.bucket}/${parsed.path}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.url;

  const { data, error } = await supabase.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.path, expiresIn);

  if (error || !data?.signedUrl) return value;
  cache.set(key, { url: data.signedUrl, expires: Date.now() + (expiresIn - 60) * 1000 });
  return data.signedUrl;
}
