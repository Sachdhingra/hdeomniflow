// Verifies a 6-digit SMS OTP for the Insider PWA and returns a hashed magic-link
// token the client can pass to supabase.auth.verifyOtp({ token_hash, type: "email" })
// to sign in. Ensures a Supabase auth user exists for the phone (phone@insider.local).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_ATTEMPTS = 5;

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

  let phoneRaw = "", code = "";
  try { ({ phone: phoneRaw, code } = await req.json()); } catch { return j({ error: "invalid_json" }, 400); }

  const phone = canonicalize(phoneRaw);
  if (!phone) return j({ error: "invalid_phone" }, 400);
  if (!/^\d{6}$/.test(code || "")) return j({ error: "invalid_code" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Latest unconsumed, unexpired code for this phone
  const { data: row, error: rowErr } = await admin
    .from("insider_otp_codes")
    .select("id, code_hash, expires_at, attempts, consumed_at")
    .eq("phone", phone)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (rowErr) {
    console.error("[insider-verify-otp] lookup failed:", rowErr.message);
    return j({ error: "lookup_failed" }, 500);
  }
  if (!row) return j({ error: "no_pending_code" }, 400);
  if (new Date(row.expires_at).getTime() < Date.now()) return j({ error: "expired" }, 400);
  if (row.attempts >= MAX_ATTEMPTS) return j({ error: "too_many_attempts" }, 429);

  const expected = await sha256(`${phone}:${code}`);
  if (expected !== row.code_hash) {
    await admin.from("insider_otp_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
    return j({ error: "wrong_code", attempts_left: MAX_ATTEMPTS - (row.attempts + 1) }, 400);
  }

  // Mark consumed
  await admin.from("insider_otp_codes").update({ consumed_at: new Date().toISOString() }).eq("id", row.id);

  // Ensure Supabase auth user exists for this phone
  const email = `${phone.replace("+", "")}@insider.local`;

  // Look up existing user by email (admin listUsers is paginated; use filter)
  const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  let userId = existing?.users?.find(u => u.email?.toLowerCase() === email)?.id ?? null;

  if (!userId) {
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      phone,
      user_metadata: { insider: true, phone },
    });
    if (cErr || !created?.user) {
      console.error("[insider-verify-otp] createUser failed:", cErr?.message);
      return j({ error: "user_create_failed" }, 500);
    }
    userId = created.user.id;
  }

  // Generate a magic link and return the hashed token for the client to verify.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !link?.properties?.hashed_token) {
    console.error("[insider-verify-otp] generateLink failed:", linkErr?.message);
    return j({ error: "link_failed" }, 500);
  }

  return j({ ok: true, hashed_token: link.properties.hashed_token, user_id: userId });
});
