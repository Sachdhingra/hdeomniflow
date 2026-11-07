// Channel-neutral answer engine for the omni-channel sales bot.
// The caller supplies the conversation history, the catalogue and the side effects (lead sink,
// product detail fetch, Anthropic fetch), so this module has no Deno or network dependency
// and can be tested directly.

import type { Catalog, SearchInput } from "./catalog.ts";
import { productDetailsView, searchCatalog } from "./catalog.ts";
import { channelStyle, systemPrompt } from "./prompt.ts";

export type Turn = { role: "user" | "assistant"; content: string };

export type Lead = {
  name: string; phone: string; interest: string; summary: string; product: string; channel: string; best_time?: string; area?: string;
};

export type Deps = {
  catalog: () => Promise<Catalog>;
  fetchProductRaw: (id: string) => Promise<Record<string, unknown>>;
  sendLead: (lead: Lead) => Promise<boolean>;
  /** Calls the Anthropic Messages API and returns the parsed JSON body. Throws on HTTP error. */
  callModel: (body: unknown) => Promise<{ content: any[]; stop_reason: string }>;
  site: string;
  model: string;
};

export type AnswerResult = { reply: string; enquirySent: boolean; toolCalls: string[] };

export const TOOLS = [
  {
    name: "search_products",
    description: "Search the Godrej Interio catalogue on HDE's website. Always search before naming any product. Returns MRP starting prices in rupees.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Short product words in English, e.g. 'l shape sofa fabric', 'queen bed hydraulic', '3 door almirah'." },
        room: { type: "string", enum: ["living", "bedroom", "dining", "kitchen", "office", "storage"] },
        min_price: { type: "number" },
        max_price: { type: "number", description: "Upper MRP limit in rupees." },
        limit: { type: "number", description: "1-10, default 6." },
      },
    },
  },
  {
    name: "get_product_details",
    description: "Full details of one product: intro, features, specifications and size/colour options with MRP and the product page link.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "send_enquiry",
    description: "Pass the customer's enquiry to their HDE consultant, who will contact them with today's best price. Only after the customer gave their name and 10-digit mobile number and said yes.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string", description: "10-digit Indian mobile number." },
        interest: { type: "string" },
        product_ids: { type: "array", items: { type: "string" } },
        area: { type: "string" },
        best_time: { type: "string" },
        summary: { type: "string", description: "2-4 line brief for the salesperson: needs, room size, budget, colours, timeline, open questions." },
      },
      required: ["name", "phone", "interest", "summary"],
    },
  },
];

export function validIndianMobile(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "").slice(-10);
  return /^[6-9]\d{9}$/.test(digits) ? digits : "";
}

type State = { enquirySent: boolean; toolCalls: string[] };

async function runTool(name: string, input: Record<string, any>, channel: string, deps: Deps, state: State): Promise<unknown> {
  state.toolCalls.push(name);
  switch (name) {
    case "search_products":
      return searchCatalog((await deps.catalog()).items, input as SearchInput);
    case "get_product_details": {
      const want = String(input.id ?? "").toLowerCase();
      const cat = await deps.catalog();
      const p = cat.byId.get(want);
      if (!p) return { error: "No product with that id. Use search_products first." };
      const raw = await deps.fetchProductRaw(p.id).catch(() => ({}));
      return productDetailsView(p, want, raw, deps.site);
    }
    case "send_enquiry": {
      if (state.enquirySent) return { sent: false, error: "An enquiry was already sent in this chat. Tell the customer their consultant has it." };
      const phone = validIndianMobile(input.phone);
      if (!phone) return { sent: false, error: "That is not a valid 10-digit mobile number. Ask the customer to check it." };
      const cat = await deps.catalog();
      const names = (input.product_ids ?? []).map((id: string) => cat.byId.get(String(id).toLowerCase())).filter(Boolean)
        .map((p: any) => `${p.name} (MRP from ₹${p.from}) ${deps.site}/product.html?id=${p.id}`);
      const lead: Lead = {
        name: String(input.name ?? "").slice(0, 80),
        phone: "+91" + phone,
        interest: String(input.interest ?? "").slice(0, 120),
        summary: String(input.summary ?? "").slice(0, 800),
        product: names.join(" | ").slice(0, 500),
        channel,
        best_time: input.best_time ? String(input.best_time).slice(0, 80) : undefined,
        area: input.area ? String(input.area).slice(0, 80) : undefined,
      };
      const ok = await deps.sendLead(lead).catch(() => false);
      if (ok) state.enquirySent = true;
      return ok
        ? { sent: true }
        : { sent: false, error: "Could not send right now. Ask the customer to call +91 99172 33664 or WhatsApp it." };
    }
  }
  return { error: "Unknown tool" };
}

/**
 * Runs one customer turn. `history` must end with the customer's latest message.
 * Throws if the model call fails; callers should answer with a fallback in that case.
 */
export async function answerCustomer(
  channel: string,
  history: Turn[],
  deps: Deps,
  opts: { enquirySent?: boolean; now?: Date } = {},
): Promise<AnswerResult> {
  if (!history.length || history[history.length - 1].role !== "user") throw new Error("history must end with a user turn");
  const state: State = { enquirySent: !!opts.enquirySent, toolCalls: [] };
  const now = (opts.now ?? new Date()).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", weekday: "long", hour: "numeric", minute: "2-digit", day: "numeric", month: "short",
  });
  const system = [
    { type: "text", text: systemPrompt(channel, deps.site), cache_control: { type: "ephemeral" } },
    {
      type: "text",
      text: [
        `Now in Dehradun: ${now}.`,
        `Channel: ${channelStyle(channel).label}.`,
        state.enquirySent ? "An enquiry has ALREADY been sent in this chat; do not send another." : "No enquiry sent yet in this chat.",
      ].join("\n"),
    },
  ];
  const messages: any[] = history.map((t) => ({ role: t.role, content: t.content }));
  let reply = "";

  for (let turn = 0; turn < 7; turn++) {
    const res = await deps.callModel({ model: deps.model, max_tokens: 800, system, tools: TOOLS, messages });
    const text = res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
    if (text) reply = text;
    if (res.stop_reason !== "tool_use") break;
    messages.push({ role: "assistant", content: res.content });
    const results = [];
    for (const b of res.content.filter((b: any) => b.type === "tool_use")) {
      let out: unknown;
      try { out = await runTool(b.name, b.input ?? {}, channel, deps, state); } catch (e) { out = { error: String(e) }; }
      results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out) });
    }
    messages.push({ role: "user", content: results });
  }

  return {
    reply: reply || "Ji, bataiye main aapki kaise madad kar sakti hoon?",
    enquirySent: state.enquirySent,
    toolCalls: state.toolCalls,
  };
}
