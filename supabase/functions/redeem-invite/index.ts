import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Stable virtual email derived from E.164 phone, never delivered to a real inbox */
function virtualEmail(phone: string): string {
  return `${phone.replace(/\+/g, "")}@invite.hdi.local`;
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
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // 1. Validate token
  const { data: invite, error: inviteErr } = await admin
    .from("invite_tokens")
    .select("customer_id, phone, used_at, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (inviteErr || !invite) {
    return new Response(JSON.stringify({ error: "invalid" }), {
      status: 404, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  if (invite.used_at) {
    return new Response(JSON.stringify({ error: "already_used" }), {
      status: 409, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  if (new Date(invite.expires_at) < new Date()) {
    return new Response(JSON.stringify({ error: "expired" }), {
      status: 410, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const { customer_id, phone } = invite;
  const email = virtualEmail(phone);

  // 2. Find or create auth user, ensuring app_users link exists
  let userId: string;

  const { data: appUser } = await admin
    .from("app_users")
    .select("user_id")
    .eq("customer_id", customer_id)
    .maybeSingle();

  if (appUser?.user_id) {
    // Customer already linked — add virtual email to existing account so we can
    // generate a magic link (email_confirm: true prevents a real email being sent)
    userId = appUser.user_id;
    await admin.auth.admin.updateUserById(userId, { email, email_confirm: true });
  } else {
    // First-time activation — create auth user
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });

    if (createErr) {
      // User with this email already exists in auth but no app_users row
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const existing = list?.users.find((u) => u.email === email);
      if (!existing) {
        return new Response(JSON.stringify({ error: "auth_create_failed" }), {
          status: 500, headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      userId = existing.id;
    } else {
      userId = created!.user!.id;
    }

    // Link auth user → elite_customers
    await admin
      .from("app_users")
      .upsert({ user_id: userId, customer_id, push_enabled: true }, { onConflict: "user_id" });

    // First-activation: set app_activated + referral_code
    const { data: cust } = await admin
      .from("elite_customers")
      .select("app_activated, referral_code")
      .eq("id", customer_id)
      .single();

    const updates: Record<string, unknown> = {};
    if (!cust?.app_activated) updates.app_activated = true;
    if (!cust?.referral_code) {
      const last4 = phone.slice(-4);
      const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let suffix = "";
      for (let i = 0; i < 4; i++) suffix += alpha[Math.floor(Math.random() * alpha.length)];
      updates.referral_code = `EC${last4}${suffix}`;
    }
    if (Object.keys(updates).length > 0) {
      await admin.from("elite_customers").update(updates).eq("id", customer_id);
    }
  }

  // 3. Generate magic link → get hashed_token for client-side verifyOtp
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (linkErr || !linkData?.properties?.hashed_token) {
    return new Response(JSON.stringify({ error: "link_gen_failed" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // 4. Mark token as used
  await admin
    .from("invite_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token", token);

  return new Response(
    JSON.stringify({ hashed_token: linkData.properties.hashed_token, phone }),
    { headers: { ...cors, "Content-Type": "application/json" } },
  );
});
