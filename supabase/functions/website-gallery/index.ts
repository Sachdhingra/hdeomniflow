// Public feed for the website's "Recently delivered in Dehradun" gallery
// (hdefurniture.netlify.app). Returns only photos an admin published from
// Omniflow > Website Gallery, with caption and category: no customer details.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_ITEMS = 24;

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
      .select("id, image_url, caption, category, delivered_on, created_at")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(MAX_ITEMS);
    if (error) throw error;

    const paths = (data ?? []).map((p) => p.image_url).filter(Boolean);
    const { data: signed, error: signedError } = await admin.storage
      .from("website-gallery")
      .createSignedUrls(paths, 600);
    if (signedError) throw signedError;

    const photos = (data ?? []).map((p, index) => ({
      id: p.id,
      image: signed?.[index]?.signedUrl ?? "",
      caption: p.caption,
      category: p.category,
      date: p.delivered_on || String(p.created_at).slice(0, 10),
    })).filter((p) => p.image);
    // A few minutes of browser/CDN caching is plenty: photos change a few times a week.
    return json({ photos }, 200, "public, max-age=240");
  } catch (e) {
    console.error("[website-gallery]", e instanceof Error ? e.message : e);
    return json({ error: "Could not load the gallery" }, 500);
  }
});
