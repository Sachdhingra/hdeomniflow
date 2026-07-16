import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Star, Check, X, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/dateFormat";
import { ELITE_TIERS, EliteTier, TIER_META, checkTierEligibility, tierOptionDisabled } from "@/lib/eliteTiers";

export type EliteChoice = "opt_in" | "opt_out" | "undecided";

interface Props {
  choice: EliteChoice;
  onChoiceChange: (c: EliteChoice) => void;
  issueDate: string;
  onIssueDateChange: (d: string) => void;
  tier?: EliteTier;
  onTierChange?: (t: EliteTier) => void;
  purchaseValue?: number;
  duplicateWarning?: string | null;
  /** Tier already chosen once — changes need admin approval */
  tierLocked?: boolean;
}

function addYears(iso: string, years: number): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

const EliteCardEnrollment = ({
  choice, onChoiceChange, issueDate, onIssueDateChange,
  tier = "silver", onTierChange, purchaseValue, duplicateWarning, tierLocked,
}: Props) => {
  const expiry = addYears(issueDate, 3);
  const eligibilityMsg = choice === "opt_in" ? checkTierEligibility(tier, { purchaseValue }) : null;
  const tierMeta = TIER_META[tier];

  const options: { value: EliteChoice; label: string; icon: JSX.Element; activeCls: string }[] = [
    { value: "opt_in", label: "Opt In", icon: <Check className="w-4 h-4" />, activeCls: "border-success bg-success/10 text-success" },
    { value: "opt_out", label: "Opt Out", icon: <X className="w-4 h-4" />, activeCls: "border-destructive bg-destructive/10 text-destructive" },
    { value: "undecided", label: "Not Decided", icon: <Circle className="w-4 h-4" />, activeCls: "border-muted-foreground bg-muted text-foreground" },
  ];

  return (
    <div className="rounded-lg border border-amber-400/40 bg-amber-50/40 dark:bg-amber-950/10 p-4 space-y-3">
      <div>
        <p className="font-semibold flex items-center gap-2 text-amber-700 dark:text-amber-400">
          <Star className="w-4 h-4 fill-current" /> Elite Card Enrollment
        </p>
        <p className="text-xs text-muted-foreground">Enroll this customer in the Elite loyalty program</p>
      </div>

      {duplicateWarning && (
        <div className="rounded-md border border-amber-500/40 bg-amber-100/60 dark:bg-amber-900/20 p-2 text-xs text-amber-800 dark:text-amber-300">
          {duplicateWarning}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {options.map(o => {
          const active = choice === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChoiceChange(o.value)}
              className={cn(
                "border-2 rounded-md p-2 text-xs font-medium flex flex-col items-center gap-1 transition-colors",
                active ? o.activeCls : "border-border bg-background text-muted-foreground hover:bg-muted/50",
              )}
            >
              {o.icon}
              {o.label}
            </button>
          );
        })}
      </div>

      {choice === "opt_in" && (
        <div className="space-y-3">
          {onTierChange && (
            <div className="space-y-1.5">
              <Label className="text-xs">Card Tier</Label>
              <div className="grid grid-cols-2 gap-2">
                {ELITE_TIERS.map(t => {
                  const active = tier === t.value;
                  const disabled = (tierLocked && !active) || (!active && tierOptionDisabled(t.value, purchaseValue));
                  return (
                    <button
                      key={t.value}
                      type="button"
                      disabled={disabled}
                      onClick={() => !disabled && onTierChange(t.value)}
                      className={cn(
                        "border-2 rounded-md p-2 text-xs font-medium flex flex-col items-start gap-0.5 transition-colors text-left",
                        active ? t.activeCls : "border-border bg-background text-muted-foreground hover:bg-muted/50",
                        disabled && "opacity-40 cursor-not-allowed hover:bg-background",
                      )}
                    >
                      <span>{t.label}</span>
                      <span className="text-[10px] opacity-80">{t.description}</span>
                    </button>
                  );
                })}
              </div>
              {tierLocked && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  Card tier is locked after first selection — contact an admin to change it.
                </p>
              )}
              {tierMeta.fee > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Collect ₹{tierMeta.fee.toLocaleString("en-IN")} joining fee for {tierMeta.label}.
                </p>
              )}
              {eligibilityMsg && (
                <p className="text-[11px] text-destructive">{eligibilityMsg}</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Card Issue Date</Label>
            <Input type="date" value={issueDate} onChange={e => onIssueDateChange(e.target.value)} />
          </div>
          {expiry && (
            <p className="text-xs text-success font-medium">Valid until: {formatDate(expiry)}</p>
          )}
          <p className="text-[11px] text-muted-foreground">Elite card is valid for 3 years from issue date</p>
        </div>
      )}
      {choice === "opt_out" && <p className="text-xs text-muted-foreground">Customer has declined the Elite program</p>}
      {choice === "undecided" && <p className="text-xs text-muted-foreground">You can update this later</p>}
    </div>
  );
};

export default EliteCardEnrollment;
