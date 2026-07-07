import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return ten.length === 10 ? `+91${ten}` : raw.trim();
}

/** Stable virtual email derived from the phone, never delivered to a real inbox */
function virtualEmail(phone: string): string {
  return `${normalizePhone(phone).replace(/\D/g, "")}@invite.hdi.local`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let token: string;
  try {
    ({ token } = await req.json());
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  token = String(token || "").trim();
  if (!token) {
    return json({ error: "missing_token" }, 400);
  }

  // 1. Validate token
  const { data: invite, error: inviteErr } = await admin
    .from("invite_tokens")
    .select("customer_id, phone, used_at, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (inviteErr || !invite) {
    return json({ error: "invalid" }, 404);
  }
  if (invite.used_at) {
    return json({ error: "already_used" }, 409);
  }
  if (new Date(invite.expires_at) < new Date()) {
    return json({ error: "expired" }, 410);
  }

  const { customer_id, phone } = invite;
  const canonicalPhone = normalizePhone(phone);
  const email = virtualEmail(canonicalPhone);

  // 2. Find or create auth user, ensuring app_users link exists
  let userId: string;

  const { data: appUser } = await admin
    .from("app_users")
    .select("user_id")
    .eq("customer_id", customer_id)
    .maybeSingle();

  if (appUser?.user_id) {
    // Already linked — refresh virtual email so magic link generation works
    userId = appUser.user_id;
    await admin.auth.admin.updateUserById(userId, { email, email_confirm: true });
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { customer_id, phone: canonicalPhone },
    });

    if (createErr) {
      // Auth user with this email exists but no app_users row yet
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const existing = list?.users.find((u) => u.email === email);
      if (!existing) {
        return json({ error: "auth_create_failed", detail: createErr.message }, 500);
      }
      userId = existing.id;
    } else {
      userId = created!.user!.id;
    }

    const { error: linkErr } = await admin
      .from("app_users")
      .upsert(
        { user_id: userId, customer_id, phone: canonicalPhone, push_enabled: true },
        { onConflict: "user_id" },
      );

    if (linkErr) {
      return json({ error: "app_user_link_failed", detail: linkErr.message }, 500);
    }

    // First-activation: set app_activated + referral_code
    const { data: cust } = await admin
      .from("elite_customers")
      .select("app_activated, referral_code")
      .eq("id", customer_id)
      .single();

    const updates: Record<string, unknown> = {};
    if (!cust?.app_activated) updates.app_activated = true;
    if (!cust?.referral_code) {
      const last4 = canonicalPhone.slice(-4);
      const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let suffix = "";
      for (let i = 0; i < 4; i++) suffix += alpha[Math.floor(Math.random() * alpha.length)];
      updates.referral_code = `EC${last4}${suffix}`;
    }
    if (Object.keys(updates).length > 0) {
      await admin.from("elite_customers").update(updates).eq("id", customer_id);
    }
  }

  // 3. Generate magic link → hashed_token for client-side verifyOtp
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (linkErr || !linkData?.properties?.hashed_token) {
    return json({ error: "link_gen_failed", detail: linkErr?.message }, 500);
  }

  // 4. Mark token as used
  const { error: usedErr } = await admin
    .from("invite_tokens")
    .update({ used_at: new Date().toISOString(), redeemed_user_id: userId })
    .eq("token", token);

  if (usedErr) {
    return json({ error: "mark_used_failed", detail: usedErr.message }, 500);
  }

  return json({ hashed_token: linkData.properties.hashed_token, phone: canonicalPhone });
});
