export type EliteTier = "silver" | "elite" | "super_elite" | "prestige_elite";

export interface TierMeta {
  value: EliteTier;
  label: string;
  fee: number;
  cls: string;
  activeCls: string;
  description: string;
}

export const ELITE_TIERS: TierMeta[] = [
  {
    value: "silver",
    label: "Silver",
    fee: 0,
    cls: "text-slate-600",
    activeCls: "border-slate-500 bg-slate-100 text-slate-800 dark:bg-slate-900/40 dark:text-slate-200",
    description: "Complimentary tier",
  },
  {
    value: "elite",
    label: "Elite",
    fee: 1200,
    cls: "text-amber-700",
    activeCls: "border-amber-500 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    description: "₹1,200 joining fee",
  },
  {
    value: "super_elite",
    label: "Super Elite",
    fee: 2100,
    cls: "text-orange-700",
    activeCls: "border-orange-500 bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
    description: "₹2,100 joining fee",
  },
  {
    value: "prestige_elite",
    label: "Prestige Elite",
    fee: 4100,
    cls: "text-purple-700",
    activeCls: "border-purple-500 bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200",
    description: "₹4,100 joining fee",
  },
];

export const TIER_META: Record<EliteTier, TierMeta> = Object.fromEntries(
  ELITE_TIERS.map((t) => [t.value, t]),
) as Record<EliteTier, TierMeta>;

export function tierLabel(tier?: string | null): string {
  if (!tier) return "Silver";
  return TIER_META[tier as EliteTier]?.label ?? tier;
}

export function tierFee(tier?: string | null): number {
  if (!tier) return 0;
  return TIER_META[tier as EliteTier]?.fee ?? 0;
}

/**
 * Basic eligibility check: paid tiers require the customer's purchase value
 * (or lifetime points equivalent) to meet the joining fee.
 * Returns null when eligible, or a reason string when not.
 */
export function checkTierEligibility(
  tier: EliteTier,
  ctx: { purchaseValue?: number; lifetimePoints?: number } = {},
): string | null {
  const meta = TIER_META[tier];
  if (!meta || meta.fee === 0) return null;
  const purchase = ctx.purchaseValue ?? 0;
  // Salesperson must confirm the joining fee is collected: purchase value ≥ fee.
  if (purchase > 0 && purchase < meta.fee) {
    return `Lead value (₹${purchase.toLocaleString("en-IN")}) is below the ${meta.label} joining fee (₹${meta.fee.toLocaleString("en-IN")}).`;
  }
  return null;
}
