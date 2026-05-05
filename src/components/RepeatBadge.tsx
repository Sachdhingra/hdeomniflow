import { Badge } from "@/components/ui/badge";
import { Star } from "lucide-react";

/**
 * Repeat-customer badge.
 * repeatCount = number of *additional* purchases beyond the first.
 *  0 → New customer (no badge unless showNew=true)
 *  1 → ⭐  2nd purchase
 *  2 → ⭐⭐ 3rd purchase
 *  3+ → ⭐⭐⭐ 4th+ purchase
 */
export const RepeatBadge = ({
  repeatCount,
  showNew = false,
  totalSales,
  className = "",
}: {
  repeatCount: number;
  showNew?: boolean;
  totalSales?: number;
  className?: string;
}) => {
  if (!repeatCount || repeatCount <= 0) {
    if (!showNew) return null;
    return (
      <Badge variant="outline" className={`text-[10px] ${className}`}>
        New customer
      </Badge>
    );
  }
  const stars = Math.min(3, repeatCount);
  const ordinal = repeatCount + 1; // 2nd, 3rd, 4th...
  const suffix = ordinal === 2 ? "nd" : ordinal === 3 ? "rd" : "th";
  const tone =
    repeatCount >= 3
      ? "bg-success/15 text-success border-success/30"
      : repeatCount === 2
      ? "bg-primary/15 text-primary border-primary/30"
      : "bg-warning/15 text-warning border-warning/30";

  return (
    <Badge variant="outline" className={`gap-0.5 text-[10px] ${tone} ${className}`}>
      <span className="flex">
        {Array.from({ length: stars }).map((_, i) => (
          <Star key={i} className="w-2.5 h-2.5 fill-current" />
        ))}
      </span>
      {ordinal}
      {suffix}
      {typeof totalSales === "number" && totalSales > 0 && (
        <span className="ml-1 opacity-80">· ₹{(totalSales / 100000).toFixed(1)}L</span>
      )}
    </Badge>
  );
};

export default RepeatBadge;
