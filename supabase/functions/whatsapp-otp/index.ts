import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { TWILIO_TEMPLATES, whatsappFrom } from "../_shared/twilio-templates.ts";

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";

async function twilioSend(params: Record<string, string>) {
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params).toString(),
    },
  );
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let phone: string, otp: string;
  try {
    ({ phone, otp } = await req.json());
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!phone || !otp) {
    return new Response("Missing phone or otp", { status: 400 });
  }

  const to = `whatsapp:${phone}`;
  const from = whatsappFrom();

  // Business-initiated message → must use the approved authentication template.
  let result = await twilioSend({
    From: from,
    To: to,
    ContentSid: TWILIO_TEMPLATES.verificationCode,
    ContentVariables: JSON.stringify({ "1": String(otp) }),
  });

  // Fallback to plain text (works inside an open 24h session window) if the
  // template is not usable yet (e.g. pending WhatsApp approval).
  if (!result.ok) {
    console.error("[whatsapp-otp] template send failed:", result.status, result.text);
    result = await twilioSend({
      From: from,
      To: to,
      Body:
        `Your Home Decor Insider verification code is: *${otp}*\n\nValid for 10 minutes. Do not share this code.`,
    });
  }

  if (!result.ok) {
    console.error("[whatsapp-otp] Twilio error:", result.status, result.text);
    return new Response("Failed to send WhatsApp OTP", { status: 500 });
  }

  return new Response("OK", { status: 200 });
});
