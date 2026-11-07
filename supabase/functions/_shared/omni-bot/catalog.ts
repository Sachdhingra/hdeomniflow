// Catalogue access for the omni-channel sales bot (Instagram, WhatsApp, other inboxes).
// The source of truth is the Godrej Interio range that the Home Decor Enterprises website
// publishes (hdefurniture.netlify.app, generated from interio.com). The bot reads the same
// catalogue.js the website reads, so its prices and product names always match the site.
//
// Pure functions only (no Deno APIs) so they can be unit tested. Fetching is in fetchCatalog.

export type Option = { id: string; name: string; price: number };
export type Product = {
  id: string; name: string; room: string; type: string; family: string; from: number;
  note?: string; image?: string; options?: Option[]; variants?: number;
};

export type Catalog = { items: Product[]; byId: Map<string, Product> };

/** Parses the `products: [...]` array out of the website's catalog.js file. */
export function parseCatalogJs(source: string): Product[] {
  const key = source.indexOf("products:");
  const start = key < 0 ? -1 : source.indexOf("[", key);
  if (start < 0) throw new Error("catalog.js has no products array");
  const items = JSON.parse(sliceJsonArray(source, start));
  if (!Array.isArray(items)) throw new Error("catalog.js products is not an array");
  return items as Product[];
}

/** Returns the JSON array starting at `start`, matching brackets and skipping string contents. */
function sliceJsonArray(source: string, start: number): string {
  let depth = 0, inStr = false;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error("catalog.js products array is not closed");
}

export function buildCatalog(items: Product[]): Catalog {
  const byId = new Map<string, Product>();
  for (const p of items) {
    byId.set(p.id, p);
    for (const o of p.options ?? []) if (!byId.has(o.id)) byId.set(o.id, p);
  }
  return { items, byId };
}

// Hindi / Hinglish words customers type, mapped to catalogue words.
export const SYNONYMS: Record<string, string> = {
  palang: "bed", palng: "bed", gadda: "mattress", gadde: "mattress", almari: "almirah", almaari: "almirah",
  almira: "almirah", kursi: "chair", mez: "table", mej: "table", rasoi: "kitchen", tijori: "locker",
  safe: "locker", couch: "sofa", settee: "sofa", cupboard: "wardrobe", diwan: "sofa", dewan: "sofa",
  study: "study", computer: "computer", bookshelf: "display", showcase: "display", sheesham: "sheesham",
};

const STOP = new Set([
  "a", "an", "the", "for", "with", "and", "of", "in", "to", "me", "my", "show", "want", "need", "some",
  "chahiye", "ke", "ka", "ki", "liye", "wala", "wali", "under", "below", "best", "good", "acha", "achha",
]);

export function queryWords(q: string): string[] {
  return q.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => SYNONYMS[w] ?? w.replace(/(s|es)$/, (m) => (w.length > 4 ? "" : m)));
}

export type SearchInput = { query?: string; room?: string; min_price?: number; max_price?: number; limit?: number };

export type ProductCard = {
  id: string; name: string; mrp_from: number; room: string; type?: string; note?: string; sizes_or_variants: number;
};

export const productCard = (p: Product): ProductCard => ({
  id: p.id, name: p.name, mrp_from: p.from, room: p.room, type: p.type || undefined,
  note: p.note ? p.note.slice(0, 140) : undefined, sizes_or_variants: p.variants ?? (p.options?.length || 1),
});

/** Ranks catalogue items for a customer query. One card per product family, best matches first. */
export function searchCatalog(items: Product[], input: SearchInput) {
  const ws = queryWords(input.query ?? "");
  const limit = Math.min(Math.max(input.limit ?? 6, 1), 10);
  const scored = items.map((p) => {
    if (input.room && p.room !== input.room) return null;
    if (input.max_price && p.from > input.max_price) return null;
    if (input.min_price && p.from < input.min_price) return null;
    if (!ws.length) return { p, s: 1 };
    const name = p.name.toLowerCase();
    const hay = [p.family, p.type, p.note, p.room, ...(p.options ?? []).map((o) => o.name)].join(" ").toLowerCase();
    let s = 0, matched = 0;
    for (const w of ws) {
      if (name.includes(w)) { s += 3; matched++; } else if (hay.includes(w)) { s += 1; matched++; }
    }
    return matched >= Math.ceil(ws.length / 2) ? { p, s: s + matched * 2 } : null;
  }).filter((x): x is { p: Product; s: number } => x !== null);
  scored.sort((a, b) => b.s - a.s || a.p.from - b.p.from);

  const seen = new Set<string>();
  const products: ProductCard[] = [];
  for (const h of scored) {
    const fam = (h.p.family || h.p.name).toLowerCase();
    if (seen.has(fam)) continue;
    seen.add(fam);
    products.push(productCard(h.p));
    if (products.length >= limit) break;
  }
  return {
    total_matches: scored.length,
    products,
    note: products.length ? undefined : "Nothing matched. Try a simpler word (sofa, bed, almirah) or drop the price limit.",
  };
}

/** Details shape the bot can quote. `raw` is the per-product JSON the website publishes. */
export function productDetailsView(p: Product, requestedId: string, raw: Record<string, unknown>, site: string) {
  const feats = Array.isArray(raw.features) ? raw.features as { title?: string; text?: string }[] : [];
  const specs = Array.isArray(raw.specs) ? raw.specs as string[][] : [];
  return {
    ...productCard(p),
    page: `${site}/product.html?id=${p.id}`,
    requested_option: requestedId !== p.id ? requestedId : undefined,
    intro: typeof raw.intro === "string" ? raw.intro.slice(0, 500) : undefined,
    features: feats.slice(0, 8).map((f) => `${f.title ?? ""}: ${(f.text ?? "").slice(0, 180)}`),
    specifications: specs.slice(0, 18).map((s) => s.join(": ")),
    options: (p.options ?? []).slice(0, 12).map((o) => ({ id: o.id, name: o.name, mrp: o.price })),
  };
}

/** Fetches catalog.js from the website. Throws on HTTP or parse failure. */
export async function fetchCatalog(site: string, fetchFn: typeof fetch = fetch): Promise<Catalog> {
  const r = await fetchFn(site + "/assets/js/catalog.js");
  if (!r.ok) throw new Error(`catalog.js ${r.status}`);
  return buildCatalog(parseCatalogJs(await r.text()));
}
