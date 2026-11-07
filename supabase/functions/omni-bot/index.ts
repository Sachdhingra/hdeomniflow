// Omni-channel sales bot: one answer engine for every inbox (Instagram DMs, WhatsApp, others).
// Called server-to-server by the channel adapters (instagram-webhook, ...). Never called by browsers,
// so it requires the shared secret OMNI_BOT_SECRET in the x-omni-secret header and fails closed if
// that secret is not set.
//
// Request:  POST { channel: "instagram" | "whatsapp" | ..., sender_id: string, text: string, sender_name?: string }
// Response: { reply: string | null, skipped?: "opted_out" | "rate_limited" | "empty", enquiry_sent: boolean }
// The adapter is responsible for sending `reply` back to the customer on its own channel.
//
// Rules enforced here:
// - Sender sends STOP / UNSUBSCRIBE: they are opted out and get no further replies (no tool call).
// - At most 30 customer messages per sender per hour, so a flood cannot run up model costs.
// - Only one enquiry per sender reaches the consultant (send_enquiry is refused after the first).
// - Conversation memory is the last 20 turns from the last 24 hours.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import { fetchCatalog } from "../_shared/omni-bot/catalog.ts";
import type { Catalog } from "../_shared/omni-bot/catalog.ts";
import { answerCustomer } from "../_shared/omni-bot/core.ts";
import type { Deps, Lead, Turn } from "../_shared/omni-bot/core.ts";
import { SITE_DEFAULT } from "../_shared/omni-bot/prompt.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OMNI_BOT_SECRET = Deno.env.get("OMNI_BOT_SECRET") ?? "";
const API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const API_URL = (Deno.env.get("ANTHROPIC_BASE_URL") ?? "https://api.anthropic.com") + "/v1/messages";
const MODEL = Deno.env.get("AGENT_MODEL") ?? "claude-sonnet-5-5";
const SITE = (Deno.env.get("SITE_URL") ?? SITE_DEFAULT).replace(/\/$/, "");
const LEAD_URL = SUPABASE_URL + "/functions/v1/website-lead";

const HOURLY_LIMIT = 30;
const HISTORY_TURNS = 20;
const HISTORY_HOURS = 24;

const FALLBACK =
  "Sorry, mujhe abhi thodi dikkat aa rahi hai. Aap +91 99172 33664 par call ya WhatsApp kar sakte hain, hamari team turant madad karegi 🙏";
