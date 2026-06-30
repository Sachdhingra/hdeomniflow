// ⚠️ COPY THIS FOLDER INTO THE INSIDER PWA PROJECT at supabase/functions/redeem-invite/index.ts
// The Insider project must be connected to the SAME backend as OmniFlow so it sees the
// shared `invite_tokens` table.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { token } = await req.json();
    if (!token) throw new Error("Missing token");

    // 1. Look up token
    const { data: row, error } = await admin
      .from("invite_tokens")
      .select("*")
      .eq("token", token)
      .maybeSingle();
    if (error || !row) throw new Error("Invite not found");
    if (row.used_at) throw new Error("Invite already used");
    if (new Date(row.expires_at) < new Date()) throw new Error("Invite expired");

    // 2. Synthesize a stable email from the customer's phone
    const email = `c_${row.phone.replace(/\D/g, "")}@insider.local`;
    const password = crypto.randomUUID();

    // 3. Create-or-update the auth user
    const { data: list } = await admin.auth.admin.listUsers();
    const existing = list.users.find((u) => u.email === email);
    let userId = existing?.id;
    if (existing) {
      await admin.auth.admin.updateUserById(existing.id, { password });
    } else {
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { customer_id: row.customer_id, phone: row.phone },
      });
      if (cErr) throw cErr;
      userId = created.user.id;
    }

    // 4. Mark token used
    await admin
      .from("invite_tokens")
      .update({ used_at: new Date().toISOString(), redeemed_user_id: userId })
      .eq("token", token);

    return new Response(JSON.stringify({ email, password }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
