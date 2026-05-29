import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData, LEAD_CATEGORIES, LeadCategory, LeadStatus, Lead } from "@/contexts/DataContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import EliteCardEnrollment, { EliteChoice } from "@/components/elite/EliteCardEnrollment";
import EliteBadge from "@/components/elite/EliteBadge";

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New", contacted: "Contacted", follow_up: "Follow Up",
  negotiation: "Negotiation", won: "Sold", lost: "Lost", overdue: "Overdue",
  converted: "Closed",
};

const SOLD_OR_CLOSED: LeadStatus[] = ["won", "converted"];

interface Props {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (leadId: string) => void;
}

function addYearsISO(iso: string, y: number) {
  if (!iso) return "";
  const d = new Date(iso); d.setFullYear(d.getFullYear() + y);
  return d.toISOString().slice(0, 10);
}
function formatLong(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const EditLeadDialog = ({ lead, open, onOpenChange, onSaved }: Props) => {
  const { user } = useAuth();
  const { updateLead, profiles } = useData();
  const [form, setForm] = useState({
    category: "" as LeadCategory,
    status: "" as LeadStatus,
    value_in_rupees: 0,
    notes: "",
    next_follow_up_date: "",
    next_follow_up_time: "",
  });
  const [eliteChoice, setEliteChoice] = useState<EliteChoice>("undecided");
  const [eliteIssueDate, setEliteIssueDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [hasEliteCard, setHasEliteCard] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (lead) {
      setForm({
        category: lead.category,
        status: lead.status,
        value_in_rupees: lead.value_in_rupees,
        notes: lead.notes || "",
        next_follow_up_date: lead.next_follow_up_date || "",
        next_follow_up_time: lead.next_follow_up_time || "",
      });
      const l: any = lead;
      const optedIn: boolean | null = l.elite_opted_in ?? null;
      if (optedIn === true) setEliteChoice("opt_in");
      else if (optedIn === false) setEliteChoice("opt_out");
      else setEliteChoice("undecided");
      setEliteIssueDate(l.elite_opted_date || new Date().toISOString().slice(0, 10));
      setHasEliteCard(!!l.elite_card_id || optedIn === true);
    }
  }, [lead]);

  if (!lead) return null;
  const showElite = SOLD_OR_CLOSED.includes(form.status);
  const isElite = !!(lead as any).elite_opted_in;

  const handleSave = async () => {
    setSaving(true);
    const scrollY = window.scrollY;
    try {
      const elitePatch: Record<string, any> = {};
      if (showElite) {
        if (eliteChoice === "opt_in") {
          elitePatch.elite_opted_in = true;
          elitePatch.elite_opted_date = eliteIssueDate;
        } else if (eliteChoice === "opt_out") {
          elitePatch.elite_opted_in = false;
          elitePatch.elite_opted_date = new Date().toISOString().slice(0, 10);
        } else {
          elitePatch.elite_opted_in = null;
        }
      }

      await updateLead(lead.id, {
        category: form.category,
        status: form.status,
        value_in_rupees: form.value_in_rupees,
        notes: form.notes || null,
        next_follow_up_date: form.next_follow_up_date || null,
        next_follow_up_time: form.next_follow_up_time || null,
        ...elitePatch,
      } as any);

      if (showElite && eliteChoice === "opt_in") {
        // Re-fetch to surface the auto-created card details
        const { data } = await supabase
          .from("leads")
          .select("elite_card_id, customer_name")
          .eq("id", lead.id)
          .maybeSingle();
        const expiry = addYearsISO(eliteIssueDate, 3);
        toast.success(`⭐ Elite card created for ${data?.customer_name || lead.customer_name} — valid until ${formatLong(expiry)}`);
      } else if (showElite && eliteChoice === "opt_out") {
        toast(`Elite card enrollment declined for ${lead.customer_name}`);
      } else {
        toast.success("Lead updated", { duration: 2000 });
      }

      onSaved?.(lead.id);
      onOpenChange(false);
      requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: "instant" as ScrollBehavior }));
    } catch (err: any) {
      toast.error(err.message || "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Edit Lead {isElite && <EliteBadge />}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="p-3 bg-muted rounded-lg space-y-1">
            <p className="text-xs text-muted-foreground font-medium">🔒 Read-only</p>
            <p className="text-sm"><span className="font-medium">Customer:</span> {lead.customer_name}</p>
            <p className="text-sm"><span className="font-medium">Phone:</span> {lead.customer_phone}</p>
            <p className="text-sm"><span className="font-medium">Lead Owner:</span> {profiles.find(p => p.id === lead.created_by)?.name || "Unknown"}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v as LeadCategory }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{LEAD_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as LeadStatus }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Value (₹)</Label>
            <Input type="number" value={form.value_in_rupees} onChange={e => setForm(f => ({ ...f, value_in_rupees: Number(e.target.value) }))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Follow-up Date</Label><Input type="date" value={form.next_follow_up_date} onChange={e => setForm(f => ({ ...f, next_follow_up_date: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Follow-up Time</Label><Input type="time" value={form.next_follow_up_time} onChange={e => setForm(f => ({ ...f, next_follow_up_time: e.target.value }))} /></div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} />
          </div>

          {showElite && (
            <EliteCardEnrollment
              choice={eliteChoice}
              onChoiceChange={setEliteChoice}
              issueDate={eliteIssueDate}
              onIssueDateChange={setEliteIssueDate}
            />
          )}

          <Button className="w-full gradient-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EditLeadDialog;
