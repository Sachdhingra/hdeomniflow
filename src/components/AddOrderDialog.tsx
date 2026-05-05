import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { toast } from "sonner";

type OrderItem = {
  order_id: string;
  date: string;
  product: string;
  amount: number;
  status: string;
};

interface Props {
  leadId: string;
  customerName: string;
  existingOrders: OrderItem[];
  onAdded?: () => void;
}

const AddOrderDialog = ({ leadId, customerName, existingOrders, onAdded }: Props) => {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    product: "",
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    status: "New Order",
    notes: "",
  });

  const handleSave = async () => {
    if (!form.product || !form.amount) {
      toast.error("Product and amount are required");
      return;
    }
    setSaving(true);
    try {
      const seq = (existingOrders?.length ?? 0) + 1;
      const order_id = `ORD-${Date.now().toString().slice(-6)}-${seq}`;
      const newOrder: OrderItem = {
        order_id,
        date: form.date,
        product: form.product,
        amount: Number(form.amount),
        status: form.status,
      };
      const updatedOrders = [...(existingOrders ?? []), newOrder];

      const { data, error } = await supabase
        .from("leads")
        .update({ orders: updatedOrders as any })
        .eq("id", leadId)
        .select("repeat_count, total_sales")
        .maybeSingle();
      if (error) throw error;

      const newCount = data?.repeat_count ?? 0;
      const ordinal = newCount + 1;
      const stars = "⭐".repeat(Math.min(3, newCount));
      toast.success(
        newCount > 0
          ? `Order added! Now ${ordinal === 2 ? "2nd" : ordinal === 3 ? "3rd" : `${ordinal}th`} purchase ${stars}`
          : `First order saved for ${customerName}`
      );
      setForm({ product: "", amount: "", date: new Date().toISOString().slice(0, 10), status: "New Order", notes: "" });
      setOpen(false);
      onAdded?.();
    } catch (e: any) {
      toast.error(e?.message || "Failed to add order");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs">
          <Plus className="w-3.5 h-3.5" /> Add Order
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Order — {customerName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Product *</Label>
            <Input
              placeholder="e.g. Sofa, Kitchen, Bedroom"
              value={form.product}
              onChange={(e) => setForm((f) => ({ ...f, product: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Amount (₹) *</Label>
              <Input
                type="number"
                placeholder="175000"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            >
              <option>New Order</option>
              <option>Confirmed</option>
              <option>Completed</option>
              <option>Cancelled</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <Button onClick={handleSave} disabled={saving} className="w-full gradient-primary">
            {saving ? "Saving…" : "Save Order"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AddOrderDialog;
