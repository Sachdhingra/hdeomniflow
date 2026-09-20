// Approved / submitted Twilio WhatsApp template (Content) SIDs used by the app.
// Business-initiated WhatsApp messages must use an approved template unless the
// customer replied within the last 24 hours.

export const WA_TEMPLATES = {
  /** hde_followup_reengage — {{1}} customer first name, {{2}} what they wanted */
  followUpReengage: "HX45ff618cc3947d77a96aa8aeb2741c9e",
  /** hde_lead_welcome — {{1}} customer first name */
  leadWelcome: "HXa50d2f1a512771a524583a6432c860f4",
  /** hde_followup_yes_no_v1 — Meta approved 2026-09-20 */
  followUpYesNo: "HX59e08fd435765137618001db1cb3c91e",
} as const;

export const FOLLOW_UP_PREVIEW =
  "Hi {{1}}! This is Home Decor Enterprises, authorised Godrej Interio showroom in Dehradun.\n\n" +
  "You had shown interest in {{2}} during your recent enquiry with us. We now have fresh stock, " +
  "new designs and special seasonal pricing available on it.\n\n" +
  "Would you like us to share the latest price and options? Simply reply to this message and our " +
  "team will assist you right away.";

export const YES_NO_FOLLOW_UP_PREVIEW =
  "Hi {{1}}! Are you still interested in {{2}}?\n\n" +
  "Please reply YES and we’ll have your salesperson assist you, or reply NO and tell us if it is because of price, timing, or the product.";

const CATEGORY_LABEL: Record<string, string> = {
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

/** Best guess at what the customer actually wants, for {{2}} in the template. */
export function inferInterest(lead: {
  product_viewed?: string | null;
  liked_product?: string | null;
  stated_need?: string | null;
  category?: string | null;
  notes?: string | null;
}): string {
  const raw =
    clean(lead.liked_product) ||
    clean(lead.product_viewed) ||
    CATEGORY_LABEL[(lead.category || "").toLowerCase()] ||
    "furniture suited to your home and space";
  return raw.length > 80 ? raw.slice(0, 77).trim() + "..." : raw;
}

function clean(v?: string | null): string {
  const s = (v || "").trim();
  if (!s || s.toLowerCase() === "null" || s.length < 2) return "";
  return s;
}

export function firstName(name?: string | null): string {
  const s = (name || "").trim().replace(/\s+(s i f|old data)\b.*$/i, "");
  const part = s.split(/\s+/)[0] || "";
  if (!part) return "there";
  return part.charAt(0).toUpperCase() + part.slice(1);
}
