import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

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
  const digits = String(raw || "").replace(/\D/g, "");
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return ten.length === 10 ? `+91${ten}` : String(raw || "").trim();
}

function virtualEmail(phone: string): string {
  return `${normalizePhone(phone).replace(/\D/g, "")}@invite.hdi.local`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let phone = "";
  let password = "";
  try {
    const body = await req.json();
    phone = String(body.phone || "").trim();
    password = String(body.password || "");
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  if (!phone || password.length < 6) {
    return json({ error: "invalid_credentials" }, 400);
  }

  const canonical = normalizePhone(phone);
  const email = virtualEmail(canonical);

  // Verify customer is an active Elite member linked to an app user
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: cust } = await admin
    .from("elite_customers")
    .select("id, status, app_activated")
    .eq("phone_1", canonical)
    .maybeSingle();

  if (!cust || cust.status !== "active" || !cust.app_activated) {
    return json({ error: "not_enrolled" }, 403);
  }

  // Sign in with password using an anon client
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await client.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    return json({ error: "invalid_credentials" }, 401);
  }

  return json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: data.session.expires_in,
    expires_at: data.session.expires_at,
    user_id: data.user?.id,
  });
});
