import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { botEnabledFor, botReplyForWhatsApp, trimForWhatsApp, WA_MAX_CHARS } from "./whatsapp.ts";
import type { BotReplyOpts } from "./whatsapp.ts";

type Call = { url: string; method: string; headers: Record<string, string>; body: string };

function fakeFetch(botReply: unknown, botStatus = 200, metaStatus = 200) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({
      url: u,
      method: String(init?.method),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: String(init?.body ?? ""),
    });
    if (u.includes("omni-bot")) {
      return new Response(JSON.stringify(botReply), { status: botStatus, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ messages: [{ id: "wamid.OUT1" }] }), { status: metaStatus, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fn, calls };
}

const base: BotReplyOpts = {
  senderDigits: "919876543210",
  text: "sofa price?",
  externalId: "wamid.IN1",
  botUrl: "https://proj.test/functions/v1/omni-bot",
  botSecret: "s3cret",
  phoneNumberId: "1234567890",
  accessToken: "meta-token",
};

Deno.test("sends the bot's reply to the customer through the Meta Cloud API", async () => {
  const f = fakeFetch({ reply: "Ji, L Shape sofa MRP from ₹49,407." });
  const res = await botReplyForWhatsApp({ ...base, fetchFn: f.fn });
  assertEquals(res, { sent: true, messageId: "wamid.OUT1" });
  const sent = f.calls[1];
  assertEquals(sent.url, "https://graph.facebook.com/v21.0/1234567890/messages");
  assertEquals(sent.headers.Authorization, "Bearer meta-token");
  assertEquals(JSON.parse(sent.body), {
    messaging_product: "whatsapp",
    to: "919876543210",
    type: "text",
    text: { preview_url: false, body: "Ji, L Shape sofa MRP from ₹49,407." },
  });
});

Deno.test("asks the bot with the whatsapp channel, digits key and message id", async () => {
  const f = fakeFetch({ reply: "ok" });
  await botReplyForWhatsApp({ ...base, fetchFn: f.fn });
  assertEquals(f.calls[0].headers["x-omni-secret"], "s3cret");
  assertEquals(JSON.parse(f.calls[0].body), {
    channel: "whatsapp", sender_id: "919876543210", text: "sofa price?", external_id: "wamid.IN1",
  });
});

Deno.test("does not reply to media-only messages or empty text", async () => {
  for (const text of ["[image]", "[non-text message]", "   "]) {
    const f = fakeFetch({ reply: "should not be sent" });
    const res = await botReplyForWhatsApp({ ...base, text, fetchFn: f.fn });
    assertEquals(res.sent, false);
    assertEquals(f.calls.length, 0);
  }
});

Deno.test("sends nothing when the bot skips the sender (opt-out, rate limit or duplicate)", async () => {
  const f = fakeFetch({ reply: null, skipped: "duplicate" });
  const res = await botReplyForWhatsApp({ ...base, fetchFn: f.fn });
  assertEquals(res, { sent: false, reason: "bot_skipped" });
  assertEquals(f.calls.length, 1);
});

Deno.test("sends nothing when the bot fails", async () => {
  const f = fakeFetch({ error: "x" }, 503);
  const res = await botReplyForWhatsApp({ ...base, fetchFn: f.fn });
  assertEquals(res, { sent: false, reason: "bot_failed" });
  assertEquals(f.calls.length, 1);
});

Deno.test("reports a Meta send failure without throwing", async () => {
  const f = fakeFetch({ reply: "hi" }, 200, 400);
  const res = await botReplyForWhatsApp({ ...base, fetchFn: f.fn });
  assertEquals(res, { sent: false, reason: "send_failed" });
});

Deno.test("stays silent until configured", async () => {
  const f = fakeFetch({ reply: "hi" });
  const res = await botReplyForWhatsApp({ ...base, accessToken: "", fetchFn: f.fn });
  assertEquals(res, { sent: false, reason: "not_configured" });
  assertEquals(f.calls.length, 0);
  const bad = await botReplyForWhatsApp({ ...base, senderDigits: "abc", fetchFn: f.fn });
  assertEquals(bad, { sent: false, reason: "not_configured" });
});

Deno.test("trims very long replies to the WhatsApp limit", () => {
  const long = "a".repeat(WA_MAX_CHARS + 50);
  const t = trimForWhatsApp(long);
  assert(t.length <= WA_MAX_CHARS);
  assert(t.endsWith("…"));
  assertEquals(trimForWhatsApp("short"), "short");
});

Deno.test("bot answers only on the numbers in the allowlist", () => {
  assertEquals(botEnabledFor("111", "111"), true);
  assertEquals(botEnabledFor("111", " 222 , 111 "), true);
  assertEquals(botEnabledFor("333", "111,222"), false);
  assertEquals(botEnabledFor("111", ""), false);
  assertEquals(botEnabledFor("", "111"), false);
});
