// Public feed for the website's "Recently delivered in Dehradun" gallery
// (hdefurniture.netlify.app). Returns only photos an admin published from
// Omniflow > Website Gallery, with caption and category: no customer details.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_ITEMS = 24;
const BUCKET = "website-gallery";
const SIGNED_URL_SECONDS = 3600;
// Short, so a newly published photo shows within a minute; well inside the signed URLs' life.
const CACHE = "public, max-age=60";

/** A bare object path from a stored path or any Supabase storage URL for this bucket. */
function objectPath(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  const m = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?#]+)\/([^?#]+)/.exec(v);
  if (m) return m[1] === BUCKET ? decodeURIComponent(m[2]) : "";
  return /^https?:/i.test(v) ? "" : v.replace(/^\/+/, "");
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": cache },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await admin
      .from("website_gallery")
      .select("id, image_url, storage_path, caption, category, delivered_on, created_at")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(MAX_ITEMS);
    if (error) throw error;

    // Sign the object path. storage_path always holds it; image_url holds a bare
    // path only for photos published after the bucket went private; earlier ones
    // hold the old /object/public/ URL, which can't be signed and dropped them.
    const rows = (data ?? [])
      .map((p) => ({ ...p, path: objectPath(p.storage_path) || objectPath(p.image_url) }))
      .filter((p) => p.path);
    if (rows.length === 0) return json({ photos: [] }, 200, CACHE);
    const { data: signed, error: signedError } = await admin.storage
      .from(BUCKET)
      .createSignedUrls(rows.map((p) => p.path), SIGNED_URL_SECONDS);
    if (signedError) throw signedError;
    const urlByPath = new Map((signed ?? []).filter((s) => s.signedUrl && !s.error).map((s) => [s.path, s.signedUrl]));
    const missing = rows.filter((p) => !urlByPath.has(p.path));
    if (missing.length) console.warn("[website-gallery] could not sign:", missing.map((p) => p.path).join(", "));

    const photos = rows.map((p) => ({
      id: p.id,
      image: urlByPath.get(p.path) ?? "",
      caption: p.caption,
      category: p.category,
      date: p.delivered_on || String(p.created_at).slice(0, 10),
    })).filter((p) => p.image);
    return json({ photos }, 200, CACHE);
  } catch (e) {
    console.error("[website-gallery]", e instanceof Error ? e.message : e);
    return json({ error: "Could not load the gallery" }, 500);
  }
});
