import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData, Lead } from "@/contexts/DataContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PackageCheck, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import ServiceJobPhotoUpload from "@/components/ServiceJobPhotoUpload";

interface Props {
  lead: Lead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SelfDeliveryDialog = ({ lead, open, onOpenChange }: Props) => {
  const { user } = useAuth();
  const { updateLead } = useData();
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().split("T")[0]);
  const [remarks, setRemarks] = useState("");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [tempJobId] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deliveryDate) { toast.error("Delivery date is required"); return; }
    if (photoUrls.length === 0) { toast.error("Upload at least 1 delivery proof photo"); return; }
    if (photoUrls.length > 5) { toast.error("Maximum 5 photos allowed"); return; }

    setSaving(true);
    try {
      const now = new Date().toISOString();

      // Mark lead as won + record delivery info
      await updateLead(lead.id, {
        status: "won",
        delivery_date: deliveryDate,
        delivery_notes: remarks || null,
        delivery_assigned_to: user?.id || null,
      });

      // Create self_delivery service_job awaiting accounts approval.
      // The set_initial_approval_status trigger will set status to
      // 'pending_accounts_approval' automatically.
      const { error: jobError } = await supabase.from("service_jobs").insert({
        customer_name: lead.customer_name,
        customer_phone: lead.customer_phone,
        address: lead.delivery_notes || "Customer pickup",
        category: lead.category,
        description: `Self-delivered by sales — ${lead.category} (₹${Number(lead.value_in_rupees).toLocaleString("en-IN")})`,
        date_to_attend: deliveryDate,
        date_received: now,
        value: lead.value_in_rupees,
        is_foc: false,
        type: "self_delivery" as any,
        status: "pending" as any, // trigger upgrades to pending_accounts_approval
        accounts_approval_status: "pending",
        source_lead_id: lead.id,
        assigned_agent: user?.id || null,
        accepted_at: now,
        travel_started_at: now,
        agent_reached_at: now,
        // intentionally no completed_at — only set on accounts approval
        remarks: remarks || null,
        photos: photoUrls,
      } as any);
      if (jobError) throw jobError;

      toast.success("Self-delivery submitted for accounts approval ✅");
      onOpenChange(false);
      setRemarks("");
      setPhotoUrls([]);
    } catch (err: any) {
      toast.error(err.message || "Failed to submit self-delivery");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="w-5 h-5 text-success" />Self Delivery
          </DialogTitle>
        </DialogHeader>
        <div className="p-3 bg-muted rounded-lg text-sm mb-2">
          <p><span className="font-medium">Customer:</span> {lead.customer_name}</p>
          <p><span className="font-medium">Category:</span> {lead.category}</p>
          <p><span className="font-medium">Value:</span> ₹{Number(lead.value_in_rupees).toLocaleString("en-IN")}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Delivery Date *</Label>
            <Input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Delivery Proof Photos * (mandatory, up to 5)</Label>
            <ServiceJobPhotoUpload
              jobId={tempJobId}
              onUploadComplete={setPhotoUrls}
            />
            <p className="text-xs text-muted-foreground">
              Show: customer receiving item, item condition, setup if any.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Remarks (optional)</Label>
            <Textarea
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              placeholder="Customer feedback, installation notes, anything noteworthy..."
              rows={3}
            />
          </div>

          <div className="rounded-md bg-warning/10 border border-warning/30 p-2.5 text-xs flex gap-2">
            <ShieldCheck className="w-4 h-4 text-warning shrink-0 mt-0.5" />
            <p>
              Photos serve as proof of delivery. Accounts will verify payment status
              and approve/reject before this is closed.
            </p>
          </div>

          <Button
            type="submit"
            className="w-full bg-success text-success-foreground hover:bg-success/90 gap-2"
            disabled={saving || photoUrls.length === 0}
          >
            <PackageCheck className="w-4 h-4" />
            {saving ? "Submitting..." : "Submit for Accounts Approval"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default SelfDeliveryDialog;
