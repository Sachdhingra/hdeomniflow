import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData, LEAD_CATEGORIES, LeadCategory, LeadStatus, Lead } from "@/contexts/DataContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New", contacted: "Contacted", follow_up: "Follow Up",
  negotiation: "Negotiation", won: "Won", lost: "Lost", overdue: "Overdue",
};

interface Props {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EditLeadDialog = ({ lead, open, onOpenChange }: Props) => {
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
    }
  }, [lead]);

  if (!lead) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateLead(lead.id, {
        category: form.category,
        status: form.status,
        value_in_rupees: form.value_in_rupees,
        notes: form.notes || null,
        next_follow_up_date: form.next_follow_up_date || null,
        next_follow_up_time: form.next_follow_up_time || null,
      });
      toast.success("Lead updated!");
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Lead</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {/* Locked fields */}
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

          <Button className="w-full gradient-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EditLeadDialog;
