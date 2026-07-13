import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData, Lead } from "@/contexts/DataContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [remarks, setRemarks] = useState("");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [tempJobId] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const invoiceNumberMissing = !invoiceNumber.trim();
  const invoiceDateMissing = !invoiceDate;
  const invoiceInvalid = invoiceNumberMissing || invoiceDateMissing;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (!deliveryDate) { toast.error("Delivery date is required"); return; }
    if (invoiceInvalid) { toast.error("Invoice number and date are required for self-delivery"); return; }
    if (photoUrls.length === 0) { toast.error("Upload at least 1 delivery proof photo"); return; }
    if (photoUrls.length > 5) { toast.error("Maximum 5 photos allowed"); return; }

    setSaving(true);
    try {
      const now = new Date().toISOString();

      await updateLead(lead.id, {
        status: "won",
        delivery_date: deliveryDate,
        delivery_notes: remarks || null,
        delivery_assigned_to: user?.id || null,
      });

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
        status: "pending" as any,
        accounts_approval_status: "pending",
        source_lead_id: lead.id,
        assigned_agent: user?.id || null,
        accepted_at: now,
        travel_started_at: now,
        agent_reached_at: now,
        remarks: remarks || null,
        photos: photoUrls,
        invoice_number: invoiceNumber.trim(),
        invoice_date: invoiceDate,
      } as any);
      if (jobError) {
        // Unique index violation (duplicate submission)
        if ((jobError as any).code === "23505") {
          throw new Error("A self-delivery for this lead is already awaiting accounts approval — duplicate entry blocked.");
        }
        throw jobError;
      }

      toast.success("Self-delivery submitted for accounts approval ✅");
      onOpenChange(false);
      setRemarks("");
      setPhotoUrls([]);
      setInvoiceNumber("");
      setAttempted(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to submit self-delivery");
    } finally {
      setSaving(false);
    }
  };

  const showNumErr = attempted && invoiceNumberMissing;
  const showDateErr = attempted && invoiceDateMissing;

  const submitDisabled = saving || photoUrls.length === 0 || invoiceInvalid;
  const submitBtn = (
    <Button
      type="submit"
      className="w-full bg-success text-success-foreground hover:bg-success/90 gap-2"
      disabled={submitDisabled}
    >
      <PackageCheck className="w-4 h-4" />
      {saving ? "Submitting..." : "Save Sale & Submit for Accounts Approval"}
    </Button>
  );

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

          {/* Invoice fields — mandatory for self-delivery */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-md border border-primary/30 bg-primary/5">
            <div className="space-y-1.5">
              <Label>Invoice No *</Label>
              <Input
                value={invoiceNumber}
                onChange={e => setInvoiceNumber(e.target.value)}
                placeholder="e.g. INV-2026-001"
                maxLength={50}
                required
                aria-invalid={showNumErr}
                className={showNumErr ? "border-destructive focus-visible:ring-destructive" : ""}
              />
              {showNumErr && <p className="text-xs text-destructive">Invoice number is required</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Invoice Date *</Label>
              <Input
                type="date"
                value={invoiceDate}
                onChange={e => setInvoiceDate(e.target.value)}
                required
                aria-invalid={showDateErr}
                className={showDateErr ? "border-destructive focus-visible:ring-destructive" : ""}
              />
              {showDateErr && <p className="text-xs text-destructive">Invoice date is required</p>}
            </div>
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

          {invoiceInvalid ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="w-full">{submitBtn}</div>
                </TooltipTrigger>
                <TooltipContent>Fill invoice number and date to proceed</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : submitBtn}
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default SelfDeliveryDialog;
