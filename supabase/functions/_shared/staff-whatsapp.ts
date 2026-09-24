// Mirrors important OmniFlow staff alerts to the staff member's own WhatsApp
// via the "hde_staff_alert" Twilio Content template:
//   {{1}} staff first name, {{2}} alert title, {{3}} alert message
//
// Only operational alerts are mirrored — new leads, order workflow steps and
// admin staff broadcasts. Chat messages stay push-only: they are frequent,
// and every business-initiated WhatsApp message is billed by Meta.
//
// The template SID comes from TWILIO_STAFF_ALERT_TEMPLATE_SID, set once Meta
// has approved the template. Until then, and whenever Twilio is not
// configured, mirroring is skipped. Like the Insider mirror it is
// best-effort: a WhatsApp failure is logged and never fails the push.
import { whatsappFrom } from "./twilio-templates.ts";
import { normalizeIndianPhone } from "./indian-phone.ts";

const MAX_CONCURRENCY = 5;

/** Alert types worth a WhatsApp message. Everything else stays push-only. */
export function isWhatsAppWorthyStaffAlert(type: string | null | undefined): boolean {
  const t = (type || "").toLowerCase();
  return t === "lead_assigned" || t.startsWith("order_") || t.startsWith("broadcast_");
}

export function staffWhatsAppEnabled(): boolean {
  if ((Deno.env.get("STAFF_WHATSAPP_DISABLED") || "").toLowerCase() === "true") return false;
  return !!Deno.env.get("TWILIO_STAFF_ALERT_TEMPLATE_SID");
}

function firstName(name: string | null): string {
  const n = (name || "").trim().split(/\s+/)[0] || "there";
  return n.replace(/[{}]/g, "");
}

/** Template variables can't carry newlines or be empty; emoji titles are fine. */
export function templateText(text: string | null | undefined, max: number): string {
  return (text || "").replace(/\s+/g, " ").trim().slice(0, max) || "-";
}

type Outcome = { userId: string; phone: string; name: string | null; ok: boolean; sid?: string; error?: string };

async function sendOne(
  accountSid: string,
  authToken: string,
  from: string,
  contentSid: string,
  userId: string,
  rawPhone: string,
  name: string | null,
  title: string,
  message: string,
): Promise<Outcome> {
  const to = normalizeIndianPhone(rawPhone);
  if (!to) return { userId, phone: rawPhone, name, ok: false, error: "Invalid phone number" };

  const body = new URLSearchParams();
  body.set("To", `whatsapp:${to}`);
  body.set("From", from);
  body.set("ContentSid", contentSid);
  body.set(
    "ContentVariables",
    JSON.stringify({
      "1": firstName(name),
      "2": templateText(title, 120),
      "3": templateText(message, 700),
    }),
  );
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (supabaseUrl) body.set("StatusCallback", `${supabaseUrl}/functions/v1/twilio-status`);

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
    const text = await res.text();
    // deno-lint-ignore no-explicit-any
    let parsed: any = text;
    try { parsed = JSON.parse(text); } catch { /* keep raw */ }
    if (!res.ok) {
      const err = parsed?.message || `HTTP ${res.status}`;
      console.error("[staff-whatsapp] Twilio error", res.status, err);
      return { userId, phone: to, name, ok: false, error: String(err) };
    }
    return { userId, phone: to, name, ok: true, sid: parsed?.sid };
  } catch (e) {
    console.error("[staff-whatsapp] fetch failed:", String(e));
    return { userId, phone: to, name, ok: false, error: String(e) };
  }
}

/**
 * Send one alert on WhatsApp to each staff user that has a phone number on
 * their profile. Returns how many messages Twilio accepted.
 */
export async function mirrorStaffAlertToWhatsApp(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userIds: string[],
  alert: { type: string; title: string; message: string },
): Promise<number> {
  if (!isWhatsAppWorthyStaffAlert(alert.type) || !staffWhatsAppEnabled()) return 0;
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return 0;

  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const contentSid = Deno.env.get("TWILIO_STAFF_ALERT_TEMPLATE_SID")!;
  if (!accountSid || !authToken) {
    console.warn("[staff-whatsapp] Twilio credentials missing — skipping");
    return 0;
  }
  const from = whatsappFrom();

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, name, phone_number, active")
    .in("id", ids);
  if (error) {
    console.error("[staff-whatsapp] profile lookup failed:", error.message);
    return 0;
  }

  // One message per phone number, even if two accounts share a phone.
  const seenPhones = new Set<string>();
  const recipients = (profiles ?? []).filter((p: { phone_number: string | null; active: boolean }) => {
    if (p.active === false || !p.phone_number) return false;
    const key = normalizeIndianPhone(p.phone_number) || p.phone_number;
    if (seenPhones.has(key)) return false;
    seenPhones.add(key);
    return true;
  });

  let sent = 0;
  const logRows: Record<string, unknown>[] = [];
  for (let i = 0; i < recipients.length; i += MAX_CONCURRENCY) {
    const slice = recipients.slice(i, i + MAX_CONCURRENCY);
    const results = await Promise.all(
      slice.map((p: { id: string; name: string | null; phone_number: string }) =>
        sendOne(accountSid, authToken, from, contentSid, p.id, p.phone_number, p.name, alert.title, alert.message)
      ),
    );
    for (const r of results) {
      if (r.ok) sent += 1;
      logRows.push({
        phone: r.phone,
        recipient_name: r.name,
        message: `[staff-alert:${alert.type}] ${alert.title} — ${alert.message}`,
        provider: "twilio",
        provider_message_id: r.sid ?? null,
        status: r.ok ? "sent" : "failed",
        error_message: r.error ?? null,
        sent_at: r.ok ? new Date().toISOString() : null,
      });
    }
  }

  if (logRows.length) {
    const { error: logErr } = await supabase.from("message_logs").insert(logRows);
    if (logErr) console.error("[staff-whatsapp] log insert failed:", logErr.message);
  }

  console.log(`[staff-whatsapp] ${sent}/${recipients.length} staff alerts sent on WhatsApp (${alert.type})`);
  return sent;
}
