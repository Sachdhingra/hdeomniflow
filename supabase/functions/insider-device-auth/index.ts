// Insider PWA device + PIN authentication. Three actions:
//   setup:   exchange a one-time setup token (QR code / link) for a
//            long-lived device credential; returns customer name for the
//            PIN-creation screen.
//   set-pin: attach a 4-digit PIN to the device credential and sign the
//            customer in.
//   login:   verify device token + PIN and sign the customer in.
// Sign-in returns a magic-link hashed_token the client passes to
// supabase.auth.verifyOtp({ token_hash, type: "email" }) — same pattern as
// redeem-invite / insider-verify-otp. No OTP is ever sent to the customer.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_PIN_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function normalizePhone(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return ten.length === 10 ? `+91${ten}` : (raw || "").trim();
}

/** Stable virtual email derived from the phone, never delivered to a real inbox */
function virtualEmail(phone: string): string {
  return `${normalizePhone(phone).replace(/\D/g, "")}@invite.hdi.local`;
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(prefix: string): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function referralCode(phone: string): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const last4 = normalizePhone(phone).replace(/\D/g, "").slice(-4);
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `EC${last4}${suffix}`;
}

/** Find or create the auth user for a customer and ensure the app_users link. */
async function ensureAuthUser(
  admin: SupabaseClient,
  customerId: string,
  phone: string,
): Promise<string | null> {
  const email = virtualEmail(phone);

  const { data: appUser } = await admin
    .from("app_users")
    .select("user_id")
    .eq("customer_id", customerId)
    .maybeSingle();

  if (appUser?.user_id) {
    // Refresh the virtual email so magic-link generation always works
    await admin.auth.admin.updateUserById(appUser.user_id, { email, email_confirm: true });
    return appUser.user_id;
  }

  let userId: string;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { customer_id: customerId, phone: normalizePhone(phone) },
  });

  if (createErr) {
    // Auth user with this email exists but no app_users row yet
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existing = list?.users.find((u) => u.email === email);
    if (!existing) {
      console.error("[insider-device-auth] createUser failed:", createErr.message);
      return null;
    }
    userId = existing.id;
  } else {
    userId = created!.user!.id;
  }

  const { error: linkErr } = await admin
    .from("app_users")
    .upsert(
      { user_id: userId, customer_id: customerId, phone: normalizePhone(phone), push_enabled: true },
      { onConflict: "customer_id" },
    );

  if (linkErr) {
    console.error("[insider-device-auth] app_users link failed:", linkErr.message);
    return null;
  }

  return userId;
}

/** First activation: flag the customer and assign a referral code if missing. */
async function activateCustomer(admin: SupabaseClient, customerId: string, phone: string) {
  const { data: cust } = await admin
    .from("elite_customers")
    .select("app_activated, referral_code")
    .eq("id", customerId)
    .maybeSingle();

  const updates: Record<string, unknown> = {};
  if (!cust?.app_activated) updates.app_activated = true;
  if (!cust?.referral_code) updates.referral_code = referralCode(phone);
  if (Object.keys(updates).length > 0) {
    await admin.from("elite_customers").update(updates).eq("id", customerId);
  }
}

/** Issue a session: returns the magic-link hashed_token for verifyOtp. */
async function issueSession(
  admin: SupabaseClient,
  customerId: string,
  phone: string,
): Promise<string | null> {
  const userId = await ensureAuthUser(admin, customerId, phone);
  if (!userId) return null;

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: virtualEmail(phone),
  });
  if (linkErr || !link?.properties?.hashed_token) {
    console.error("[insider-device-auth] generateLink failed:", linkErr?.message);
    return null;
  }
  return link.properties.hashed_token;
}

type Credential = {
  id: string;
  customer_id: string;
  pin_hash: string | null;
  pin_attempts: number;
  pin_locked_until: string | null;
};

