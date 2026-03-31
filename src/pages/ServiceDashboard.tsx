import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData, LEAD_CATEGORIES, LeadCategory } from "@/contexts/DataContext";
import StatCard from "@/components/StatCard";
import DeleteButton from "@/components/DeleteButton";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Wrench, IndianRupee, Clock, Plus, AlertCircle, MapPin, Phone, Truck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import LoadingError from "@/components/LoadingError";
import { DashboardSkeleton } from "@/components/DashboardSkeleton";

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-warning/10 text-warning",
  assigned: "bg-primary/10 text-primary",
  in_progress: "bg-accent/10 text-accent",
  completed: "bg-success/10 text-success",
};

const ServiceDashboard = () => {
  const { user } = useAuth();
  const { serviceJobs, addServiceJob, updateServiceJob, softDeleteServiceJob, getProfilesByRole, profiles, hasMoreJobs, loadMoreJobs, error, retryLoad, loading } = useData();
  const [dateFilter, setDateFilter] = useState("");
  const [tab, setTab] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [assignDate, setAssignDate] = useState("");
  const [form, setForm] = useState({
    customerName: "", customerPhone: "", address: "", category: "" as LeadCategory | "",
    description: "", dateToAttend: "", value: "", isFOC: false,
    claimPartNo: "", claimReason: "", claimDueDate: "",
  });

  const fieldAgents = getProfilesByRole("field_agent");
  const isAdmin = user?.role === "admin";

  const filteredJobs = useMemo(() => {
    let jobs = serviceJobs;
    if (dateFilter) jobs = jobs.filter(j => j.date_received >= dateFilter);
    if (tab === "deliveries") jobs = jobs.filter(j => j.type === "delivery");
    else if (tab === "services") jobs = jobs.filter(j => j.type === "service");
    else if (tab === "pending") jobs = jobs.filter(j => j.status === "pending");
    else if (tab === "completed") jobs = jobs.filter(j => j.status === "completed");
    return jobs;
  }, [serviceJobs, dateFilter, tab]);

  const todayStr = new Date().toISOString().split("T")[0];
  const todayJobs = serviceJobs.filter(j => j.date_to_attend === todayStr);
  const totalRevenue = serviceJobs.filter(j => !j.is_foc && j.status === "completed").reduce((s, j) => s + Number(j.value), 0);
  const pendingJobs = serviceJobs.filter(j => j.status === "pending");
  const deliveryJobs = serviceJobs.filter(j => j.type === "delivery");

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customerName || !form.customerPhone || !form.category) { toast.error("Fill required fields"); return; }
    try {
      await addServiceJob({
        customer_name: form.customerName, customer_phone: form.customerPhone,
        address: form.address, category: form.category as LeadCategory,
        description: form.description,
        date_to_attend: form.dateToAttend || null, value: form.isFOC ? 0 : Number(form.value),
        is_foc: form.isFOC, status: "pending",
        claim_part_no: form.claimPartNo || null,
        claim_reason: form.claimReason || null,
        claim_due_date: form.claimDueDate || null,
        type: "service",
      });
      toast.success("Service job logged!");
      setForm({ customerName: "", customerPhone: "", address: "", category: "", description: "", dateToAttend: "", value: "", isFOC: false, claimPartNo: "", claimReason: "", claimDueDate: "" });
      setAddOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to add job");
    }
  };

  const handleAssignAgent = async (jobId: string) => {
    if (!selectedAgent) { toast.error("Select a field agent"); return; }
    await updateServiceJob(jobId, {
      assigned_agent: selectedAgent,
      status: "assigned",
      date_to_attend: assignDate || undefined,
    });
    toast.success("Job assigned to field agent!");
    setAssignOpen(null);
    setSelectedAgent("");
    setAssignDate("");
  };

  if (error && serviceJobs.length === 0) return <LoadingError message={error} onRetry={retryLoad} />;
  if (loading && serviceJobs.length === 0) return <DashboardSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Service Dashboard</h1>
          <p className="text-sm text-muted-foreground">Manage service jobs, deliveries & claims</p>
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
        <StatCard title="Pending" value={pendingJobs.length} icon={<AlertCircle className="w-5 h-5" />} />
        <StatCard title="Revenue" value={`₹${totalRevenue.toLocaleString("en-IN")}`} icon={<IndianRupee className="w-5 h-5" />} />
        <StatCard title="Deliveries" value={deliveryJobs.length} icon={<Truck className="w-5 h-5" />} />
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="services">Services</TabsTrigger>
            <TabsTrigger value="deliveries">Deliveries</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
          </TabsList>
        </Tabs>
        <Input type="date" className="w-40" value={dateFilter} onChange={e => setDateFilter(e.target.value)} />
      </div>

      <div className="space-y-3">
        {filteredJobs.map(job => (
          <Card key={job.id} className={`shadow-card ${job.status === "pending" ? "border-warning/30" : job.status === "completed" ? "border-success/30" : ""}`}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold">{job.customer_name}</h3>
                    <Badge className={STATUS_BADGE[job.status] || ""}>{job.status.replace("_", " ")}</Badge>
                    {job.type === "delivery" && <Badge variant="outline" className="text-xs gap-1"><Truck className="w-3 h-3" />Delivery</Badge>}
                    {job.is_foc && <Badge variant="outline" className="text-xs">FOC</Badge>}
                    {job.claim_part_no && <Badge variant="outline" className="text-xs border-destructive/30 text-destructive">Claim</Badge>}
                  </div>
                  <p className="text-sm mt-1">{job.description}</p>
                  <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{job.customer_phone}</span>
                    {job.address && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{job.address}</span>}
                  </div>
                  {job.claim_part_no && (
                    <p className="text-xs text-destructive mt-1">Part: {job.claim_part_no} | {job.claim_reason} | Due: {job.claim_due_date}</p>
                  )}
                </div>
                <div className="text-right shrink-0 space-y-1">
                  <div className="flex items-center gap-1 justify-end">
                    {!job.is_foc && <p className="font-bold">₹{Number(job.value).toLocaleString("en-IN")}</p>}
                    {isAdmin && <DeleteButton onDelete={() => softDeleteServiceJob(job.id)} itemName="Job" />}
                  </div>
                  <p className="text-xs text-muted-foreground">Attend: {job.date_to_attend}</p>
                  {job.status === "pending" && (
                    <Button size="sm" className="gap-1 text-xs h-7" onClick={() => setAssignOpen(job.id)}>
                      <UserPlus className="w-3 h-3" />Assign Agent
                    </Button>
                  )}
                  {job.assigned_agent && (
                    <p className="text-xs text-muted-foreground">
                      Agent: {profiles.find(p => p.id === job.assigned_agent)?.name || "—"}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {filteredJobs.length === 0 && (
          <Card className="shadow-card"><CardContent className="p-8 text-center text-muted-foreground">No jobs found.</CardContent></Card>
        )}
      </div>

      {hasMoreJobs && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMoreJobs}>Load More Jobs</Button>
        </div>
      )}

      <Dialog open={!!assignOpen} onOpenChange={open => { if (!open) setAssignOpen(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Assign Field Agent</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Field Agent *</Label>
              <Select value={selectedAgent} onValueChange={setSelectedAgent}>
                <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
                <SelectContent>
                  {fieldAgents.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Date/Time to Attend</Label>
              <Input type="date" value={assignDate} onChange={e => setAssignDate(e.target.value)} />
            </div>
            <Button className="w-full gradient-primary" onClick={() => assignOpen && handleAssignAgent(assignOpen)}>Assign Job</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ServiceDashboard;
