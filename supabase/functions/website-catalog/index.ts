// Website product photos for the Product Library quote builder.
// Reads the catalogue the HDE website publishes (hdefurniture.netlify.app,
// generated from interio.com by hdewebsite/tools/scrape_interio.py) server-side,
// so Omniflow never runs the website's script and isn't blocked by CORS.
//   { action: "catalog" }      -> { updated, products: [{ id, sku, name, image, remoteImage, codes, names }] }
//   (codes / names: the product's size and colour options, which share its photo)
//   { action: "image", url }   -> { data: <base64>, type } for embedding in the Excel quote
// Only the website and interio.com hosts are fetched; signed-in staff only (verify_jwt).

const WEBSITE = "https://hdefurniture.netlify.app";
const CATALOG_URL = `${WEBSITE}/assets/js/catalog.js`;
const IMAGE_HOSTS = new Set(["hdefurniture.netlify.app", "interio.com", "www.interio.com"]);
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const CACHE_MS = 10 * 60 * 1000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

interface CatalogProduct {
  id: string;
  sku: string;
  name: string;
  image: string | null;
  remoteImage: string | null;
  codes: string[];
  names: string[];
}

let cached: { at: number; body: { updated: string | null; products: CatalogProduct[] } } | null = null;

function absolute(path: unknown): string | null {
  if (typeof path !== "string" || !path.trim()) return null;
  try {
    return new URL(path, `${WEBSITE}/`).toString();
  } catch {
    return null;
  }
}

const options = (p: Record<string, unknown>) =>
  (Array.isArray(p.options) ? p.options : []) as Record<string, unknown>[];

/** catalog.js is `window.HDE_CATALOG = { updated: "...", rooms: {...}, products: [ ...JSON... ] };` */
function parseCatalog(script: string) {
  const start = script.indexOf("products:");
  const open = script.indexOf("[", start);
  const close = script.lastIndexOf("]");
  if (start < 0 || open < 0 || close < open) throw new Error("Unexpected catalogue format");
  const raw = JSON.parse(script.slice(open, close + 1)) as Record<string, unknown>[];
  const updated = /updated:\s*"([^"]+)"/.exec(script)?.[1] ?? null;
  const products: CatalogProduct[] = raw
    .map((p) => ({
      id: String(p.id ?? ""),
      sku: String(p.sku ?? ""),
      name: String(p.name ?? ""),
      image: absolute(p.image),
      remoteImage: absolute(p.remoteImage),
      codes: options(p).map((o) => String(o.id ?? "")).filter(Boolean),
      names: options(p).map((o) => String(o.name ?? "")).filter(Boolean),
    }))
    .filter((p) => (p.id || p.sku) && (p.image || p.remoteImage));
  return { updated, products };
}

async function loadCatalog() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.body;
  const res = await fetch(CATALOG_URL);
  if (!res.ok) throw new Error(`Website catalogue returned ${res.status}`);
  const body = parseCatalog(await res.text());
  cached = { at: Date.now(), body };
  return body;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function loadImage(url: unknown) {
  if (typeof url !== "string") return json({ error: "url required" }, 400);
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return json({ error: "Invalid url" }, 400);
  }
  if (target.protocol !== "https:" || !IMAGE_HOSTS.has(target.hostname)) {
    return json({ error: "Host not allowed" }, 400);
  }
  const res = await fetch(target);
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.startsWith("image/")) return json({ error: "Image not available" }, 404);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) return json({ error: "Image too large" }, 413);
  return json({ data: toBase64(bytes), type });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    if (body?.action === "image") return await loadImage(body.url);
    return json(await loadCatalog());
  } catch (e) {
    console.error("[website-catalog]", e instanceof Error ? e.message : e);
    return json({ error: "Could not load the website catalogue" }, 502);
  }
});
