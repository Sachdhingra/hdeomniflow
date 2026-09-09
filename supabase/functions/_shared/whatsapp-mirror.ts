// Mirrors Insider app notifications to WhatsApp via the approved
// "hde_insider_notification" Twilio Content template.
//
// Business-initiated WhatsApp messages must use an approved template, so the
// notification headline and body are passed as template variables:
//   {{1}} customer first name, {{2}} title, {{3}} message
//
// Mirroring is best-effort: any failure is logged and swallowed so a WhatsApp
// problem can never block or fail a push notification.
import { TWILIO_TEMPLATES, whatsappFrom } from "./twilio-templates.ts";

const MAX_CONCURRENCY = 5;

export type MirrorTarget = {
  customer_id: string;
  title: string;
  message: string;
};

function normalizePhone(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length > 10 ? `+${digits}` : `+91${digits}`;
}

function firstName(name: string | null): string {
  const n = (name || "").trim().split(/\s+/)[0] || "there";
  return n.replace(/[{}]/g, "");
}

function clean(text: string, max: number): string {
  return (text || "").replace(/\s+/g, " ").trim().slice(0, max) || "-";
}

export function whatsappMirrorEnabled(): boolean {
  return (Deno.env.get("WHATSAPP_MIRROR_DISABLED") || "").toLowerCase() !== "true";
}

async function sendOne(
  accountSid: string,
  authToken: string,
  from: string,
  phone: string,
  name: string | null,
  title: string,
  message: string,
): Promise<boolean> {
  const to = normalizePhone(phone);
  if (!to) return false;

  const body = new URLSearchParams();
  body.set("To", `whatsapp:${to}`);
  body.set("From", from);
  body.set("ContentSid", TWILIO_TEMPLATES.insiderNotification);
  body.set(
    "ContentVariables",
    JSON.stringify({
      "1": firstName(name),
      "2": clean(title, 120),
      "3": clean(message, 700),
    }),
  );

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );
    if (!res.ok) {
      console.error("[whatsapp-mirror] Twilio error", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("[whatsapp-mirror] fetch failed:", String(e));
    return false;
  }
}

/**
 * Send the same notification text on WhatsApp to each target customer.
 * Returns the number of WhatsApp messages accepted by Twilio.
 */
// deno-lint-ignore no-explicit-any
export async function mirrorToWhatsApp(supabase: any, targets: MirrorTarget[]): Promise<number> {
  if (!whatsappMirrorEnabled() || targets.length === 0) return 0;

  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!accountSid || !authToken) {
    console.warn("[whatsapp-mirror] Twilio credentials missing — skipping");
    return 0;
  }
  const from = whatsappFrom();

  const ids = [...new Set(targets.map((t) => t.customer_id).filter(Boolean))];
  const { data: customers, error } = await supabase
    .from("elite_customers")
    .select("id, customer_name, phone_1")
    .in("id", ids);
  if (error) {
    console.error("[whatsapp-mirror] customer lookup failed:", error.message);
    return 0;
  }

  const byId = new Map<string, { customer_name: string | null; phone_1: string | null }>();
  for (const c of customers ?? []) byId.set(c.id as string, c);

  let sent = 0;
  for (let i = 0; i < targets.length; i += MAX_CONCURRENCY) {
    const slice = targets.slice(i, i + MAX_CONCURRENCY);
    const results = await Promise.all(
      slice.map((t) => {
        const c = byId.get(t.customer_id);
        if (!c?.phone_1) return Promise.resolve(false);
        return sendOne(accountSid, authToken, from, c.phone_1, c.customer_name, t.title, t.message);
      }),
    );
    sent += results.filter(Boolean).length;
  }

  console.log(`[whatsapp-mirror] ${sent}/${targets.length} mirrored to WhatsApp`);
  return sent;
}
