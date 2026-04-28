// Helpers for the WhatsApp message template system.
import type { Lead } from "@/contexts/DataContext";
import { LEAD_CATEGORIES } from "@/contexts/DataContext";
import { DEHRADUN_NEIGHBORHOODS, BUDGET_RANGES, FAMILY_SITUATIONS, STATED_NEEDS } from "@/lib/leadConstants";

export type JourneyStage = "problem" | "exploration" | "evaluation" | "reassurance" | "decision";

export const STAGE_META: { value: JourneyStage; label: string; days: string; color: string }[] = [
  { value: "problem",     label: "Problem",     days: "Day -30 to 0",  color: "bg-destructive/10 text-destructive border-destructive/20" },
  { value: "exploration", label: "Exploration", days: "Day 0–7",       color: "bg-warning/10 text-warning border-warning/20" },
  { value: "evaluation",  label: "Evaluation",  days: "Day 7–14",      color: "bg-accent/15 text-accent-foreground border-accent/20" },
  { value: "reassurance", label: "Reassurance", days: "Day 14–21",     color: "bg-primary/10 text-primary border-primary/20" },
  { value: "decision",    label: "Decision",    days: "Day 21+",       color: "bg-success/10 text-success border-success/20" },
];

// Map lead status -> suggested journey stage
export const statusToStage = (status: string | undefined | null): JourneyStage => {
  switch (status) {
    case "new": return "problem";
    case "contacted": return "exploration";
    case "follow_up": return "evaluation";
    case "negotiation": return "reassurance";
    case "won":
    case "converted": return "decision";
    default: return "exploration";
  }
};

// Extract {{variable}} names from a template body
export const extractVariables = (body: string): string[] => {
  const re = /{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) found.add(m[1]);
  return Array.from(found);
};

// Substitute variables in a template body with provided values
export const fillTemplate = (body: string, values: Record<string, string>): string => {
  return body.replace(/{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g, (_, name) => {
    const v = values[name];
    return v && v.trim() ? v : `{{${name}}}`;
  });
};

// Auto-fill what we can from the lead. Returns a map of variable → value (only filled ones).
export const autoFillFromLead = (lead: Lead): Record<string, string> => {
  const l: any = lead;
  const out: Record<string, string> = {};
  if (lead.customer_name) out.name = lead.customer_name;
  if (lead.customer_phone) out.phone = lead.customer_phone;
  if (l.neighborhood) out.neighborhood = l.neighborhood;

  const productLabel = l.product_viewed || l.liked_product
    || LEAD_CATEGORIES.find(c => c.value === lead.category)?.label
    || "";
  if (productLabel) out.product = productLabel;

  const needLabel = STATED_NEEDS.find(s => s.value === l.stated_need)?.label || l.stated_need;
  if (needLabel) out.stated_need = needLabel;

  const budgetLabel = BUDGET_RANGES.find(b => b.value === l.budget_range)?.label || l.budget_range;
  if (budgetLabel) out.budget_range = budgetLabel;

  const familyLabel = FAMILY_SITUATIONS.find(f => f.value === l.family_situation)?.label;
  if (familyLabel) out.family_type = familyLabel;

  // Room/space inference from category
  const cat = lead.category as string;
  const spaceMap: Record<string, string> = {
    sofa: "living room", coffee_table: "living room", chair: "living room",
    almirah: "bedroom", bed: "bedroom", mattress: "bedroom",
    dining: "dining area", kitchen: "kitchen", office_table: "office",
  };
  if (spaceMap[cat]) out.space = spaceMap[cat];

  return out;
};

// Friendly labels for known variables (used in the fill-in form)
export const VARIABLE_LABELS: Record<string, string> = {
  name: "Customer name",
  phone: "Phone",
  neighborhood: "Neighborhood",
  product: "Product",
  product1: "Product A",
  product2: "Product B",
  stated_need: "Stated need",
  budget_range: "Budget range",
  space_size: "Space size (e.g. 12x14 ft)",
  spouse_name: "Spouse / decision-maker name",
  family_type: "Family type (e.g. couple + 2 kids)",
  benefit1: "Benefit A",
  benefit2: "Benefit B",
  price1: "Price A (₹)",
  price2: "Price B (₹)",
  difference: "Price difference (₹)",
  amount: "Advance amount (₹)",
  date: "Delivery date",
  space: "Room (e.g. living room)",
  local_reason: "Why popular locally",
};

export const variableLabel = (key: string) => VARIABLE_LABELS[key] || key.replace(/_/g, " ");

export const NEIGHBORHOOD_OPTIONS = DEHRADUN_NEIGHBORHOODS;
