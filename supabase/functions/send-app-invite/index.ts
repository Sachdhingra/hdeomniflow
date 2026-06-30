import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const WHATSAPP_FROM = "whatsapp:+15559890033";
const PWA_URL = Deno.env.get("PWA_URL") ?? "https://home-decor-insider.pages.dev";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Require authenticated caller (admin / sales user)
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

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let customerId: string, phone: string, customerName: string;
  try {
    ({ customerId, phone, customerName } = await req.json());
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Generate a cryptographically random token
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

  const inviteLink = `${PWA_URL}/invite?token=${token}`;
  const firstName = customerName.split(" ")[0];
  const body =
    `Hi ${firstName}! 🎉 Your Home Decor Insider Elite Card is ready.\n\n` +
    `Tap here to access your exclusive account:\n${inviteLink}\n\n` +
    `_This link is valid for 30 days._`;

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: WHATSAPP_FROM,
        To: `whatsapp:${phone}`,
        Body: body,
      }).toString(),
    },
  );

  if (!res.ok) {
    console.error("[send-app-invite] Twilio error:", await res.text());
    // Token was created — don't fail the whole operation
    return new Response(
      JSON.stringify({ success: true, warning: "Token created but WhatsApp delivery failed" }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
