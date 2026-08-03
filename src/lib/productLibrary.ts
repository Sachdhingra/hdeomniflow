import { supabase } from "@/integrations/supabase/client";

/** Supabase client without generated types for the new product library tables. */
export const plDb = supabase as any;

export const BUCKET_IMAGES = "product-images";
export const BUCKET_BROCHURES = "product-brochures";
export const BUCKET_VIDEOS = "product-videos";

export interface PLCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface PLCollection {
  id: string;
  category_id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface PLProduct {
  id: string;
  sku: string;
  category_id: string | null;
  collection_id: string | null;
  name: string;
  description: string | null;
  features: string[];
  dimensions: string | null;
  warranty: string | null;
  mrp: number;
  offer_price: number | null;
  gst_percent: number;
  exchange_eligible: boolean;
  elite_card_eligible: boolean;
  is_active: boolean;
  hero_image_url: string | null;
  thumbnail_url: string | null;
  sort_order: number;
}

export interface PLVariant {
  id: string;
  product_id: string;
  variant_sku: string | null;
  colour: string | null;
  colour_hex: string | null;
  size: string | null;
  finish: string | null;
  mrp: number | null;
  offer_price: number | null;
  image_url: string | null;
  in_stock: boolean;
  sort_order: number;
}

export interface PLImage {
  id: string;
  product_id: string;
  image_url: string;
  image_type: string; // hero | gallery | thumbnail
  alt_text: string | null;
  sort_order: number;
}

export interface PLBrochure {
  id: string;
  product_id: string;
  title: string;
  file_url: string;
  sort_order: number;
}

export interface PLVideo {
  id: string;
  product_id: string;
  title: string | null;
  video_url: string;
  thumbnail_url: string | null;
  sort_order: number;
}

export interface PLSpec {
  id: string;
  product_id: string;
  spec_group: string | null;
  label: string;
  value: string;
  sort_order: number;
}

/* ---------------- storage helpers (private buckets → signed URLs) --------------- */

const signedCache = new Map<string, { url: string; expires: number }>();

export function isExternalUrl(value?: string | null) {
  return !!value && /^(https?:)?\/\//i.test(value);
}

/** Resolve a stored value (either an external URL or a storage path) to a usable URL. */
export async function resolveUrl(bucket: string, value?: string | null): Promise<string | null> {
  if (!value) return null;
  if (isExternalUrl(value)) return value;
  const key = `${bucket}:${value}`;
  const hit = signedCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(value, 3600);
  if (error || !data?.signedUrl) return null;
  signedCache.set(key, { url: data.signedUrl, expires: Date.now() + 55 * 60 * 1000 });
  return data.signedUrl;
}

export async function uploadFile(bucket: string, file: File, folder: string): Promise<string> {
  const ext = file.name.split(".").pop() || "bin";
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

export async function removeFile(bucket: string, path?: string | null) {
  if (!path || isExternalUrl(path)) return;
  await supabase.storage.from(bucket).remove([path]);
}

/* ---------------- pricing helpers --------------- */

export const effectivePrice = (p: { mrp: number; offer_price: number | null }) =>
  p.offer_price && p.offer_price > 0 ? Number(p.offer_price) : Number(p.mrp || 0);

export const money = (n: number) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export const lineTotal = (qty: number, price: number, gst: number) =>
  Math.round(qty * price * (1 + (gst || 0) / 100) * 100) / 100;
