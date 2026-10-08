import { plDb } from "@/lib/productLibrary";
import { codeCandidates } from "@/lib/websiteCatalog";

/**
 * Inventory photo (Inventory Manager > product photo) for a quote line, matched on the
 * inventory SKU or Interio line code. Second choice after the website photo.
 */
export async function lookupInventoryPhoto(codes: (string | null | undefined)[]): Promise<string | null> {
  const raw = codes.map((c) => (c || "").trim()).filter(Boolean);
  // Exact codes as typed, plus the Interio code inside a prefixed SKU, in both cases.
  const values = [...new Set(raw.flatMap((c) => [c, ...codeCandidates(c), ...codeCandidates(c).map((x) => x.toUpperCase())]))];
  if (!values.length) return null;
  try {
    const [bySku, byLine] = await Promise.all([
      plDb.from("products").select("id").in("sku", values).is("deleted_at", null).limit(10),
      plDb.from("products").select("id").in("line_code", values).is("deleted_at", null).limit(10),
    ]);
    const ids = [...(bySku.data || []), ...(byLine.data || [])].map((p: { id: string }) => p.id);
    if (!ids.length) return null;
    const { data } = await plDb
      .from("hde_product_photos")
      .select("product_id, photo_url")
      .in("product_id", ids)
      .limit(1);
    return data?.[0]?.photo_url || null;
  } catch (e) {
    console.warn("[inventoryPhotos] lookup failed", e);
    return null;
  }
}
