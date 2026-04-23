import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData, Lead } from "@/contexts/DataContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PackageCheck } from "lucide-react";
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
    if (!remarks.trim()) { toast.error("Add remarks/comments"); return; }
    if (photoUrls.length === 0) { toast.error("Upload at least 1 completion photo"); return; }

    setSaving(true);
    try {
      // Mark lead with delivery info
      await updateLead(lead.id, {
        delivery_date: deliveryDate,
        delivery_notes: remarks,
        delivery_assigned_to: user?.id || null,
      });

      // Create completed service_job so photos & remarks are visible
      // to service head and admin (via existing service_jobs flow)
      const { error: jobError } = await supabase.from("service_jobs").insert({
        customer_name: lead.customer_name,
        customer_phone: lead.customer_phone,
        address: lead.delivery_notes || "",
        category: lead.category,
        description: `Self-delivered by sales — ${lead.category} (₹${Number(lead.value_in_rupees).toLocaleString("en-IN")})`,
        date_to_attend: deliveryDate,
        value: lead.value_in_rupees,
        is_foc: false,
        status: "completed",
        type: "delivery",
        source_lead_id: lead.id,
        assigned_agent: user?.id || null,
        accepted_at: new Date().toISOString(),
        agent_reached_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        remarks,
        photos: photoUrls,
      });
      if (jobError) throw jobError;

      toast.success("Self-delivery recorded! 📦");
      onOpenChange(false);
      setRemarks("");
      setPhotoUrls([]);
    } catch (err: any) {
      toast.error(err.message || "Failed to record self-delivery");
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
            <Label>Completion Photos * (up to 5)</Label>
            <ServiceJobPhotoUpload
              jobId={tempJobId}
              onUploadComplete={setPhotoUrls}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Remarks / Comments *</Label>
            <Textarea
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              placeholder="Customer feedback, condition on delivery, anything noteworthy..."
              rows={3}
            />
          </div>

          <Button
            type="submit"
            className="w-full bg-success text-success-foreground hover:bg-success/90 gap-2"
            disabled={saving || photoUrls.length === 0 || !remarks.trim()}
          >
            <PackageCheck className="w-4 h-4" />
            {saving ? "Saving..." : "Mark as Delivered"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default SelfDeliveryDialog;
