// Shared option lists for lead intelligence fields

export const DEHRADUN_NEIGHBORHOODS = [
  "Keshab Garden",
  "Shimla Bypass",
  "Rajpur Road",
  "Sahastradhara",
  "Clement Town",
  "GMS Road",
  "Ballupur",
  "Patel Nagar",
  "ISBT",
  "Race Course",
] as const;

export const PREFERRED_STYLES = [
  { value: "modern", label: "Modern" },
  { value: "traditional", label: "Traditional" },
  { value: "mix", label: "Mix" },
] as const;

export const FAMILY_SITUATIONS = [
  { value: "single", label: "Single" },
  { value: "couple", label: "Couple" },
  { value: "kids", label: "With Kids" },
  { value: "pets", label: "With Pets" },
  { value: "joint", label: "Joint Family" },
] as const;

export const DECISION_TIMELINES = [
  { value: "this_month", label: "This Month" },
  { value: "next_month", label: "Next Month" },
  { value: "exploring", label: "Just Exploring" },
] as const;

export const BUDGET_RANGES = [
  { value: "0-20k", label: "₹0 – 20K" },
  { value: "20-50k", label: "₹20 – 50K" },
  { value: "50-100k", label: "₹50K – 1L" },
  { value: "100k+", label: "₹1L+" },
] as const;

export const STATED_NEEDS = [
  { value: "new_home", label: "New Home" },
  { value: "renovation", label: "Renovation" },
  { value: "replacement", label: "Replacement" },
  { value: "upgrade", label: "Upgrade" },
  { value: "gift", label: "Gift" },
] as const;

export const OBJECTION_TYPES = [
  { value: "quality", label: "Quality" },
  { value: "budget", label: "Budget" },
  { value: "fit", label: "Fit/Size" },
  { value: "spouse", label: "Spouse Decision" },
  { value: "delivery", label: "Delivery Time" },
  { value: "other", label: "Other" },
] as const;

// Color hash for neighborhood badges
export const neighborhoodColor = (name?: string | null) => {
  if (!name) return "bg-muted text-muted-foreground";
  const palette = [
    "bg-primary/10 text-primary",
    "bg-accent/15 text-accent-foreground",
    "bg-success/10 text-success",
    "bg-warning/10 text-warning",
    "bg-destructive/10 text-destructive",
    "bg-secondary text-secondary-foreground",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
};

export const responseTimeColor = (mins?: number | null) => {
  if (mins == null) return "text-muted-foreground";
  if (mins < 30) return "text-success";
  if (mins <= 120) return "text-warning";
  return "text-destructive";
};

export const formatRelativeTime = (iso?: string | null) => {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};
