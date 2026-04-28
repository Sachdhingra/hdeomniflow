import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Phone, Mail, Calendar, Package, History, Sparkles, MapPin, MessageCircle, Zap, Home, Users, Clock } from "lucide-react";
import type { Lead, LeadStatus } from "@/contexts/DataContext";
import { LEAD_CATEGORIES } from "@/contexts/DataContext";
import { neighborhoodColor, responseTimeColor, formatRelativeTime, PREFERRED_STYLES, BUDGET_RANGES, FAMILY_SITUATIONS, DECISION_TIMELINES, STATED_NEEDS } from "@/lib/leadConstants";

interface LeadMessage {
  id: string;
  message_type: string;
  message_body: string;
  status: string;
  sent_at: string;
  template_used: string | null;
}

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
  const [messages, setMessages] = useState<LeadMessage[]>([]);
  const [probability, setProbability] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!lead || !open) return;
    setLoading(true);
    (async () => {
      const [{ data: hist }, { data: prob }, { data: msgs }] = await Promise.all([
        supabase.from("lead_stage_history")
          .select("id, old_stage, new_stage, changed_at, reason")
          .eq("lead_id", lead.id)
          .order("changed_at", { ascending: false }),
        supabase.rpc("calculate_conversion_probability", { _lead_id: lead.id }),
        supabase.from("lead_messages")
          .select("id, message_type, message_body, status, sent_at, template_used")
          .eq("lead_id", lead.id)
          .order("sent_at", { ascending: false })
          .limit(20),
      ]);
      setHistory((hist as StageHistoryRow[]) || []);
      setMessages((msgs as LeadMessage[]) || []);
      setProbability(typeof prob === "number" ? prob : (lead.conversion_probability ?? 30));
      setLoading(false);
    })();
  }, [lead, open]);

  if (!lead) return null;
  const l: any = lead;

  const products = Array.isArray(lead.products_viewed) ? (lead.products_viewed as string[]) : [];
  const daysInStage = Math.floor(
    (Date.now() - new Date(lead.stage_changed_at || lead.created_at).getTime()) / 86400000
  );
  const styleLabel = PREFERRED_STYLES.find(s => s.value === l.preferred_style)?.label;
  const budgetLabel = BUDGET_RANGES.find(b => b.value === l.budget_range)?.label;
  const familyLabel = FAMILY_SITUATIONS.find(f => f.value === l.family_situation)?.label;
  const timelineLabel = DECISION_TIMELINES.find(t => t.value === l.decision_timeline)?.label;
  const needLabel = STATED_NEEDS.find(n => n.value === l.stated_need)?.label;

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

          <Separator />

          {/* Psychology profile */}
          <section className="space-y-2 text-sm">
            <h4 className="font-semibold flex items-center gap-1.5"><Home className="w-4 h-4" />Buyer Profile</h4>
            <div className="grid grid-cols-2 gap-2">
              {l.neighborhood && (
                <div className="space-y-0.5">
                  <p className="text-[10px] uppercase text-muted-foreground">Neighborhood</p>
                  <Badge className={`${neighborhoodColor(l.neighborhood)} text-[11px] gap-0.5 border-0`}>
                    <MapPin className="w-3 h-3" />{l.neighborhood}
                  </Badge>
                </div>
              )}
              {l.product_viewed && (
                <div className="space-y-0.5">
                  <p className="text-[10px] uppercase text-muted-foreground">Product viewed</p>
                  <p className="text-foreground">{l.product_viewed}</p>
                </div>
              )}
              {needLabel && (
                <div className="space-y-0.5">
                  <p className="text-[10px] uppercase text-muted-foreground">Stated need</p>
                  <p className="text-foreground">{needLabel}</p>
                </div>
              )}
              {styleLabel && (
                <div className="space-y-0.5">
                  <p className="text-[10px] uppercase text-muted-foreground">Style</p>
                  <p className="text-foreground">{styleLabel}</p>
                </div>
              )}
              {familyLabel && (
                <div className="space-y-0.5">
                  <p className="text-[10px] uppercase text-muted-foreground">Family</p>
                  <p className="text-foreground flex items-center gap-1"><Users className="w-3 h-3" />{familyLabel}</p>
                </div>
              )}
              {timelineLabel && (
                <div className="space-y-0.5">
                  <p className="text-[10px] uppercase text-muted-foreground">Timeline</p>
                  <p className="text-foreground flex items-center gap-1"><Clock className="w-3 h-3" />{timelineLabel}</p>
                </div>
              )}
              {budgetLabel && (
                <div className="space-y-0.5">
                  <p className="text-[10px] uppercase text-muted-foreground">Budget</p>
                  <p className="text-foreground">{budgetLabel}</p>
                </div>
              )}
              <div className="space-y-0.5">
                <p className="text-[10px] uppercase text-muted-foreground">Days in stage</p>
                <p className="text-foreground">{daysInStage}d</p>
              </div>
            </div>
            {l.objection_type && (
              <p className="text-xs">
                <span className="text-muted-foreground">Objection:</span>{" "}
                <Badge variant={l.barrier_addressed ? "secondary" : "destructive"} className="text-[10px]">
                  {l.objection_type}{l.barrier_addressed ? " · addressed" : " · open"}
                </Badge>
              </p>
            )}
          </section>

          <Separator />

          {/* Messaging */}
          <section className="space-y-2 text-sm">
            <h4 className="font-semibold flex items-center gap-1.5"><MessageCircle className="w-4 h-4" />Messaging</h4>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="bg-muted rounded p-2 text-center">
                <p className="text-[10px] text-muted-foreground">Sent</p>
                <p className="font-bold">{l.messages_sent ?? 0}</p>
              </div>
              <div className="bg-muted rounded p-2 text-center">
                <p className="text-[10px] text-muted-foreground">Last msg</p>
                <p className="font-medium">{formatRelativeTime(l.last_message_at)}</p>
              </div>
              <div className="bg-muted rounded p-2 text-center">
                <p className="text-[10px] text-muted-foreground">Response</p>
                <p className={`font-medium ${responseTimeColor(l.response_time_minutes)} flex items-center justify-center gap-1`}>
                  <Zap className="w-3 h-3" />{l.response_time_minutes != null ? `${l.response_time_minutes}m` : "—"}
                </p>
              </div>
            </div>
            {messages.length === 0 && (
              <p className="text-xs text-muted-foreground">No messages exchanged yet.</p>
            )}
            {messages.length > 0 && (
              <ol className="space-y-1.5 max-h-48 overflow-y-auto">
                {messages.map(m => (
                  <li key={m.id} className={`text-xs rounded p-2 border-l-2 ${m.message_type === "outbound" ? "border-primary bg-primary/5" : "border-success bg-success/5"}`}>
                    <div className="flex items-center justify-between mb-0.5">
                      <Badge variant="outline" className="text-[9px]">{m.message_type}</Badge>
                      <span className="text-muted-foreground text-[10px]">{formatRelativeTime(m.sent_at)}</span>
                    </div>
                    <p className="whitespace-pre-wrap">{m.message_body}</p>
                  </li>
                ))}
              </ol>
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
