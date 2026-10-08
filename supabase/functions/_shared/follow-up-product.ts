const CATEGORY_FOLLOW_UP: Record<string, string> = {
  sofa: "a comfortable sofa suited to your living room",
  coffee_table: "a practical coffee table for your living room",
  almirah: "a wardrobe with useful organised storage",
  dining: "a dining set suited to your family and space",
  mattress: "a supportive mattress for comfortable sleep",
  bed: "a durable bed with practical storage options",
  kitchen: "a modular kitchen planned around your space",
  chair: "a comfortable chair suited to your use",
  office_table: "a practical office table for a productive workspace",
  kiosk: "furniture suited to your home and space",
  others: "furniture suited to your home and space",
};

function clean(value?: string | null): string {
  const text = (value || "").replace(/\s+/g, " ").trim();
  if (!text || text.toLowerCase() === "null" || text.length < 2) return "";
  return text;
}

/** A concise, customer-safe product phrase for the approved {{2}} variable. */
export function followUpProduct(lead: {
  product_viewed?: string | null;
  liked_product?: string | null;
  stated_need?: string | null;
  category?: string | null;
}): string {
  const named = clean(lead.liked_product) || clean(lead.product_viewed) || clean(lead.stated_need);
  const fallback = CATEGORY_FOLLOW_UP[(lead.category || "").toLowerCase()]
    || "furniture suited to your home and space";
  const phrase = named || fallback;
  return phrase.length > 80 ? `${phrase.slice(0, 77).trim()}...` : phrase;
}