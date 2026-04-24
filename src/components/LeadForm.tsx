import { useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData, LEAD_CATEGORIES, LeadCategory } from "@/contexts/DataContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, AlertTriangle, UserCheck } from "lucide-react";
import { toast } from "sonner";

const LeadForm = ({ source = "sales" }: { source?: string }) => {
  const { user } = useAuth();
  const { addLead } = useData();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    customerName: "", customerPhone: "", category: "" as LeadCategory | "",
    valueInRupees: "", notes: "", nextFollowUpDate: "", nextFollowUpTime: "",
  });
  const [duplicateCheck, setDuplicateCheck] = useState<{
    checking: boolean;
    exists: boolean;
    existingName?: string;
  }>({ checking: false, exists: false });

  const checkDuplicate = useCallback(async (phone: string) => {
    if (phone.length !== 10) {
      setDuplicateCheck({ checking: false, exists: false });
      return;
    }
    setDuplicateCheck({ checking: true, exists: false });
    try {
      const { data } = await supabase
        .from("leads")
        .select("customer_name, customer_phone")
        .eq("customer_phone", phone)
        .is("deleted_at", null)
        .limit(1);

      if (data && data.length > 0) {
        setDuplicateCheck({ checking: false, exists: true, existingName: data[0].customer_name });
        // Auto-fill customer name
        setForm(f => ({ ...f, customerName: data[0].customer_name }));
      } else {
        setDuplicateCheck({ checking: false, exists: false });
      }
    } catch {
      setDuplicateCheck({ checking: false, exists: false });
    }
  }, []);

  const handlePhoneChange = (value: string) => {
    const v = value.replace(/\D/g, "").slice(0, 10);
    setForm(f => ({ ...f, customerPhone: v }));
    if (v.length === 10) {
      checkDuplicate(v);
    } else {
      setDuplicateCheck({ checking: false, exists: false });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customerName || !form.customerPhone || !form.category || !form.valueInRupees || !form.nextFollowUpDate || !form.nextFollowUpTime) {
      toast.error("Please fill all required fields including follow-up date & time");
      return;
    }
    if (!/^\d{10}$/.test(form.customerPhone)) {
      toast.error("Phone must be exactly 10 digits");
      return;
    }
    if (duplicateCheck.exists) {
      toast.error("Lead already exists for this number. Use Service module for repeat customers.");
      return;
    }
    // Capture GPS for field agents (best-effort, no blocking)
    let gps: { lat?: number; lng?: number } = {};
    if (source === "field_agent" && typeof navigator !== "undefined" && navigator.geolocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 6000 });
        });
        gps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      } catch { /* ignore */ }
    }
    try {
      await addLead({
        customer_name: form.customerName,
        customer_phone: form.customerPhone,
        category: form.category as LeadCategory,
        value_in_rupees: Number(form.valueInRupees),
        status: "new",
        assigned_to: user?.id || "",
        notes: form.notes,
        source,
        source_type: source as any,
        next_follow_up_date: form.nextFollowUpDate,
        next_follow_up_time: form.nextFollowUpTime,
        created_by: user?.id || "",
        updated_by: user?.id || "",
        created_from_lat: gps.lat,
        created_from_lng: gps.lng,
      } as any);
      toast.success("Lead added successfully!");
      setForm({ customerName: "", customerPhone: "", category: "", valueInRupees: "", notes: "", nextFollowUpDate: "", nextFollowUpTime: "" });
      setDuplicateCheck({ checking: false, exists: false });
      setOpen(false);
    } catch (err: any) {
      const msg = err?.message || "Failed to add lead";
      if (msg.includes("Daily lead limit")) {
        toast.error("Daily limit reached: field agents can add maximum 2 leads per day.");
      } else {
        toast.error(msg);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setDuplicateCheck({ checking: false, exists: false }); }}>
      <DialogTrigger asChild>
        <Button className="gradient-primary gap-2"><Plus className="w-4 h-4" /> Add Lead</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Lead</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Phone * (10 digits)</Label>
              <Input
                value={form.customerPhone}
                onChange={e => handlePhoneChange(e.target.value)}
                maxLength={10}
                placeholder="9876543210"
              />
              {duplicateCheck.checking && (
                <p className="text-xs text-muted-foreground">Checking...</p>
              )}
              {duplicateCheck.exists && (
                <div className="flex items-center gap-1 text-xs text-destructive">
                  <AlertTriangle className="w-3 h-3" />
                  <span>Lead exists for this number</span>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Customer Name *</Label>
              <Input
                value={form.customerName}
                onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
                placeholder="Full name"
                disabled={duplicateCheck.exists}
              />
              {duplicateCheck.exists && duplicateCheck.existingName && (
                <div className="flex items-center gap-1 text-xs text-primary">
                  <UserCheck className="w-3 h-3" />
                  <span>Existing: {duplicateCheck.existingName}</span>
                </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category *</Label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v as LeadCategory }))}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{LEAD_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Value (₹) *</Label><Input type="number" value={form.valueInRupees} onChange={e => setForm(f => ({ ...f, valueInRupees: e.target.value }))} placeholder="85000" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Next Follow-up Date *</Label><Input type="date" value={form.nextFollowUpDate} onChange={e => setForm(f => ({ ...f, nextFollowUpDate: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Next Follow-up Time *</Label><Input type="time" value={form.nextFollowUpTime} onChange={e => setForm(f => ({ ...f, nextFollowUpTime: e.target.value }))} /></div>
          </div>
          <div className="space-y-1.5"><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Additional details..." rows={2} /></div>
          <Button type="submit" className="w-full gradient-primary" disabled={duplicateCheck.exists || duplicateCheck.checking}>
            {duplicateCheck.exists ? "Duplicate — Cannot Save" : "Save Lead"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default LeadForm;
