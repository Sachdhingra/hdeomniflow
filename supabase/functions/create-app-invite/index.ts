import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const PWA_URL = Deno.env.get("PWA_URL") ?? "https://homedecorinsider.lovable.app";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Require authenticated caller
  const authHeader = req.headers.get("Authorization") ?? "";
  const anon = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await anon.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let customerId: string, phone: string;
  try {
    ({ customerId, phone } = await req.json());
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  const { error: insertErr } = await admin.from("invite_tokens").insert({
    token,
    customer_id: customerId,
    phone,
    expires_at: expiresAt.toISOString(),
  });

  if (insertErr) {
    return new Response(JSON.stringify({ error: insertErr.message }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ link: `${PWA_URL}/invite?token=${token}` }),
    { headers: { ...cors, "Content-Type": "application/json" } },
  );
});
