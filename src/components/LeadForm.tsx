import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData, LEAD_CATEGORIES, LeadCategory } from "@/contexts/DataContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { toast } from "sonner";

const LeadForm = ({ source = "sales" }: { source?: "sales" | "site_agent" }) => {
  const { user } = useAuth();
  const { addLead } = useData();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    customerName: "",
    customerPhone: "",
    category: "" as LeadCategory | "",
    valueInRupees: "",
    notes: "",
    nextFollowUpDate: "",
    nextFollowUpTime: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customerName || !form.customerPhone || !form.category || !form.valueInRupees || !form.nextFollowUpDate || !form.nextFollowUpTime) {
      toast.error("Please fill all required fields including follow-up date & time");
      return;
    }
    addLead({
      customerName: form.customerName,
      customerPhone: form.customerPhone,
      category: form.category as LeadCategory,
      valueInRupees: Number(form.valueInRupees),
      status: "new",
      assignedTo: user?.id || "",
      notes: form.notes,
      source,
      nextFollowUpDate: form.nextFollowUpDate,
      nextFollowUpTime: form.nextFollowUpTime,
      createdBy: user?.id || "",
    });
    toast.success("Lead added successfully!");
    setForm({ customerName: "", customerPhone: "", category: "", valueInRupees: "", notes: "", nextFollowUpDate: "", nextFollowUpTime: "" });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gradient-primary gap-2">
          <Plus className="w-4 h-4" /> Add Lead
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Lead</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Customer Name *</Label>
              <Input value={form.customerName} onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))} placeholder="Full name" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone *</Label>
              <Input value={form.customerPhone} onChange={e => setForm(f => ({ ...f, customerPhone: e.target.value }))} placeholder="98765 43210" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category *</Label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v as LeadCategory }))}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {LEAD_CATEGORIES.map(c => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Value (₹) *</Label>
              <Input type="number" value={form.valueInRupees} onChange={e => setForm(f => ({ ...f, valueInRupees: e.target.value }))} placeholder="85000" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Next Follow-up Date *</Label>
              <Input type="date" value={form.nextFollowUpDate} onChange={e => setForm(f => ({ ...f, nextFollowUpDate: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Next Follow-up Time *</Label>
              <Input type="time" value={form.nextFollowUpTime} onChange={e => setForm(f => ({ ...f, nextFollowUpTime: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Additional details..." rows={2} />
          </div>
          <Button type="submit" className="w-full gradient-primary">Save Lead</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default LeadForm;
