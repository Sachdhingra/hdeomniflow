import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Phone, Mail, Calendar, Package, History, Sparkles } from "lucide-react";
import type { Lead, LeadStatus } from "@/contexts/DataContext";
import { LEAD_CATEGORIES } from "@/contexts/DataContext";

interface StageHistoryRow {
  id: string;
  old_stage: string | null;
  new_stage: string;
  changed_at: string;
  reason: string | null;
}

const STAGE_LABEL: Record<string, string> = {
  new: "New", contacted: "Contacted", follow_up: "Follow Up",
  negotiation: "Negotiation", won: "Won", lost: "Lost",
  overdue: "Overdue", converted: "Converted",
};

interface Props {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const probabilityColor = (p: number) => {
  if (p >= 70) return "text-success";
  if (p >= 40) return "text-warning";
  return "text-destructive";
};

const LeadDetailsDrawer = ({ lead, open, onOpenChange }: Props) => {
  const [history, setHistory] = useState<StageHistoryRow[]>([]);
  const [probability, setProbability] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!lead || !open) return;
    setLoading(true);
    (async () => {
      const [{ data: hist }, { data: prob }] = await Promise.all([
        supabase.from("lead_stage_history")
          .select("id, old_stage, new_stage, changed_at, reason")
          .eq("lead_id", lead.id)
          .order("changed_at", { ascending: false }),
        supabase.rpc("calculate_conversion_probability", { _lead_id: lead.id }),
      ]);
      setHistory((hist as StageHistoryRow[]) || []);
      setProbability(typeof prob === "number" ? prob : (lead.conversion_probability ?? 30));
      setLoading(false);
    })();
  }, [lead, open]);

  if (!lead) return null;

  const products = Array.isArray(lead.products_viewed) ? (lead.products_viewed as string[]) : [];
  const daysInStage = Math.floor(
    (Date.now() - new Date(lead.stage_changed_at || lead.created_at).getTime()) / 86400000
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{lead.customer_name}</SheetTitle>
          <SheetDescription className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">{STAGE_LABEL[lead.status]}</Badge>
            <Badge variant="outline">{LEAD_CATEGORIES.find(c => c.value === lead.category)?.label}</Badge>
            <span className="text-xs">{daysInStage}d in stage</span>
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium flex items-center gap-1.5">
                <Sparkles className="w-4 h-4" />Conversion Probability
              </span>
              <span className={`text-lg font-bold ${probabilityColor(probability)}`}>{probability}%</span>
            </div>
            <Progress value={probability} className="h-2" />
            <p className="text-xs text-muted-foreground">
              {probability >= 70 ? "🔥 Hot — focus on closing" :
                probability >= 40 ? "🟡 Warm — keep nurturing" :
                "🔵 Cold — re-engage or archive"}
            </p>
          </section>

          <Separator />

          <section className="space-y-2 text-sm">
            <h4 className="font-semibold">Customer</h4>
            <p className="flex items-center gap-2 text-muted-foreground">
              <Phone className="w-4 h-4" />{lead.customer_phone}
            </p>
            {lead.customer_email && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Mail className="w-4 h-4" />{lead.customer_email}
              </p>
            )}
            {lead.visit_date && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="w-4 h-4" />Visited {lead.visit_date}
              </p>
            )}
          </section>

          {(products.length > 0 || lead.liked_product || lead.price_sensitivity) && (
            <>
              <Separator />
              <section className="space-y-2 text-sm">
                <h4 className="font-semibold flex items-center gap-1.5"><Package className="w-4 h-4" />Showroom Visit</h4>
                {lead.liked_product && <p className="text-muted-foreground">Liked: <span className="text-foreground">{lead.liked_product}</span></p>}
                {products.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {products.map((p, i) => <Badge key={i} variant="secondary" className="text-xs">{p}</Badge>)}
                  </div>
                )}
                {lead.price_sensitivity && <p className="text-muted-foreground">Price reaction: <span className="text-foreground">{lead.price_sensitivity}</span></p>}
                {lead.has_family && <p className="text-muted-foreground">👨‍👩‍👧 Decision involves family</p>}
                {lead.concern_type && <p className="text-muted-foreground">Concern: <span className="text-foreground">{lead.concern_type}</span></p>}
              </section>
            </>
          )}

          {lead.notes && (
            <>
              <Separator />
              <section className="space-y-1 text-sm">
                <h4 className="font-semibold">Notes</h4>
                <p className="text-muted-foreground whitespace-pre-wrap">{lead.notes}</p>
              </section>
            </>
          )}

          <Separator />

          <section className="space-y-2">
            <h4 className="font-semibold text-sm flex items-center gap-1.5">
              <History className="w-4 h-4" />Stage History
            </h4>
            {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
            {!loading && history.length === 0 && (
              <p className="text-xs text-muted-foreground">No stage changes yet.</p>
            )}
            <ol className="space-y-2">
              {history.map(h => (
                <li key={h.id} className="text-xs border-l-2 border-primary/30 pl-3 py-1">
                  <div className="flex items-center gap-2">
                    {h.old_stage && (
                      <>
                        <Badge variant="outline" className="text-[10px]">{STAGE_LABEL[h.old_stage] || h.old_stage}</Badge>
                        <span className="text-muted-foreground">→</span>
                      </>
                    )}
                    <Badge variant="outline" className="text-[10px]">{STAGE_LABEL[h.new_stage] || h.new_stage}</Badge>
                  </div>
                  <p className="text-muted-foreground mt-0.5">{new Date(h.changed_at).toLocaleString()}</p>
                  {h.reason && <p className="text-muted-foreground italic">{h.reason}</p>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default LeadDetailsDrawer;
