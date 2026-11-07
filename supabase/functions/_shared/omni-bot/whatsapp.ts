// WhatsApp reply path for the omni-channel sales bot (showroom number, via Twilio).
// Used by twilio-webhook for inbound messages from numbers that are NOT leads. Lead conversations
// stay with the sales team, so the bot never answers a lead.
//
// Safety rules:
// - Replies only to a text message the customer just sent, inside WhatsApp's 24-hour session.
//   The bot never starts a conversation or sends follow-ups.
// - Media-only messages get no reply.
// - Opt-out (STOP) and the per-sender hourly cap are enforced by omni-bot.

export const WA_MAX_CHARS = 1500; // Twilio/WhatsApp message body comfortably under 1600

export type FetchFn = typeof fetch;

export type BotReplyOpts = {
  fromRaw: string;            // Twilio "From", e.g. "whatsapp:+919876543210"
  senderPhone: string;        // normalised digits, e.g. "919876543210" (used as the bot's sender_id)
  text: string;              // the customer's message text ("[image]" style placeholders are skipped)
  botUrl: string;            // .../functions/v1/omni-bot
  botSecret: string;
  accountSid: string;
  authToken: string;
  showroomFrom: string;      // our WhatsApp sender, e.g. "whatsapp:+919917233664" or the raw number
  fetchFn?: FetchFn;
};

export type BotReplyResult =
  | { sent: true; messageSid: string | null }
  | { sent: false; reason: "media" | "empty" | "bot_skipped" | "bot_failed" | "twilio_failed" | "not_configured" };

const MEDIA_PLACEHOLDER = /^\[(image|audio|video|document|sticker|location|non-text message|media|button|interactive)\]$/;

export function trimForWhatsApp(text: string): string {
  return text.length <= WA_MAX_CHARS ? text : text.slice(0, WA_MAX_CHARS - 1).trimEnd() + "…";
}

function asWhatsAppAddress(raw: string): string {
  return raw.startsWith("whatsapp:") ? raw : `whatsapp:${raw.startsWith("+") ? raw : "+" + raw}`;
}

export async function botReplyForWhatsApp(opts: BotReplyOpts): Promise<BotReplyResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  if (!opts.botUrl || !opts.botSecret || !opts.accountSid || !opts.authToken || !opts.showroomFrom) {
    return { sent: false, reason: "not_configured" };
  }
  const text = opts.text.trim();
  if (!text) return { sent: false, reason: "empty" };
  if (MEDIA_PLACEHOLDER.test(text)) return { sent: false, reason: "media" };

  const botRes = await fetchFn(opts.botUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-omni-secret": opts.botSecret },
    body: JSON.stringify({ channel: "whatsapp", sender_id: opts.senderPhone, text }),
  });
  if (!botRes.ok) return { sent: false, reason: "bot_failed" };
  const bot = await botRes.json().catch(() => null);
  const reply = typeof bot?.reply === "string" ? bot.reply.trim() : "";
  if (!reply) return { sent: false, reason: "bot_skipped" };

  const body = new URLSearchParams();
  body.set("To", asWhatsAppAddress(opts.fromRaw));
  body.set("From", asWhatsAppAddress(opts.showroomFrom));
  body.set("Body", trimForWhatsApp(reply));
  const res = await fetchFn(`https://api.twilio.com/2010-04-01/Accounts/${opts.accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${opts.accountSid}:${opts.authToken}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) return { sent: false, reason: "twilio_failed" };
  const sent = await res.json().catch(() => ({}));
  return { sent: true, messageSid: typeof sent?.sid === "string" ? sent.sid : null };
}