const STOP_WORDS = new Set(["STOP", "UNSUBSCRIBE"]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let catalogCache: { at: number; value: Catalog } | null = null;
async function catalog(): Promise<Catalog> {
  if (catalogCache && Date.now() - catalogCache.at < 6 * 3600_000) return catalogCache.value;
  const value = await fetchCatalog(SITE);
  catalogCache = { at: Date.now(), value };
  return value;
}

async function fetchProductRaw(id: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${SITE}/assets/data/products/${encodeURIComponent(id)}.json`);
  return r.ok ? await r.json() : {};
}

async function sendLead(lead: Lead, pageLabel: string): Promise<boolean> {
  const body = {
    name: lead.name, phone: lead.phone, email: "", interest: lead.interest, area: lead.area ?? "", store: "",
    product: lead.product,
    message: [
      `Via ${pageLabel} sales bot.`, lead.summary,
      lead.best_time ? "Best time to call: " + lead.best_time : "",
      lead.product ? "Liked: " + lead.product : "",
    ].filter(Boolean).join("\n"),
    source: "chat", page: `${pageLabel} | AI sales bot`, ref: null, submittedAt: new Date().toISOString(),
  };
  const r = await fetch(LEAD_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) console.error("website-lead", r.status, await r.text());
  return r.ok;
}

async function callModel(body: unknown) {
  const r = await fetch(API_URL, {
    method: "POST",
    headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}: ${await r.text()}`);
  return await r.json();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!OMNI_BOT_SECRET || req.headers.get("x-omni-secret") !== OMNI_BOT_SECRET) return json({ error: "Unauthorized" }, 401);
  if (!API_KEY) return json({ error: "Bot not configured" }, 503);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const channel = String(body.channel ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 30);
  const senderId = String(body.sender_id ?? "").slice(0, 100);
  const senderName = typeof body.sender_name === "string" ? body.sender_name.slice(0, 80) : null;
  const text = String(body.text ?? "").trim().slice(0, 2000);
  if (!channel || !senderId) return json({ error: "channel and sender_id are required" }, 400);
  if (!text) return json({ reply: null, skipped: "empty", enquiry_sent: false });

  // Sender state (opt-out, enquiry already sent).
  const { data: sender } = await db.from("omni_bot_senders").select("opted_out, enquiry_sent")
    .eq("channel", channel).eq("sender_id", senderId).maybeSingle();
  if (sender?.opted_out) return json({ reply: null, skipped: "opted_out", enquiry_sent: !!sender.enquiry_sent });

  if (STOP_WORDS.has(text.toUpperCase())) {
    await db.from("omni_bot_senders").upsert({
      channel, sender_id: senderId, name: senderName, opted_out: true, updated_at: new Date().toISOString(),
    }, { onConflict: "channel,sender_id" });
    return json({ reply: "Theek hai, ab aapko message nahi karenge. Aapka dhanyavaad 🙏 Kabhi bhi +91 99172 33664 par WhatsApp kar sakte hain.", skipped: "opted_out", enquiry_sent: !!sender?.enquiry_sent });
  }

  // Rate limit: customer messages in the last hour.
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { count: recent } = await db.from("omni_bot_messages").select("id", { count: "exact", head: true })
    .eq("channel", channel).eq("sender_id", senderId).eq("role", "user").gte("created_at", hourAgo);
  if ((recent ?? 0) >= HOURLY_LIMIT) return json({ reply: null, skipped: "rate_limited", enquiry_sent: !!sender?.enquiry_sent });

  // Memory: last turns from the last 24 hours.
  const since = new Date(Date.now() - HISTORY_HOURS * 3600_000).toISOString();
  const { data: rows } = await db.from("omni_bot_messages").select("role, content")
    .eq("channel", channel).eq("sender_id", senderId).gte("created_at", since)
    .order("created_at", { ascending: false }).limit(HISTORY_TURNS);
  const history: Turn[] = (rows ?? []).reverse().map((r: any) => ({ role: r.role, content: r.content }));
  history.push({ role: "user", content: text });
  // Anthropic requires alternating roles starting with the user.
  const clean: Turn[] = [];
  for (const t of history) {
    if (clean.length === 0 && t.role !== "user") continue;
    if (clean.length && clean[clean.length - 1].role === t.role) continue;
    clean.push(t);
  }
  if (clean[clean.length - 1].role !== "user") clean.push({ role: "user", content: text });

  await db.from("omni_bot_messages").insert({ channel, sender_id: senderId, role: "user", content: text });

  let reply = FALLBACK;
  let enquirySent = !!sender?.enquiry_sent;
  try {
    const deps: Deps = {
      catalog,
      fetchProductRaw,
      sendLead: (lead) => sendLead(lead, channel),
      callModel,
      site: SITE,
      model: MODEL,
    };
    const result = await answerCustomer(channel, clean, deps, { enquirySent });
    reply = result.reply;
    enquirySent = result.enquirySent;
  } catch (e) {
    console.error("omni-bot", e);
  }

  await db.from("omni_bot_messages").insert({ channel, sender_id: senderId, role: "assistant", content: reply });
  await db.from("omni_bot_senders").upsert({
    channel, sender_id: senderId, name: senderName, enquiry_sent: enquirySent, updated_at: new Date().toISOString(),
  }, { onConflict: "channel,sender_id" });

  return json({ reply, enquiry_sent: enquirySent });
});
