import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { botReplyForWhatsApp, trimForWhatsApp, WA_MAX_CHARS } from "./whatsapp.ts";
import type { BotReplyOpts } from "./whatsapp.ts";

type Call = { url: string; method: string; headers: Record<string, string>; body: string };

function fakeFetch(botReply: unknown, botStatus = 200, twilioStatus = 201) {
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
    return new Response(JSON.stringify({ sid: "SM123" }), { status: twilioStatus, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fn, calls };
}

const base: BotReplyOpts = {
  fromRaw: "whatsapp:+919876543210",
  senderPhone: "919876543210",
  text: "sofa price?",
  botUrl: "https://proj.test/functions/v1/omni-bot",
  botSecret: "s3cret",
  accountSid: "AC123",
  authToken: "tok",
  showroomFrom: "whatsapp:+919917233664",
};

Deno.test("sends the bot's reply back to the customer from the showroom number", async () => {
  const f = fakeFetch({ reply: "Ji, L Shape sofa MRP from ₹49,407." });
  const res = await botReplyForWhatsApp({ ...base, fetchFn: f.fn });
  assertEquals(res, { sent: true, messageSid: "SM123" });
  const bot = f.calls[0];
  assertEquals(bot.headers["x-omni-secret"], "s3cret");
  const sent = Object.fromEntries(new URLSearchParams(f.calls[1].body));
  assertEquals(sent.To, "whatsapp:+919876543210");
  assertEquals(sent.From, "whatsapp:+919917233664");
  assertEquals(sent.Body, "Ji, L Shape sofa MRP from ₹49,407.");
  assert(f.calls[1].url.includes("/Accounts/AC123/Messages.json"));
});

Deno.test("sends the bot's sender key as digits and channel whatsapp", async () => {
  const f = fakeFetch({ reply: "ok" });
  await botReplyForWhatsApp({ ...base, fetchFn: f.fn });
  const body = JSON.parse(f.calls[0].body);
  assertEquals(body, { channel: "whatsapp", sender_id: "919876543210", text: "sofa price?" });
});

Deno.test("does not reply to media-only messages or empty text", async () => {
  for (const text of ["[image]", "[non-text message]", "   "]) {
    const f = fakeFetch({ reply: "should not be sent" });
    const res = await botReplyForWhatsApp({ ...base, text, fetchFn: f.fn });
    assertEquals(res.sent, false);
    assertEquals(f.calls.length, 0);
  }
});

Deno.test("sends nothing when the bot skips the sender (opt-out or rate limit)", async () => {
  const f = fakeFetch({ reply: null, skipped: "opted_out" });
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

Deno.test("reports a Twilio failure without throwing", async () => {
  const f = fakeFetch({ reply: "hi" }, 200, 400);
  const res = await botReplyForWhatsApp({ ...base, fetchFn: f.fn });
  assertEquals(res, { sent: false, reason: "twilio_failed" });
});

Deno.test("refuses to run when configuration is missing", async () => {
  const f = fakeFetch({ reply: "hi" });
  const res = await botReplyForWhatsApp({ ...base, botSecret: "", fetchFn: f.fn });
  assertEquals(res, { sent: false, reason: "not_configured" });
  assertEquals(f.calls.length, 0);
});

Deno.test("trims very long replies to the WhatsApp limit", () => {
  const long = "a".repeat(WA_MAX_CHARS + 50);
  const t = trimForWhatsApp(long);
  assert(t.length <= WA_MAX_CHARS);
  assert(t.endsWith("…"));
  assertEquals(trimForWhatsApp("short"), "short");
});
