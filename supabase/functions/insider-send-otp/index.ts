// Sends a 6-digit SMS OTP to an Insider (Elite customer) via Twilio.
// Only phones that exist in public.elite_customers are allowed.
// Rate limit: 3 requests / hour and 10 / day per phone.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_AUTH = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_FROM = Deno.env.get("TWILIO_PHONE_FROM") ?? ""; // SMS-capable Twilio number in E.164

function canonicalize(raw: string): string {
  const d = (raw || "").replace(/\D/g, "");
  const ten = d.length > 10 ? d.slice(-10) : d;
  return /^\d{10}$/.test(ten) ? `+91${ten}` : "";
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  const j = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (!TWILIO_SID || !TWILIO_AUTH || !TWILIO_FROM) {
    console.error("[insider-send-otp] Twilio not configured");
    return j({ error: "sms_not_configured" }, 500);
  }

  let phoneRaw = "";
  try { ({ phone: phoneRaw } = await req.json()); } catch { return j({ error: "invalid_json" }, 400); }

  const phone = canonicalize(phoneRaw);
  if (!phone) return j({ error: "invalid_phone" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Restrict to registered Elite customers.
  const { data: cust, error: custErr } = await admin
    .from("elite_customers")
    .select("id")
    .eq("phone_1", phone)
    .maybeSingle();
  if (custErr) {
    console.error("[insider-send-otp] customer lookup failed:", custErr.message);
    return j({ error: "lookup_failed" }, 500);
  }
  if (!cust) return j({ error: "not_registered" }, 404);

  // Rate limit
  const nowIso = new Date().toISOString();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await admin
    .from("insider_otp_codes")
    .select("created_at")
    .eq("phone", phone)
    .gte("created_at", dayAgo);
  const dayCount = recent?.length ?? 0;
  const hourCount = (recent ?? []).filter(r => r.created_at >= hourAgo).length;
  if (hourCount >= 3 || dayCount >= 10) {
    return j({ error: "rate_limited", retry_after_minutes: 60 }, 429);
  }

  // Generate + store hash
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const code_hash = await sha256(`${phone}:${code}`);
  const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const { error: insErr } = await admin.from("insider_otp_codes").insert({
    phone, code_hash, expires_at, ip, created_at: nowIso,
  });
  if (insErr) {
    console.error("[insider-send-otp] insert failed:", insErr.message);
    return j({ error: "store_failed" }, 500);
  }

  // Send SMS via Twilio
  const body = `Your Home Decor Insider code: ${code}\nValid for 10 minutes. Do not share.`;
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${TWILIO_SID}:${TWILIO_AUTH}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ From: TWILIO_FROM, To: phone, Body: body }).toString(),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    console.error(`[insider-send-otp] Twilio ${res.status}: ${err}`);
    return j({ error: "sms_send_failed", status: res.status, details: err }, 502);
  }

  return j({ ok: true, expires_in_seconds: 600 });
});
