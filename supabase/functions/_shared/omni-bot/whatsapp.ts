// WhatsApp reply path for the omni-channel sales bot, on Meta's official WhatsApp Cloud API.
// Called from interakt-webhook (the Meta webhook that already receives the showroom number's
// messages) for senders who are NOT leads. Lead conversations stay with the sales team.
//
// Safety rules:
// - Replies only to a text message the customer just sent, inside WhatsApp's 24-hour customer-service
//   window. The bot never starts a conversation or sends follow-ups.
// - Media-only messages get no reply.
// - STOP, the hourly cap and duplicate deliveries are enforced by omni-bot.

export const WA_MAX_CHARS = 4000; // WhatsApp text body limit is 4096
export const GRAPH_VERSION = "v21.0";

export type FetchFn = typeof fetch;

export type BotReplyOpts = {
  senderDigits: string;     // customer number, digits with country code, e.g. "919876543210"
  text: string;             // the customer's message text
  externalId: string | null;// Meta message id (wamid) for de-duplication
  botUrl: string;           // .../functions/v1/omni-bot
  botSecret: string;
  phoneNumberId: string;    // our WhatsApp Cloud API phone number id
  accessToken: string;      // Meta system-user token with whatsapp_business_messaging
  fetchFn?: FetchFn;
};

export type BotReplyResult =
  | { sent: true; messageId: string | null }
  | { sent: false; reason: "media" | "empty" | "bot_skipped" | "bot_failed" | "send_failed" | "not_configured" };

const MEDIA_PLACEHOLDER = /^\[(image|audio|video|document|sticker|location|non-text message|media|button|interactive)\]$/;

export function trimForWhatsApp(text: string): string {
  return text.length <= WA_MAX_CHARS ? text : text.slice(0, WA_MAX_CHARS - 1).trimEnd() + "…";
}

export async function botReplyForWhatsApp(opts: BotReplyOpts): Promise<BotReplyResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  if (!opts.botUrl || !opts.botSecret || !opts.phoneNumberId || !opts.accessToken || !/^\d{8,15}$/.test(opts.senderDigits)) {
    return { sent: false, reason: "not_configured" };
  }
  const text = opts.text.trim();
  if (!text) return { sent: false, reason: "empty" };
  if (MEDIA_PLACEHOLDER.test(text)) return { sent: false, reason: "media" };

  const botRes = await fetchFn(opts.botUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-omni-secret": opts.botSecret },
    body: JSON.stringify({
      channel: "whatsapp", sender_id: opts.senderDigits, text,
      external_id: opts.externalId ?? undefined,
    }),
  });
  if (!botRes.ok) return { sent: false, reason: "bot_failed" };
  const bot = await botRes.json().catch(() => null);
  const reply = typeof bot?.reply === "string" ? bot.reply.trim() : "";
  if (!reply) return { sent: false, reason: "bot_skipped" };

  const res = await fetchFn(`https://graph.facebook.com/${GRAPH_VERSION}/${opts.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: opts.senderDigits,
      type: "text",
      text: { preview_url: false, body: trimForWhatsApp(reply) },
    }),
  });
  if (!res.ok) return { sent: false, reason: "send_failed" };
  const sent = await res.json().catch(() => ({}));
  const id = sent?.messages?.[0]?.id;
  return { sent: true, messageId: typeof id === "string" ? id : null };
}
