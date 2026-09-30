// Receives enquiries from the public website (hdefurniture.netlify.app).
// If the visitor came through a salesperson's personal link (?ref=<code>), the lead
// is assigned to that salesperson and they get the usual "New Lead Assigned" alert.
// A repeat enquiry from a phone number that already has a lead is added to that
// lead's notes and stays with its current owner.
import { createClient } from "npm:@supabase/supabase-js@2";
import { normalizeIndianPhone } from "../_shared/indian-phone.ts";
import { categoryFromEnquiry, cleanRefCode } from "./helpers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object") throw new Error("not an object");
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // Honeypot field the website hides from people
  if (text(body.website, 200)) return json({ success: true });

  const name = text(body.name, 80);
  const phone = normalizeIndianPhone(String(body.phone ?? ""));
  if (name.length < 2 || !phone) {
    return json({ error: "Name and a valid Indian mobile number are required" }, 400);
  }
  const email = text(body.email, 120) || null;
  const interest = text(body.interest, 80);
  const product = text(body.product, 160);
  const area = text(body.area, 80);
  const store = text(body.store, 80);
  const message = text(body.message, 1000);
  const page = text(body.page, 80);
  const ref = cleanRefCode(body.ref);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Whose link was it?
    let salesperson: { id: string; name: string } | null = null;
    if (ref) {
      const { data } = await admin
        .from("profiles")
        .select("id, name")
        .eq("website_ref_code", ref)
        .eq("active", true)
        .maybeSingle();
      salesperson = data;
    }

    const today = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
    const details = [
      interest && `Looking for: ${interest}`,
      product && `Product: ${product}`,
      area && `Area: ${area}`,
      store && `Showroom: ${store}`,
      message && `Message: ${message}`,
      page && `Page: ${page}`,
      salesperson ? `Came through ${salesperson.name}'s website link` : ref && `Website link code: ${ref} (no matching salesperson)`,
    ].filter(Boolean).join("\n");

    // Existing customer? Keep the lead with its current owner and add the enquiry to it.
    const { data: existing } = await admin
      .from("leads")
      .select("id, notes, assigned_to, customer_name")
      .eq("customer_phone", phone)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      const owner = existing.assigned_to || salesperson?.id || null;
      const update: Record<string, unknown> = {
        notes: `${existing.notes || ""}\n[Website enquiry ${today}]\n${details}`.trim(),
        last_activity_date: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (!existing.assigned_to && salesperson) {
        update.assigned_to = salesperson.id;
        update.assigned_at = new Date().toISOString();
      }
      const { error } = await admin.from("leads").update(update).eq("id", existing.id);
      if (error) throw error;
      if (owner) {
        await admin.from("notifications").insert({
          user_id: owner,
          type: "lead_assigned",
          message: `Website enquiry again from ${existing.customer_name} · ${phone}${interest ? ` · ${interest}` : ""}`,
        });
      }
      return json({ success: true, leadId: existing.id, repeat: true });
    }

    // New lead. created_by must be a real user: the salesperson, else the first admin.
    let creator = salesperson?.id || null;
    if (!creator) {
      const { data: adminRole } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin")
        .limit(1)
        .maybeSingle();
      creator = adminRole?.user_id || null;
    }
    if (!creator) throw new Error("No admin user to own website leads");

    const { data: lead, error } = await admin
      .from("leads")
      .insert({
        customer_name: name,
        customer_phone: phone,
        customer_email: email,
        category: categoryFromEnquiry(interest, product),
        value_in_rupees: 0,
        status: "new",
        source: "website",
        source_type: "website",
        notes: `[Website enquiry ${today}]\n${details}`,
        liked_product: product || null,
        neighborhood: area || null,
        assigned_to: salesperson?.id || null,
        assigned_at: salesperson ? new Date().toISOString() : null,
        created_by: creator,
        updated_by: creator,
        last_activity_date: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;

    if (salesperson) {
      await admin.from("notifications").insert({
        user_id: salesperson.id,
        type: "lead_assigned",
        message: `New website lead from your link: ${name} · ${phone}${interest ? ` · ${interest}` : ""}`,
      });
    }

    return json({ success: true, leadId: lead.id });
  } catch (e) {
    console.error("[website-lead]", e instanceof Error ? e.message : e);
    return json({ error: "Could not save the enquiry" }, 500);
  }
});
