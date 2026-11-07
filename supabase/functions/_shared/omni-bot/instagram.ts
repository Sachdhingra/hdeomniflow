// Pure helpers for the Instagram (Meta) webhook: signature check and DM extraction.
// Kept free of Deno.env so they can be unit tested.

/** Checks Meta's X-Hub-Signature-256 header (sha256=<hex HMAC of the raw body using the app secret>). */
export async function verifySignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const actual = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const expected = header.slice(7);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export type InboundDm = { senderId: string; text: string };

/** Pulls text DMs out of a Meta "instagram" webhook payload. Echoes, attachments and our own messages are ignored. */
export function extractDms(payload: any): InboundDm[] {
  if (payload?.object !== "instagram" || !Array.isArray(payload.entry)) return [];
  const out: InboundDm[] = [];
  for (const entry of payload.entry) {
    const pageId = String(entry?.id ?? "");
    for (const ev of entry?.messaging ?? []) {
      const senderId = String(ev?.sender?.id ?? "");
      const msg = ev?.message;
      if (!senderId || !msg || msg.is_echo) continue;
      if (senderId === pageId) continue;
      const text = typeof msg.text === "string" ? msg.text.trim() : "";
      if (text) out.push({ senderId, text });
    }
  }
  return out;
}
