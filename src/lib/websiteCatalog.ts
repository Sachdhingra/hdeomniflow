import { supabase } from "@/integrations/supabase/client";

/**
 * Product photos from the HDE website catalogue (hdefurniture.netlify.app),
 * read through the website-catalog edge function. Quote lines use these first;
 * products the website doesn't list keep a manually supplied photo.
 */
export interface WebsiteProduct {
  id: string;
  sku: string;
  name: string;
  image: string | null;
  remoteImage: string | null;
}

export interface WebsiteCatalogIndex {
  byCode: Map<string, WebsiteProduct>;
  byName: Map<string, WebsiteProduct>;
}

const WEBSITE_IMAGE_HOSTS = new Set(["hdefurniture.netlify.app", "interio.com", "www.interio.com"]);

/** Codes compare case-insensitively ("56101508SD08429" vs "56101508sd08429"). */
export const normalizeCode = (v?: string | null) => (v || "").trim().toLowerCase();
/** Names compare on letters and digits only. */
export const normalizeName = (v?: string | null) => (v || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export function buildCatalogIndex(products: WebsiteProduct[]): WebsiteCatalogIndex {
  const byCode = new Map<string, WebsiteProduct>();
  const byName = new Map<string, WebsiteProduct>();
  for (const p of products) {
    for (const code of [p.sku, p.id]) {
      const key = normalizeCode(code);
      if (key && !byCode.has(key)) byCode.set(key, p);
    }
    const name = normalizeName(p.name);
    if (name && !byName.has(name)) byName.set(name, p);
  }
  return { byCode, byName };
}

/** Match by any of the item codes (SKU, Interio line code), then by exact product name. */
export function findWebsiteProduct(
  index: WebsiteCatalogIndex,
  lookup: { codes: (string | null | undefined)[]; name?: string | null },
): WebsiteProduct | null {
  for (const code of lookup.codes) {
    const hit = index.byCode.get(normalizeCode(code));
    if (hit) return hit;
  }
  const name = normalizeName(lookup.name);
  return (name && index.byName.get(name)) || null;
}

export const websiteImageOf = (p: WebsiteProduct | null) => p?.image || p?.remoteImage || null;

export function isWebsiteImageUrl(url?: string | null) {
  if (!url) return false;
  try {
    return WEBSITE_IMAGE_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

let indexPromise: Promise<WebsiteCatalogIndex> | null = null;

/** Loaded once per session; a failed load is retried on the next call. */
export function loadWebsiteCatalog(): Promise<WebsiteCatalogIndex> {
  if (!indexPromise) {
    indexPromise = supabase.functions
      .invoke("website-catalog", { body: { action: "catalog" } })
      .then(({ data, error }) => {
        if (error) throw error;
        return buildCatalogIndex((data?.products || []) as WebsiteProduct[]);
      })
      .catch((e) => {
        indexPromise = null;
        throw e;
      });
  }
  return indexPromise;
}

/** Website photo URL for a product, or null when the website doesn't list it (or is unreachable). */
export async function lookupWebsiteImage(lookup: {
  codes: (string | null | undefined)[];
  name?: string | null;
}): Promise<string | null> {
  try {
    return websiteImageOf(findWebsiteProduct(await loadWebsiteCatalog(), lookup));
  } catch (e) {
    console.warn("[websiteCatalog] lookup failed", e);
    return null;
  }
}

/** Image bytes for the Excel export (website hosts don't send CORS headers). */
export async function fetchWebsiteImage(url: string): Promise<{ base64: string; type: string } | null> {
  const { data, error } = await supabase.functions.invoke("website-catalog", {
    body: { action: "image", url },
  });
  if (error || !data?.data) return null;
  return { base64: data.data, type: data.type || "image/jpeg" };
}
