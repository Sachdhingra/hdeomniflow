import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCatalog, parseCatalogJs, searchCatalog, productDetailsView, queryWords } from "./catalog.ts";
import type { Product } from "./catalog.ts";
import { answerCustomer, validIndianMobile } from "./core.ts";
import type { Deps, Lead } from "./core.ts";
import { extractDms, verifySignature } from "./instagram.ts";

const SITE = "https://site.test";
const PRODUCTS: Product[] = [
  { id: "sofa-l1", name: "L Shape Sofa Fabric", room: "living", type: "sofa", family: "l-shape-sofa", from: 49407, options: [{ id: "sofa-l1-a", name: "3+2 Seater", price: 49407 }] },
  { id: "bed-q1", name: "Queen Bed Hydraulic", room: "bedroom", type: "bed", family: "queen-bed", from: 38000 },
  { id: "bed-q2", name: "Queen Bed Storage", room: "bedroom", type: "bed", family: "queen-bed", from: 42000 },
  { id: "alm-3", name: "3 Door Almirah", room: "storage", type: "almirah", family: "almirah-3", from: 25000 },
];

Deno.test("parses the products array out of catalog.js", () => {
  const js = `window.CATALOG = { version: 2, products: ${JSON.stringify(PRODUCTS)}, rooms: [] };`;
  assertEquals(parseCatalogJs(js).length, 4);
});

Deno.test("catalogue lookup finds option ids as well as product ids", () => {
  const cat = buildCatalog(PRODUCTS);
  assertEquals(cat.byId.get("sofa-l1-a")?.id, "sofa-l1");
});

Deno.test("search matches Hinglish words and keeps one card per family", () => {
  assertEquals(queryWords("palang queen"), ["bed", "queen"]);
  const res = searchCatalog(PRODUCTS, { query: "palang queen" });
  // Both queen beds share a family, so only the cheaper one is shown.
  assertEquals(res.products.map((p) => p.id), ["bed-q1"]);
  assertEquals(res.total_matches, 2);
});

Deno.test("search honours room and price limits", () => {
  const res = searchCatalog(PRODUCTS, { room: "storage", max_price: 30000 });
  assertEquals(res.products.map((p) => p.id), ["alm-3"]);
  const none = searchCatalog(PRODUCTS, { query: "dining table" });
  assert(none.note !== undefined);
});

Deno.test("details view keeps the product page link and the requested option", () => {
  const cat = buildCatalog(PRODUCTS);
  const v = productDetailsView(cat.byId.get("sofa-l1-a")!, "sofa-l1-a", { intro: "Comfy", specs: [["Warranty", "5 years"]] }, SITE);
  assertEquals(v.page, `${SITE}/product.html?id=sofa-l1`);
  assertEquals(v.requested_option, "sofa-l1-a");
  assertEquals(v.specifications, ["Warranty: 5 years"]);
});

Deno.test("mobile validation accepts Indian mobiles and rejects the rest", () => {
  assertEquals(validIndianMobile("+91 98765 43210"), "9876543210");
  assertEquals(validIndianMobile("12345"), "");
  assertEquals(validIndianMobile("5876543210"), "");
});

function scripted(steps: any[]) {
  const calls: any[] = [];
  return {
    calls,
    callModel: async (body: any) => {
      calls.push(body);
      const next = steps.shift();
      if (!next) throw new Error("no scripted step left");
      return next;
    },
  };
}

function deps(callModel: Deps["callModel"], leads: Lead[], sendOk = true): Deps {
  const cat = buildCatalog(PRODUCTS);
  return {
    catalog: async () => cat,
    fetchProductRaw: async () => ({}),
    sendLead: async (l) => { leads.push(l); return sendOk; },
    callModel,
    site: SITE,
    model: "test-model",
  };
}

Deno.test("answers a product question through the search tool", async () => {
  const s = scripted([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "search_products", input: { query: "queen bed" } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Queen Bed Hydraulic MRP from ₹38,000." }] },
  ]);
  const res = await answerCustomer("instagram", [{ role: "user", content: "queen bed?" }], deps(s.callModel, []));
  assertEquals(res.reply, "Queen Bed Hydraulic MRP from ₹38,000.");
  assertEquals(res.toolCalls, ["search_products"]);
  // The tool result is fed back to the model.
  const toolResult = s.calls[1].messages.at(-1).content[0];
  assertEquals(toolResult.tool_use_id, "t1");
  assert(toolResult.content.includes("bed-q1"));
});

Deno.test("sends the enquiry once and refuses a second one", async () => {
  const leads: Lead[] = [];
  const enquiry = { name: "Ravi", phone: "98765 43210", interest: "Sofa", summary: "3 seater for living room" };
  const s = scripted([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "a", name: "send_enquiry", input: enquiry }] },
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "b", name: "send_enquiry", input: enquiry }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Consultant will contact you." }] },
  ]);
  const res = await answerCustomer("instagram", [{ role: "user", content: "yes send" }], deps(s.callModel, leads));
  assertEquals(leads.length, 1);
  assertEquals(leads[0].phone, "+919876543210");
  assertEquals(leads[0].channel, "instagram");
  assertEquals(res.enquirySent, true);
  const second = s.calls[2].messages.at(-1).content[0];
  assert(second.content.includes("already sent"));
});

Deno.test("does not send an enquiry with an invalid phone number", async () => {
  const leads: Lead[] = [];
  const s = scripted([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "a", name: "send_enquiry", input: { name: "R", phone: "123", interest: "x", summary: "y" } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Please check the number." }] },
  ]);
  const res = await answerCustomer("whatsapp", [{ role: "user", content: "call me 123" }], deps(s.callModel, leads));
  assertEquals(leads.length, 0);
  assertEquals(res.enquirySent, false);
});

Deno.test("falls back to a polite prompt when the model returns no text", async () => {
  const s = scripted([{ stop_reason: "end_turn", content: [] }]);
  const res = await answerCustomer("instagram", [{ role: "user", content: "hi" }], deps(s.callModel, []));
  assert(res.reply.length > 0);
});

Deno.test("rejects history that does not end with the customer", async () => {
  const s = scripted([]);
  let threw = false;
  try { await answerCustomer("instagram", [{ role: "assistant", content: "hi" }], deps(s.callModel, [])); } catch { threw = true; }
  assert(threw);
});

Deno.test("extracts text DMs and skips echoes, attachments and the page's own messages", () => {
  const payload = {
    object: "instagram",
    entry: [{
      id: "PAGE1",
      messaging: [
        { sender: { id: "U1" }, message: { mid: "m1", text: " hello " } },
        { sender: { id: "PAGE1" }, message: { mid: "m2", text: "our reply", is_echo: true } },
        { sender: { id: "U2" }, message: { mid: "m3", attachments: [{ type: "image" }] } },
        { sender: { id: "U3" }, message: { mid: "m4", text: "price?" } },
      ],
    }],
  };
  assertEquals(extractDms(payload), [{ senderId: "U1", text: "hello" }, { senderId: "U3", text: "price?" }]);
  assertEquals(extractDms({ object: "page", entry: [] }), []);
});

Deno.test("verifies Meta's HMAC signature and rejects tampering", async () => {
  const secret = "app-secret";
  const body = '{"object":"instagram"}';
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const hex = Array.from(mac).map((b) => b.toString(16).padStart(2, "0")).join("");
  assert(await verifySignature(body, "sha256=" + hex, secret));
  assertEquals(await verifySignature(body + " ", "sha256=" + hex, secret), false);
  assertEquals(await verifySignature(body, "sha256=" + hex, ""), false);
  assertEquals(await verifySignature(body, null, secret), false);
});
