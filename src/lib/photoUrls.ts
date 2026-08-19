import { supabase } from "@/integrations/supabase/client";

/**
 * Photo storage helpers.
 *
 * All job / site-visit / product photos live in private Supabase buckets, but
 * historic rows store whatever URL the uploader had at the time — usually a
 * `/object/public/<bucket>/<path>` URL minted while the bucket was still
 * public, sometimes an already-signed URL, sometimes a bare storage path.
 * None of those render once the bucket is private, so every value has to be
 * translated back into `{ bucket, path }` and re-signed at render time.
 */
export const PHOTO_BUCKETS = ["field-agent-photos", "job-photos"] as const;

export type PhotoBucket = (typeof PHOTO_BUCKETS)[number];

/** @deprecated use {@link PHOTO_BUCKETS} */
export const PRIVATE_PHOTO_BUCKETS = PHOTO_BUCKETS;
/** @deprecated use {@link PhotoBucket} */
export type PrivatePhotoBucket = PhotoBucket;

export interface ParsedPhoto {
  bucket: string;
  path: string;
}

/** `/storage/v1/object/{public|sign|authenticated}/<bucket>/<path>[?query]` */
const STORAGE_URL_RE = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?#]+)\/([^?#]+)/;

const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const isAbsoluteUrl = (value: string) => /^(https?:|data:|blob:)/i.test(value);

/** Split a Supabase storage URL (public, signed or authenticated) into bucket + path. */
export function parseStorageUrl(value: string): ParsedPhoto | null {
  const match = STORAGE_URL_RE.exec(value);
  if (!match) return null;
  const path = decode(match[2]).replace(/^\/+/, "");
  if (!path) return null;
  return { bucket: decode(match[1]), path };
}

/**
 * Every `{ bucket, path }` worth trying for a stored value, best guess first.
 *
 * A URL names its bucket, but photos have moved between `job-photos` and
 * `field-agent-photos` over time, so the other photo buckets are kept as
 * fallbacks — the object may no longer live where the stored URL says it does.
 * Returns `[]` for values that are not Supabase storage references (external
 * URLs, data/blob URLs); those are rendered verbatim.
 */
export function photoCandidates(value: string, hint?: string): ParsedPhoto[] {
  const trimmed = (value || "").trim();
  if (!trimmed) return [];

  const parsed = parseStorageUrl(trimmed);
  if (parsed) {
    const others = PHOTO_BUCKETS.filter((b) => b !== parsed.bucket).map((bucket) => ({
      bucket,
      path: parsed.path,
    }));
    return [parsed, ...others];
  }

  if (isAbsoluteUrl(trimmed)) return [];

  // Bare storage path — we only know which bucket from the caller's hint.
  const path = trimmed.replace(/^\/+/, "");
  const buckets: string[] = hint
    ? [hint, ...PHOTO_BUCKETS.filter((b) => b !== hint)]
    : [...PHOTO_BUCKETS];
  return buckets.map((bucket) => ({ bucket, path }));
}

/** @deprecated use {@link photoCandidates} — kept for callers that want one guess. */
export function parsePrivatePhoto(value: string, fallbackBucket?: string): ParsedPhoto | null {
  return photoCandidates(value, fallbackBucket)[0] ?? null;
}

/** A value we can hand straight to an `<img>` without signing it first. */
export function isDirectlyRenderable(value: string): boolean {
  const trimmed = (value || "").trim();
  return !!trimmed && isAbsoluteUrl(trimmed) && !parseStorageUrl(trimmed);
}

interface CacheEntry {
  url: string;
  expires: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string | null>>();
/** Values that failed to resolve, so a broken row does not re-sign on every render. */
const failures = new Map<string, number>();
const FAILURE_TTL_MS = 60_000;

const cacheKey = (c: ParsedPhoto) => `${c.bucket}/${c.path}`;

function signCandidate(candidate: ParsedPhoto, expiresIn: number): Promise<string | null> {
  const key = cacheKey(candidate);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = supabase.storage
    .from(candidate.bucket)
    .createSignedUrl(candidate.path, expiresIn)
    .then(({ data, error }) => {
      if (error || !data?.signedUrl) return null;
      cache.set(key, { url: data.signedUrl, expires: Date.now() + (expiresIn - 60) * 1000 });
      return data.signedUrl;
    })
    .catch(() => null)
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}

export interface ResolvePhotoOptions {
  /** Signed-URL lifetime in seconds. */
  expiresIn?: number;
  /** Ignore any cached signed URL — used when a cached URL failed to load. */
  force?: boolean;
}

/**
 * Resolve a stored photo value into a URL an `<img>` can actually load.
 *
 * Returns `null` when nothing works, so the UI can show a placeholder instead
 * of a broken-image icon (the old behaviour of returning the unusable public
 * URL just moved the failure into the browser, where it was invisible to us).
 */
export async function resolvePhotoUrl(
  value: string,
  hint?: string,
  options: ResolvePhotoOptions | number = {},
): Promise<string | null> {
  const { expiresIn = 3600, force = false } =
    typeof options === "number" ? { expiresIn: options, force: false } : options;

  const trimmed = (value || "").trim();
  if (!trimmed) return null;
  if (isDirectlyRenderable(trimmed)) return trimmed;

  const candidates = photoCandidates(trimmed, hint);
  if (candidates.length === 0) return null;

  const failedAt = failures.get(trimmed);
  if (!force && failedAt && Date.now() - failedAt < FAILURE_TTL_MS) return null;

  if (force) {
    for (const candidate of candidates) cache.delete(cacheKey(candidate));
    failures.delete(trimmed);
  } else {
    for (const candidate of candidates) {
      const hit = cache.get(cacheKey(candidate));
      if (hit && hit.expires > Date.now()) return hit.url;
    }
  }

  for (const candidate of candidates) {
    const signed = await signCandidate(candidate, expiresIn);
    if (signed) {
      failures.delete(trimmed);
      return signed;
    }
  }

  failures.set(trimmed, Date.now());
  console.warn(
    `[photo] could not sign "${trimmed}" — tried ${candidates
      .map(cacheKey)
      .join(", ")}. Check the bucket exists and that a storage SELECT policy covers this user.`,
  );
  return null;
}

/** Test seam — drops every cached signed URL and failure marker. */
export function __resetPhotoUrlCache() {
  cache.clear();
  inFlight.clear();
  failures.clear();
}