async function findCredential(
  admin: SupabaseClient,
  deviceToken: string,
): Promise<Credential | null> {
  const { data } = await admin
    .from("device_credentials")
    .select("id, customer_id, pin_hash, pin_attempts, pin_locked_until, revoked_at, expires_at")
    .eq("device_token", deviceToken)
    .maybeSingle();

  if (!data || data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  return data as Credential;
}

async function getCustomer(admin: SupabaseClient, customerId: string) {
  const { data } = await admin
    .from("elite_customers")
    .select("id, customer_name, phone_1, status")
    .eq("id", customerId)
    .maybeSingle();
  return data && data.status === "active" ? data : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const action = String(body.action || "");

  // ----------------------------------------------------------
  // setup: one-time token -> device credential
  // ----------------------------------------------------------
  if (action === "setup") {
    const setupToken = String(body.setup_token || "").trim();
    if (!setupToken) return json({ error: "missing_token" }, 400);

    const { data: tok, error: tokErr } = await admin
      .from("setup_tokens")
      .select("id, customer_id, used_at, expires_at")
      .eq("token", setupToken)
      .maybeSingle();

    if (tokErr) {
      console.error("[insider-device-auth] setup token lookup failed:", tokErr.message);
      return json({ error: "lookup_failed" }, 500);
    }
    if (!tok) return json({ error: "invalid_token" }, 404);
    if (tok.used_at) return json({ error: "already_used" }, 409);
    if (new Date(tok.expires_at) < new Date()) return json({ error: "expired" }, 410);

    const cust = await getCustomer(admin, tok.customer_id);
    if (!cust) return json({ error: "customer_not_found" }, 404);

    const deviceToken = randomToken("device_");
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      null;

    const { error: insErr } = await admin.from("device_credentials").insert({
      customer_id: cust.id,
      device_token: deviceToken,
      device_name: String(body.device_name || "").slice(0, 80) || null,
      device_id: String(body.device_id || "unknown"),
      user_agent: String(body.user_agent || "").slice(0, 500) || null,
      ip_address: ip,
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (insErr) {
      console.error("[insider-device-auth] credential insert failed:", insErr.message);
      return json({ error: "setup_failed" }, 500);
    }

    await admin.from("setup_tokens").update({ used_at: new Date().toISOString() }).eq("id", tok.id);

    const userId = await ensureAuthUser(admin, cust.id, cust.phone_1 ?? "");
    if (!userId) return json({ error: "user_link_failed" }, 500);
    await activateCustomer(admin, cust.id, cust.phone_1 ?? "");

    return json({
      ok: true,
      device_token: deviceToken,
      customer_id: cust.id,
      customer_name: cust.customer_name,
      phone: cust.phone_1,
    });
  }

  // ----------------------------------------------------------
  // set-pin: attach 4-digit PIN, then sign in
  // ----------------------------------------------------------
  if (action === "set-pin") {
    const deviceToken = String(body.device_token || "").trim();
    const pin = String(body.pin || "");
    if (!deviceToken) return json({ error: "missing_device_token" }, 400);
    if (!/^\d{4}$/.test(pin)) return json({ error: "invalid_pin" }, 400);

    const cred = await findCredential(admin, deviceToken);
    if (!cred) return json({ error: "invalid_device" }, 401);

    const pinHash = await sha256(`${cred.customer_id}:${pin}`);
    const { error: updErr } = await admin
      .from("device_credentials")
      .update({
        pin_hash: pinHash,
        pin_attempts: 0,
        pin_locked_until: null,
        last_used_at: new Date().toISOString(),
      })
      .eq("id", cred.id);
    if (updErr) {
      console.error("[insider-device-auth] pin update failed:", updErr.message);
      return json({ error: "pin_save_failed" }, 500);
    }

    const cust = await getCustomer(admin, cred.customer_id);
    if (!cust) return json({ error: "customer_not_found" }, 404);

    const hashedToken = await issueSession(admin, cust.id, cust.phone_1 ?? "");
    if (!hashedToken) return json({ error: "session_failed" }, 500);

    return json({ ok: true, hashed_token: hashedToken, customer_name: cust.customer_name });
  }

  // ----------------------------------------------------------
  // login: device token + PIN -> session
  // ----------------------------------------------------------
  if (action === "login") {
    const deviceToken = String(body.device_token || "").trim();
    const pin = String(body.pin || "");
    if (!deviceToken) return json({ error: "missing_device_token" }, 400);
    if (!/^\d{4}$/.test(pin)) return json({ error: "invalid_pin" }, 400);

    const cred = await findCredential(admin, deviceToken);
    if (!cred) return json({ error: "invalid_device" }, 401);
    if (!cred.pin_hash) return json({ error: "pin_not_set" }, 409);

    if (cred.pin_locked_until && new Date(cred.pin_locked_until) > new Date()) {
      const minutes = Math.ceil(
        (new Date(cred.pin_locked_until).getTime() - Date.now()) / 60000,
      );
      return json({ error: "locked", retry_after_minutes: minutes }, 429);
    }

    const expected = await sha256(`${cred.customer_id}:${pin}`);
    if (expected !== cred.pin_hash) {
      const attempts = cred.pin_attempts + 1;
      const locked = attempts >= MAX_PIN_ATTEMPTS;
      await admin
        .from("device_credentials")
        .update({
          pin_attempts: locked ? 0 : attempts,
          pin_locked_until: locked
            ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString()
            : null,
        })
        .eq("id", cred.id);
      if (locked) return json({ error: "locked", retry_after_minutes: LOCK_MINUTES }, 429);
      return json({ error: "wrong_pin", attempts_left: MAX_PIN_ATTEMPTS - attempts }, 401);
    }

    await admin
      .from("device_credentials")
      .update({ pin_attempts: 0, pin_locked_until: null, last_used_at: new Date().toISOString() })
      .eq("id", cred.id);

    const cust = await getCustomer(admin, cred.customer_id);
    if (!cust) return json({ error: "customer_not_found" }, 404);

    const hashedToken = await issueSession(admin, cust.id, cust.phone_1 ?? "");
    if (!hashedToken) return json({ error: "session_failed" }, 500);

    return json({ ok: true, hashed_token: hashedToken, customer_name: cust.customer_name });
  }

  return json({ error: "unknown_action" }, 400);
});
