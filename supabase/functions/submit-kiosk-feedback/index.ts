import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";
import { indianPhoneLastTen } from "../_shared/indian-phone.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BodySchema = z.object({
  customerName: z.string().trim().min(1).max(100),
  customerPhone: z.string().trim().min(10).max(20),
  overallRating: z.number().int().min(1).max(5),
  staffRating: z.number().int().min(1).max(5),
  salespersonName: z.string().trim().min(1).max(100),
  comments: z.string().trim().max(500).nullish(),
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
  if (!parsed.success) {
    return json({ error: "Please check the details and try again" }, 400);
  }

  const phone = indianPhoneLastTen(parsed.data.customerPhone);
  if (!phone) {
    return json({ error: "Please enter a valid 10-digit Indian mobile number" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data, error } = await admin.rpc("submit_kiosk_feedback", {
    p_customer_name: parsed.data.customerName,
    p_customer_phone: phone,
    p_overall_rating: parsed.data.overallRating,
    p_staff_rating: parsed.data.staffRating,
    p_salesperson_name: parsed.data.salespersonName,
    p_comments: parsed.data.comments || null,
  });

  if (error) {
    console.error("[submit-kiosk-feedback] submit failed:", error.message);
    // The function raises its own validation messages (P0001); anything else
    // is a fault the customer can do nothing about.
    return error.code === "P0001"
      ? json({ error: error.message }, 400)
      : json({ error: "Could not save your feedback" }, 500);
  }

  return json({ success: true, feedbackId: data });
});
