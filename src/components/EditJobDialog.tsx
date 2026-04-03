import { useState, useEffect } from "react";
import { useData, LEAD_CATEGORIES, LeadCategory, ServiceJob } from "@/contexts/DataContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending", assigned: "Assigned", in_progress: "In Progress",
  on_route: "On Route", on_site: "On Site", completed: "Completed", rescheduled: "Rescheduled",
};

interface Props {
  job: ServiceJob | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EditJobDialog = ({ job, open, onOpenChange }: Props) => {
  const { updateServiceJob, getProfilesByRole } = useData();
  const [form, setForm] = useState({
    category: "" as LeadCategory,
    value: 0,
    address: "",
    description: "",
    date_to_attend: "",
    assigned_agent: "",
    remarks: "",
    claim_part_no: "",
    claim_reason: "",
    claim_due_date: "",
  });
  const [saving, setSaving] = useState(false);
  const fieldAgents = getProfilesByRole("field_agent");

  useEffect(() => {
    if (job) {
      setForm({
        category: job.category,
        value: job.value,
        address: job.address,
        description: job.description,
        date_to_attend: job.date_to_attend || "",
        assigned_agent: job.assigned_agent || "",
        remarks: job.remarks || "",
        claim_part_no: job.claim_part_no || "",
        claim_reason: job.claim_reason || "",
        claim_due_date: job.claim_due_date || "",
      });
    }
  }, [job]);

  if (!job) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateServiceJob(job.id, {
        category: form.category,
        value: form.value,
        address: form.address,
        description: form.description,
        date_to_attend: form.date_to_attend || null,
        assigned_agent: form.assigned_agent || null,
        remarks: form.remarks || null,
        claim_part_no: form.claim_part_no || null,
        claim_reason: form.claim_reason || null,
        claim_due_date: form.claim_due_date || null,
      });
      toast.success("Job updated!");
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
        <DialogHeader><DialogTitle>Edit Job</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="p-3 bg-muted rounded-lg space-y-1">
            <p className="text-xs text-muted-foreground font-medium">🔒 Read-only</p>
            <p className="text-sm"><span className="font-medium">Customer:</span> {job.customer_name}</p>
            <p className="text-sm"><span className="font-medium">Phone:</span> {job.customer_phone}</p>
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
              <Label>Value (₹)</Label>
              <Input type="number" value={form.value} onChange={e => setForm(f => ({ ...f, value: Number(e.target.value) }))} />
            </div>
          </div>

          <div className="space-y-1.5"><Label>Address</Label><Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label>Description</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} /></div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Date to Attend</Label><Input type="date" value={form.date_to_attend} onChange={e => setForm(f => ({ ...f, date_to_attend: e.target.value }))} /></div>
            <div className="space-y-1.5">
              <Label>Assigned Agent</Label>
              <Select value={form.assigned_agent} onValueChange={v => setForm(f => ({ ...f, assigned_agent: v }))}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned</SelectItem>
                  {fieldAgents.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5"><Label>Remarks</Label><Textarea value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} rows={2} /></div>

          <div className="border-t pt-3 space-y-3">
            <p className="text-sm font-semibold text-muted-foreground">Claim Details</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Part No.</Label><Input value={form.claim_part_no} onChange={e => setForm(f => ({ ...f, claim_part_no: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Due Date</Label><Input type="date" value={form.claim_due_date} onChange={e => setForm(f => ({ ...f, claim_due_date: e.target.value }))} /></div>
            </div>
            <div className="space-y-1.5"><Label>Reason</Label><Input value={form.claim_reason} onChange={e => setForm(f => ({ ...f, claim_reason: e.target.value }))} /></div>
          </div>

          <Button className="w-full gradient-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EditJobDialog;
