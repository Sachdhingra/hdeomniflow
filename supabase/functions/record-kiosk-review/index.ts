import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BodySchema = z.object({
  feedbackId: z.string().uuid(),
});

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "A valid feedback reference is required" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: feedback, error: lookupError } = await admin
    .from("customer_feedback")
    .select("id, created_at")
    .eq("id", parsed.data.feedbackId)
    .maybeSingle();

  if (lookupError) {
    console.error("[record-kiosk-review] lookup failed:", lookupError.message);
    return json({ error: "Could not verify this feedback" }, 500);
  }
  if (!feedback) return json({ error: "Feedback not found" }, 404);

  const ageMs = Date.now() - new Date(feedback.created_at).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 24 * 60 * 60 * 1000) {
    return json({ error: "This feedback is too old to confirm a review for" }, 400);
  }

  const { data, error } = await admin.rpc("record_google_review", {
    p_feedback_id: feedback.id,
    p_source: "kiosk",
  });

  if (error) {
    console.error("[record-kiosk-review] record failed:", error.message);
    return json({ error: "Could not record the review" }, 500);
  }

  return json({ success: true, draw: data });
});