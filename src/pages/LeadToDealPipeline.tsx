import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { CalendarClock, ChevronRight, Clock3, Loader2, Phone, UserRound } from "lucide-react";

type DealRow = Database["public"]["Tables"]["lead_deals"]["Row"];
type HistoryRow = Database["public"]["Tables"]["lead_deal_history"]["Row"];
type LeadRow = Database["public"]["Tables"]["leads"]["Row"];
type DealStage = "yes_received" | "contacted" | "visit_booked" | "quote_sent" | "negotiation" | "won" | "lost";
type DealView = DealRow & { lead?: LeadRow; ownerName: string; latestReply?: string };

const STAGES: { value: DealStage; label: string; action: string }[] = [
  { value: "yes_received", label: "YES received", action: "Contact customer" },
  { value: "contacted", label: "Contacted", action: "Book customer visit" },
  { value: "visit_booked", label: "Visit booked", action: "Prepare and send quote" },
  { value: "quote_sent", label: "Quote sent", action: "Follow up on quote" },
  { value: "negotiation", label: "Negotiation", action: "Agree final terms" },
  { value: "won", label: "Won", action: "" },
  { value: "lost", label: "Lost", action: "" },
];

const formatDate = (value?: string | null) => value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const LeadToDealPipeline = () => {
  const [deals, setDeals] = useState<DealView[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [selected, setSelected] = useState<DealView | null>(null);
  const [nextStage, setNextStage] = useState<DealStage>("contacted");
  const [nextStep, setNextStep] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadDeals = useCallback(async () => {
    setLoading(true);
    const { data: dealRows, error } = await supabase.from("lead_deals").select("*").order("stage_started_at", { ascending: false });
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    const rows = dealRows ?? [];
    const leadIds = rows.map(row => row.lead_id);
    const ownerIds = rows.map(row => row.owner_id).filter((id): id is string => Boolean(id));
    const [{ data: leadRows }, { data: profiles }, { data: replies }] = await Promise.all([
      leadIds.length ? supabase.from("leads").select("*").in("id", leadIds) : Promise.resolve({ data: [] as LeadRow[] }),
      ownerIds.length ? supabase.from("profiles").select("id,name").in("id", ownerIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      leadIds.length ? supabase.from("lead_messages").select("lead_id,message_body,created_at").in("lead_id", leadIds).eq("message_type", "inbound").order("created_at", { ascending: false }) : Promise.resolve({ data: [] as { lead_id: string; message_body: string; created_at: string }[] }),
    ]);
    const leadMap = new Map((leadRows ?? []).map(lead => [lead.id, lead]));
    const ownerMap = new Map((profiles ?? []).map(profile => [profile.id, profile.name]));
    const replyMap = new Map<string, string>();
    (replies ?? []).forEach(reply => { if (!replyMap.has(reply.lead_id)) replyMap.set(reply.lead_id, reply.message_body); });
    setDeals(rows.map(row => ({ ...row, lead: leadMap.get(row.lead_id), ownerName: row.owner_id ? ownerMap.get(row.owner_id) ?? "Unassigned" : "Unassigned", latestReply: replyMap.get(row.lead_id) })));
    setLoading(false);
  }, []);

  useEffect(() => { void loadDeals(); }, [loadDeals]);

  const byStage = useMemo(() => Object.fromEntries(STAGES.map(stage => [stage.value, deals.filter(deal => deal.stage === stage.value)])) as Record<DealStage, DealView[]>, [deals]);

  const openDeal = async (deal: DealView) => {
    setSelected(deal);
    setNextStage(deal.stage as DealStage);
    setNextStep(deal.next_step ?? "");
    setDueDate(deal.next_step_due_date ?? "");
    setCloseReason(deal.close_reason ?? "");
    const { data } = await supabase.from("lead_deal_history").select("*").eq("deal_id", deal.id).order("changed_at", { ascending: false });
    setHistory(data ?? []);
  };

  const saveDeal = async () => {
    if (!selected) return;
    if (nextStage === "lost" && !closeReason.trim()) {
      toast.error("Add a reason before closing this deal as lost.");
      return;
    }
    setSaving(true);
    const isClosed = nextStage === "won" || nextStage === "lost";
    const { error } = await supabase.from("lead_deals").update({
      stage: nextStage,
      stage_started_at: nextStage === selected.stage ? selected.stage_started_at : new Date().toISOString(),
      next_step: isClosed ? null : nextStep.trim() || STAGES.find(stage => stage.value === nextStage)?.action || null,
      next_step_due_date: isClosed ? null : dueDate || null,
      close_reason: nextStage === "lost" ? closeReason.trim() : null,
    }).eq("id", selected.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Deal updated");
    setSelected(null);
    await loadDeals();
  };

  if (loading) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Lead-to-Deal Pipeline</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every customer who replied YES, with ownership, dates and the next action.</p>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {STAGES.map(stage => (
          <section key={stage.value} className="w-[285px] shrink-0">
            <div className="mb-3 flex items-center justify-between border-b-2 border-primary pb-2">
              <h2 className="font-semibold text-foreground">{stage.label}</h2>
              <Badge variant="secondary">{byStage[stage.value].length}</Badge>
            </div>
            <div className="space-y-3">
              {byStage[stage.value].map(deal => {
                const overdue = deal.next_step_due_date && deal.stage !== "won" && deal.stage !== "lost" && deal.next_step_due_date < new Date().toISOString().slice(0, 10);
                return (
                  <Card key={deal.id} className="cursor-pointer border-border transition-colors hover:border-primary" onClick={() => void openDeal(deal)}>
                    <CardContent className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-foreground">{deal.lead?.customer_name ?? "Customer"}</p>
                          <p className="text-xs text-muted-foreground">{deal.lead?.category?.replace(/_/g, " ") ?? "General enquiry"}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </div>
                      {deal.latestReply && <p className="line-clamp-2 rounded bg-success/10 px-2 py-1.5 text-xs text-success">“{deal.latestReply}”</p>}
                      <div className="space-y-1.5 text-xs text-muted-foreground">
                        <p className="flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" />{deal.ownerName}</p>
                        <p className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />Stage since {formatDate(deal.stage_started_at)}</p>
                        {deal.next_step && <p className="font-medium text-foreground">Next: {deal.next_step}</p>}
                        {deal.next_step_due_date && <p className={`flex items-center gap-1.5 ${overdue ? "font-semibold text-destructive" : ""}`}><CalendarClock className="h-3.5 w-3.5" />{overdue ? "Overdue " : "Due "}{formatDate(deal.next_step_due_date)}</p>}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {byStage[stage.value].length === 0 && <div className="rounded-md border border-dashed p-5 text-center text-xs text-muted-foreground">No deals</div>}
            </div>
          </section>
        ))}
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open) setSelected(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selected?.lead?.customer_name ?? "Deal details"}</DialogTitle>
            <DialogDescription className="flex flex-wrap gap-x-4 gap-y-1">
              <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{selected?.lead?.customer_phone ?? "No phone"}</span>
              <span>YES received {formatDate(selected?.yes_received_at)}</span>
              <span>Owner: {selected?.ownerName}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium">Stage
              <Select value={nextStage} onValueChange={value => setNextStage(value as DealStage)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STAGES.map(stage => <SelectItem key={stage.value} value={stage.value}>{stage.label}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="space-y-1.5 text-sm font-medium">Next action date
              <Input type="date" value={dueDate} disabled={nextStage === "won" || nextStage === "lost"} onChange={event => setDueDate(event.target.value)} />
            </label>
            <label className="space-y-1.5 text-sm font-medium sm:col-span-2">Next step
              <Input value={nextStep} disabled={nextStage === "won" || nextStage === "lost"} onChange={event => setNextStep(event.target.value)} placeholder="What should happen next?" />
            </label>
            {nextStage === "lost" && <label className="space-y-1.5 text-sm font-medium sm:col-span-2">Lost reason
              <Textarea value={closeReason} onChange={event => setCloseReason(event.target.value)} placeholder="Why was this opportunity lost?" />
            </label>}
          </div>
          <div className="border-t pt-4">
            <h3 className="mb-3 text-sm font-semibold">Stage timeline</h3>
            <div className="space-y-3">
              {history.map(item => <div key={item.id} className="flex gap-3 text-sm"><div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" /><div><p className="font-medium text-foreground">{STAGES.find(stage => stage.value === item.new_stage)?.label ?? item.new_stage}</p><p className="text-xs text-muted-foreground">{formatDate(item.changed_at)} · {item.change_source.replace(/_/g, " ")}{item.next_step ? ` · Next: ${item.next_step}` : ""}</p></div></div>)}
            </div>
          </div>
          <DialogFooter><Button onClick={() => void saveDeal()} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save deal</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LeadToDealPipeline;