// Approved Twilio Content (WhatsApp template) SIDs for Home Decor Enterprises.
// Business-initiated WhatsApp messages MUST use a template — plain text only
// works inside the 24h window after the customer's last reply (Twilio 63016).
export const TWILIO_TEMPLATES = {
  // "Hi {{1}}! ... /invite?token={{2}} ..." — Insider Elite Card app invite
  // Switched to the approved v2 card template after v1 was rejected.
  appInvite: "HX7e8100646a839538ce9cc29f5ff2bd9a",
  // Authentication template, {{1}} = one-time code
  verificationCode: "HXad13029a82f0c6966ced9d47fb7fb888",
  // Marketing / utility templates already approved
  leadWelcome: "HXa50d2f1a512771a524583a6432c860f4",
  eliteCardWelcome: "HX2c0e7b006df9d6823059c69f9816d819",
  reviewThankYou: "HX16893586e03d1d1fd84b484f2d4a4252",
  // Generic Insider app notification mirror:
  // {{1}} first name, {{2}} notification title, {{3}} notification message
  insiderNotification: "HX9311ebb75eca678d1cb894ce1ea9c0a9",
} as const;

export const WHATSAPP_FROM_FALLBACK = "whatsapp:+15559890033";

/** Resolve the configured WhatsApp sender, always prefixed with "whatsapp:". */
export function whatsappFrom(): string {
  const raw = (Deno.env.get("TWILIO_WHATSAPP_FROM") || "").trim() ||
    WHATSAPP_FROM_FALLBACK;
  return raw.startsWith("whatsapp:") ? raw : `whatsapp:${raw}`;
}
