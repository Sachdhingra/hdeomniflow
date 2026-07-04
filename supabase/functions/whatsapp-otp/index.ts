import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const WHATSAPP_FROM = "whatsapp:+15559890033";

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
  const body =
    `Your Home Decor Insider verification code is: *${otp}*\n\nValid for 10 minutes. Do not share this code.`;

  const twilioUrl =
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

  const res = await fetch(twilioUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ From: WHATSAPP_FROM, To: to, Body: body }).toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[whatsapp-otp] Twilio error:", err);
    return new Response("Failed to send WhatsApp OTP", { status: 500 });
  }

  return new Response("OK", { status: 200 });
});
