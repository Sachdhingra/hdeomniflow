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
import { EliteTier } from "@/lib/eliteTiers";
import EliteBadge from "@/components/elite/EliteBadge";
import { formatDate } from "@/lib/dateFormat";

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
  const [eliteTier, setEliteTier] = useState<EliteTier>("silver");
  const [tierTouched, setTierTouched] = useState(false);
  const [eliteDupWarning, setEliteDupWarning] = useState<string | null>(null);
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
      // Tier lives on elite_customers (leads has no tier column) — fetch the
      // linked card's current tier so the dialog reflects admin-side changes.
      setEliteTier("silver");
      setTierTouched(false);
      setEliteDupWarning(null);
      const cardId: string | null = l.elite_card_id ?? null;
      if (cardId) {
        let cancelled = false;
        supabase
          .from("elite_customers" as any)
          .select("card_tier")
          .eq("id", cardId)
          .maybeSingle()
          .then(({ data }) => {
            const t = (data as any)?.card_tier as EliteTier | null;
            if (!cancelled && t) setEliteTier(t);
          });
        return () => { cancelled = true; };
      }
    }
  }, [lead]);

  if (!lead) return null;
  const showElite = SOLD_OR_CLOSED.includes(form.status);
  const isElite = !!(lead as any).elite_opted_in;
  // Tier is chosen once by sales; changes after that need an admin
  const tierLocked = isElite && !!(lead as any).elite_card_id && user?.role !== "admin";

  const handleSave = async () => {
    setSaving(true);
    const scrollY = window.scrollY;
    try {
      const l: any = lead;
      const prevOptedIn: boolean | null = l.elite_opted_in ?? null;
      const prevCardId: string | null = l.elite_card_id ?? null;
      const elitePatch: Record<string, any> = {};
      let toastMessage: { kind: "success" | "warn" | "neutral"; text: string } | null = null;

      if (showElite) {
        // ---- Reversal: previously opted in, now opt_out or undecided ----
        if (prevOptedIn === true && (eliteChoice === "opt_out" || eliteChoice === "undecided")) {
          if (prevCardId) {
            const { error: delErr } = await (supabase.from("elite_customers" as any).delete().eq("id", prevCardId) as any);
            if (delErr) throw delErr;
          }
          if (eliteChoice === "opt_out") {
            elitePatch.elite_opted_in = false;
            elitePatch.elite_opted_date = new Date().toISOString().slice(0, 10);
            elitePatch.elite_card_id = null;
            toastMessage = { kind: "warn", text: `Elite card removed. ${lead.customer_name} marked as Opted Out` };
          } else {
            elitePatch.elite_opted_in = null;
            elitePatch.elite_opted_date = null;
            elitePatch.elite_card_id = null;
            toastMessage = { kind: "neutral", text: `Elite card entry removed for ${lead.customer_name}` };
          }
        }
        // ---- Opt-in (new or unchanged) ----
        else if (eliteChoice === "opt_in") {
          // Duplicate guard: another elite record for this phone (not this lead's card)
          const { data: existing } = await supabase
            .from("elite_customers" as any)
            .select("id, customer_name, status, lead_id")
            .eq("phone_1", lead.customer_phone)
            .maybeSingle();
          const ex: any = existing;
          if (ex && ex.id !== prevCardId) {
            if (ex.status === "opted_out") {
              // Reactivate existing record and link
              const { error: upErr } = await (supabase.from("elite_customers" as any).update({
                status: "active",
                card_issue_date: eliteIssueDate,
                lead_id: lead.id,
              }).eq("id", ex.id) as any);
              if (upErr) throw upErr;
              elitePatch.elite_opted_in = true;
              elitePatch.elite_opted_date = eliteIssueDate;
              elitePatch.elite_card_id = ex.id;
              toastMessage = { kind: "success", text: `⭐ Elite membership reactivated for ${lead.customer_name}` };
            } else {
              // Link to existing record instead of creating new
              if (ex.lead_id && ex.lead_id !== lead.id) {
                setEliteDupWarning(`This customer (${ex.customer_name}) is already an Elite Member. No new entry will be created.`);
                setSaving(false);
                return;
              }
              // Available existing record without a lead — link it
              if (!ex.lead_id) {
                await (supabase.from("elite_customers" as any).update({ lead_id: lead.id }).eq("id", ex.id) as any);
              }
              elitePatch.elite_opted_in = true;
              elitePatch.elite_opted_date = eliteIssueDate;
              elitePatch.elite_card_id = ex.id;
              toastMessage = { kind: "warn", text: `${lead.customer_name} is already an Elite Member — linked to existing card` };
            }
          } else {
            // No conflict: let trigger create on first opt-in, or just update date if already linked
            elitePatch.elite_opted_in = true;
            elitePatch.elite_opted_date = eliteIssueDate;
          }
        } else if (eliteChoice === "opt_out") {
          // No prior opt-in to reverse — just record opt-out
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

      // Sync selected tier onto the linked elite_customers record (opt-in only).
      // Skipped when locked — the DB trigger rejects tier changes by non-admins anyway.
      if (showElite && eliteChoice === "opt_in" && !tierLocked) {
        const targetCardId: string | null = elitePatch.elite_card_id ?? prevCardId;
        if (targetCardId) {
          // Only push a tier the user explicitly picked in this dialog —
          // otherwise leave the card's tier alone (it may have been changed
          // by an admin elsewhere and would get silently reverted here).
          if (tierTouched) {
            const { error: tierErr } = await (supabase.from("elite_customers" as any).update({ card_tier: eliteTier }).eq("id", targetCardId) as any);
            if (tierErr) throw tierErr;
          }
        } else {
          // Trigger just auto-created the card — patch by phone
          const { error: tierErr } = await (supabase.from("elite_customers" as any).update({ card_tier: eliteTier }).eq("phone_1", lead.customer_phone) as any);
          if (tierErr) throw tierErr;
        }
      }


      if (toastMessage) {
        if (toastMessage.kind === "success") toast.success(toastMessage.text);
        else if (toastMessage.kind === "warn") toast(toastMessage.text, { className: "bg-amber-50 text-amber-900" });
        else toast(toastMessage.text);
      } else if (showElite && eliteChoice === "opt_in" && prevOptedIn !== true) {
        const expiry = addYearsISO(eliteIssueDate, 3);
        toast.success(`⭐ Elite card created for ${lead.customer_name} — valid until ${formatDate(expiry)}`);
      } else {
        toast.success("Lead updated", { duration: 2000 });
      }

      onSaved?.(lead.id);
      onOpenChange(false);
      requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: "instant" as ScrollBehavior }));
    } catch (err: any) {
      if (String(err?.message || "").includes("TIER_LOCKED")) {
        toast.error("Card tier is locked after first selection. Ask an admin to change it.");
      } else {
        toast.error(err.message || "Failed to update");
      }
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
              onChoiceChange={(c) => { setEliteChoice(c); setEliteDupWarning(null); }}
              issueDate={eliteIssueDate}
              onIssueDateChange={setEliteIssueDate}
              tier={eliteTier}
              onTierChange={(t) => { setEliteTier(t); setTierTouched(true); }}
              purchaseValue={form.value_in_rupees}
              duplicateWarning={eliteDupWarning}
              tierLocked={tierLocked}
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
