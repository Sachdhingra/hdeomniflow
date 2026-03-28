import { useState, useMemo } from "react";
import { useData } from "@/contexts/DataContext";
import StatCard from "@/components/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Wrench, IndianRupee, Clock, CheckCircle, Plus, AlertCircle, MapPin, Phone } from "lucide-react";
import { toast } from "sonner";
import { LEAD_CATEGORIES, LeadCategory } from "@/contexts/DataContext";

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-warning/10 text-warning",
  assigned: "bg-primary/10 text-primary",
  in_progress: "bg-accent/10 text-accent",
  completed: "bg-success/10 text-success",
};

const ServiceDashboard = () => {
  const { serviceJobs, addServiceJob, updateServiceJob } = useData();
  const [dateFilter, setDateFilter] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({
    customerName: "", customerPhone: "", address: "", category: "" as LeadCategory | "",
    description: "", dateToAttend: "", value: "", isFOC: false,
    claimPartNo: "", claimReason: "", claimDueDate: "",
  });

  const filteredJobs = useMemo(() => {
    if (!dateFilter) return serviceJobs;
    return serviceJobs.filter(j => j.dateReceived >= dateFilter);
  }, [serviceJobs, dateFilter]);

  const todayStr = new Date().toISOString().split("T")[0];
  const todayJobs = serviceJobs.filter(j => j.dateToAttend === todayStr);
  const totalRevenue = filteredJobs.filter(j => !j.isFOC).reduce((s, j) => s + j.value, 0);
  const pendingClaims = serviceJobs.filter(j => j.claimPartNo);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customerName || !form.customerPhone || !form.category) {
      toast.error("Fill required fields"); return;
    }
    addServiceJob({
      customerName: form.customerName, customerPhone: form.customerPhone,
      address: form.address, category: form.category as LeadCategory,
      description: form.description, dateReceived: todayStr,
      dateToAttend: form.dateToAttend, value: form.isFOC ? 0 : Number(form.value),
      isFOC: form.isFOC, status: "pending", assignedAgent: "",
      claimPartNo: form.claimPartNo || undefined,
      claimReason: form.claimReason || undefined,
      claimDueDate: form.claimDueDate || undefined,
    });
    toast.success("Service job logged!");
    setForm({ customerName: "", customerPhone: "", address: "", category: "", description: "", dateToAttend: "", value: "", isFOC: false, claimPartNo: "", claimReason: "", claimDueDate: "" });
    setAddOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Service Dashboard</h1>
          <p className="text-sm text-muted-foreground">Manage service jobs, claims & revenue</p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button className="gradient-primary gap-2"><Plus className="w-4 h-4" />Log Service</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>New Service Job</DialogTitle></DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Customer Name *</Label><Input value={form.customerName} onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))} /></div>
                <div className="space-y-1.5"><Label>Phone *</Label><Input value={form.customerPhone} onChange={e => setForm(f => ({ ...f, customerPhone: e.target.value }))} /></div>
              </div>
              <div className="space-y-1.5"><Label>Address</Label><Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Category *</Label>
                  <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v as LeadCategory }))}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{LEAD_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>Date to Attend</Label><Input type="date" value={form.dateToAttend} onChange={e => setForm(f => ({ ...f, dateToAttend: e.target.value }))} /></div>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={form.isFOC} onCheckedChange={v => setForm(f => ({ ...f, isFOC: v }))} />
                <Label>FOC (Free of Cost)</Label>
              </div>
              {!form.isFOC && (
                <div className="space-y-1.5"><Label>Value (₹)</Label><Input type="number" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} /></div>
              )}
              <div className="space-y-1.5"><Label>Description</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} /></div>

              <div className="border-t pt-3 space-y-3">
                <p className="text-sm font-semibold text-muted-foreground">Claim Details (if applicable)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label>Part No.</Label><Input value={form.claimPartNo} onChange={e => setForm(f => ({ ...f, claimPartNo: e.target.value }))} /></div>
                  <div className="space-y-1.5"><Label>Due Date</Label><Input type="date" value={form.claimDueDate} onChange={e => setForm(f => ({ ...f, claimDueDate: e.target.value }))} /></div>
                </div>
                <div className="space-y-1.5"><Label>Reason for Part</Label><Input value={form.claimReason} onChange={e => setForm(f => ({ ...f, claimReason: e.target.value }))} /></div>
              </div>

              <Button type="submit" className="w-full gradient-primary">Save Service Job</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Today's Jobs" value={todayJobs.length} icon={<Clock className="w-5 h-5" />} />
        <StatCard title="Total Jobs" value={filteredJobs.length} icon={<Wrench className="w-5 h-5" />} />
        <StatCard title="Revenue" value={`₹${totalRevenue.toLocaleString("en-IN")}`} icon={<IndianRupee className="w-5 h-5" />} />
        <StatCard title="Pending Claims" value={pendingClaims.length} icon={<AlertCircle className="w-5 h-5" />} />
      </div>

      <div className="flex gap-3">
        <Input type="date" className="w-40" value={dateFilter} onChange={e => setDateFilter(e.target.value)} />
      </div>

      <div className="space-y-3">
        {filteredJobs.map(job => (
          <Card key={job.id} className="shadow-card">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold">{job.customerName}</h3>
                    <Badge className={STATUS_BADGE[job.status]}>{job.status.replace("_", " ")}</Badge>
                    {job.isFOC && <Badge variant="outline" className="text-xs">FOC</Badge>}
                    {job.claimPartNo && <Badge variant="outline" className="text-xs border-destructive/30 text-destructive">Claim</Badge>}
                  </div>
                  <p className="text-sm mt-1">{job.description}</p>
                  <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{job.customerPhone}</span>
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{job.address}</span>
                  </div>
                  {job.claimPartNo && (
                    <p className="text-xs text-destructive mt-1">Part: {job.claimPartNo} | {job.claimReason} | Due: {job.claimDueDate}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  {!job.isFOC && <p className="font-bold">₹{job.value.toLocaleString("en-IN")}</p>}
                  <p className="text-xs text-muted-foreground">Attend: {job.dateToAttend}</p>
                  <Select value={job.status} onValueChange={v => updateServiceJob(job.id, { status: v as any })}>
                    <SelectTrigger className="w-28 h-7 text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="assigned">Assigned</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default ServiceDashboard;
