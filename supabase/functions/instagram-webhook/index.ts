// Instagram direct-message adapter for the omni-channel sales bot.
//   GET  — Meta webhook verification (hub.challenge), checked against IG_VERIFY_TOKEN
//   POST — inbound DMs. Each text DM is answered by the omni-bot function and the reply is sent back
//          through the Instagram messaging API. Signature checked with META_APP_SECRET; fails closed.
// Secrets: META_APP_SECRET, IG_VERIFY_TOKEN, IG_PAGE_ACCESS_TOKEN, OMNI_BOT_SECRET.
// Optional: IG_GRAPH_URL (default https://graph.facebook.com/v21.0/me/messages).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const IG_VERIFY_TOKEN = Deno.env.get("IG_VERIFY_TOKEN") ?? "";
const IG_PAGE_ACCESS_TOKEN = Deno.env.get("IG_PAGE_ACCESS_TOKEN") ?? "";
const OMNI_BOT_SECRET = Deno.env.get("OMNI_BOT_SECRET") ?? "";
const IG_GRAPH_URL = Deno.env.get("IG_GRAPH_URL") ?? "https://graph.facebook.com/v21.0/me/messages";
const OMNI_BOT_URL = SUPABASE_URL + "/functions/v1/omni-bot";
import { extractDms, verifySignature } from "../_shared/omni-bot/instagram.ts";

const IG_MAX_CHARS = 1000; // Instagram DM text limit

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function askBot(senderId: string, text: string): Promise<string | null> {
  const r = await fetch(OMNI_BOT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-omni-secret": OMNI_BOT_SECRET },
    body: JSON.stringify({ channel: "instagram", sender_id: senderId, text }),
  });
  if (!r.ok) { console.error("omni-bot", r.status, await r.text()); return null; }
  const body = await r.json();
  return typeof body.reply === "string" && body.reply ? body.reply : null;
}

async function sendDm(recipientId: string, text: string): Promise<boolean> {
  const r = await fetch(IG_GRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${IG_PAGE_ACCESS_TOKEN}` },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text: text.slice(0, IG_MAX_CHARS) }, messaging_type: "RESPONSE" }),
  });
  if (!r.ok) console.error("instagram send", r.status, await r.text());
  return r.ok;
}

Deno.serve(async (req) => {
  if (req.method === "GET") {
    const url = new URL(req.url);
    if (!IG_VERIFY_TOKEN) return new Response("Not configured", { status: 503 });
    if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === IG_VERIFY_TOKEN) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!OMNI_BOT_SECRET || !IG_PAGE_ACCESS_TOKEN) return json({ error: "Not configured" }, 503);

  const raw = await req.text();
  if (!(await verifySignature(raw, req.headers.get("x-hub-signature-256"), META_APP_SECRET))) {
    return json({ error: "Invalid signature" }, 401);
  }

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return json({ error: "Bad request" }, 400); }

  for (const dm of extractDms(payload)) {
    try {
      const reply = await askBot(dm.senderId, dm.text);
      if (reply) await sendDm(dm.senderId, reply);
    } catch (e) {
      console.error("instagram-webhook", e);
    }
  }
  // Meta expects a quick 200 for every delivery, even when a reply is skipped.
  return json({ ok: true });
});
