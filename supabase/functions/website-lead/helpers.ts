/** Website link codes look like "rahul-sharma" (see generate_website_ref_code). */
export function cleanRefCode(raw: unknown): string {
  const code = String(raw ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(code) ? code : "";
}

type Category =
  | "sofa" | "coffee_table" | "almirah" | "dining" | "mattress"
  | "bed" | "kitchen" | "chair" | "office_table" | "others";

const KEYWORDS: [RegExp, Category][] = [
  [/kitchen/i, "kitchen"],
  [/mattress/i, "mattress"],
  [/coffee table|centre table|center table/i, "coffee_table"],
  [/dining/i, "dining"],
  [/sofa|recliner|living room/i, "sofa"],
  [/\bbed|bedroom/i, "bed"],
  [/almirah|wardrobe|storage|cupboard/i, "almirah"],
  [/office table|study table|desk|home office/i, "office_table"],
  [/chair/i, "chair"],
];

/** Map the website's "Looking for" choice and product name to a lead category. */
export function categoryFromEnquiry(interest: string, product: string): Category {
  for (const source of [product, interest]) {
    if (!source) continue;
    for (const [re, cat] of KEYWORDS) if (re.test(source)) return cat;
  }
  return "others";
}
