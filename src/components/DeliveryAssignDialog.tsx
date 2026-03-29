import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData, Lead } from "@/contexts/DataContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Truck } from "lucide-react";
import { toast } from "sonner";

interface Props {
  lead: Lead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DeliveryAssignDialog = ({ lead, open, onOpenChange }: Props) => {
  const { user } = useAuth();
  const { assignDelivery } = useData();
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!deliveryDate) {
      toast.error("Delivery date is required");
      return;
    }
    assignDelivery(lead.id, deliveryDate, deliveryNotes, "3", user?.id || "");
    toast.success("Delivery assigned to Service Head!");
    onOpenChange(false);
    setDeliveryDate("");
    setDeliveryNotes("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-primary" />
            Assign for Delivery
          </DialogTitle>
        </DialogHeader>
        <div className="p-3 bg-muted rounded-lg text-sm mb-2">
          <p><span className="font-medium">Customer:</span> {lead.customerName}</p>
          <p><span className="font-medium">Category:</span> {lead.category}</p>
          <p><span className="font-medium">Value:</span> ₹{lead.valueInRupees.toLocaleString("en-IN")}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Delivery Date *</Label>
            <Input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Delivery Address & Notes</Label>
            <Textarea value={deliveryNotes} onChange={e => setDeliveryNotes(e.target.value)} placeholder="Delivery address, special instructions..." rows={3} />
          </div>
          <Button type="submit" className="w-full gradient-primary gap-2">
            <Truck className="w-4 h-4" /> Send to Service Head
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default DeliveryAssignDialog;
