import { useState, useMemo, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData, LEAD_CATEGORIES, LeadCategory } from "@/contexts/DataContext";
import StatCard from "@/components/StatCard";
import DeleteButton from "@/components/DeleteButton";
import EditJobDialog from "@/components/EditJobDialog";
import ServiceDetailModal from "@/components/ServiceDetailModal";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Wrench, IndianRupee, Clock, Plus, AlertCircle, MapPin, Phone, Truck, UserPlus, CalendarClock, Pencil, ChevronDown, ArrowRightCircle } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import LoadingError from "@/components/LoadingError";
import VoiceReminderCard from "@/components/VoiceReminderCard";
import { DashboardSkeleton } from "@/components/DashboardSkeleton";
import { supabase } from "@/integrations/supabase/client";
import type { ServiceJob } from "@/contexts/DataContext";

type AppServiceRequest = {
  id: string;
  customer_id: string;
  product_description: string;
  issue_description: string;
  contact_phone: string;
  preferred_callback: string | null;
  status: string;
  created_at: string;
  customer_name?: string;
};

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-warning/10 text-warning",
  assigned: "bg-primary/10 text-primary",
  in_progress: "bg-accent/10 text-accent-foreground",
  on_route: "bg-primary/10 text-primary",
  on_site: "bg-accent/10 text-accent-foreground",
  completed: "bg-success/10 text-success",
  rescheduled: "bg-warning/10 text-warning",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending", assigned: "Assigned", in_progress: "In Progress",
  on_route: "On Route", on_site: "On Site", completed: "Completed", rescheduled: "Rescheduled",
};

const ServiceDashboard = () => {
  const { user } = useAuth();
  const { serviceJobs, addServiceJob, updateServiceJob, softDeleteServiceJob, getProfilesByRole, profiles, leads, hasMoreJobs, loadMoreJobs, error, retryLoad, loading } = useData();
  const getLeadOwner = (sourceLeadId: string | null) => {
    if (!sourceLeadId) return null;
    const lead = leads.find(l => l.id === sourceLeadId);
    if (!lead) return null;
    return profiles.find(p => p.id === lead.created_by) || null;
  };
  const [dateFilter, setDateFilter] = useState("");
  const [phoneSearch, setPhoneSearch] = useState("");
  const [tab, setTab] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState<string | null>(null);
  const [savingJob, setSavingJob] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [assignDate, setAssignDate] = useState("");
  const [rescheduleOpen, setRescheduleOpen] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [rescheduleAgent, setRescheduleAgent] = useState("");
  const [photoViewJob, setPhotoViewJob] = useState<string | null>(null);
  const [editJob, setEditJob] = useState<ServiceJob | null>(null);
  const [detailJob, setDetailJob] = useState<ServiceJob | null>(null);
  const [form, setForm] = useState({
    customerName: "", customerPhone: "", address: "", category: "" as LeadCategory | "",
    description: "", dateToAttend: "", value: "", isFOC: false,
    claimPartNo: "", claimReason: "", claimDueDate: "",
  });

  const [appRequests, setAppRequests] = useState<AppServiceRequest[]>([]);
  const [appRequestsLoading, setAppRequestsLoading] = useState(false);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  const fetchAppRequests = useCallback(async () => {
    setAppRequestsLoading(true);
    const { data, error } = await (supabase
      .from("app_service_requests" as any)
      .select("*, elite_customers(customer_name)")
      .order("created_at", { ascending: false }) as any);
    if (error) {
      toast.error("Failed to load app requests");
    } else {
      const rows = (data || []).map((r: any) => ({
        ...r,
        customer_name: r.elite_customers?.customer_name ?? "—",
      }));
      setAppRequests(rows);
    }
    setAppRequestsLoading(false);
  }, []);

  useEffect(() => {
    if (tab === "app_requests") fetchAppRequests();
  }, [tab, fetchAppRequests]);

  const handleConvertToJob = async (req: AppServiceRequest) => {
    if (convertingId) return; // guard against double-click duplicate conversions
    setConvertingId(req.id);
    try {
      await addServiceJob({
        customer_name: req.customer_name ?? "—",
        customer_phone: req.contact_phone,
        description: `${req.product_description} — ${req.issue_description}`,
        category: "others" as LeadCategory,
        value: 0,
        is_foc: false,
        status: "pending",
        type: "service",
      });
      await (supabase
        .from("app_service_requests" as any)
        .update({ status: "in_progress" })
        .eq("id", req.id) as any);
      toast.success("Service job created from app request");
      fetchAppRequests();
    } catch (err: any) {
      toast.error(err.message || "Failed to convert");
    } finally {
      setConvertingId(null);
    }
  };

  const fieldAgents = getProfilesByRole("field_agent");
  const isAdmin = user?.role === "admin";
  const isServiceHead = user?.role === "service_head";
  const canAssign = isAdmin || isServiceHead;

  const filteredJobs = useMemo(() => {
    let jobs = serviceJobs;
    // Service Head can only see jobs that have passed Accounts Approval.
    // Admin sees everything (including pending approval) for visibility.
    if (isServiceHead && !isAdmin) {
      // Service Head sees: all service jobs + accounts-approved deliveries.
      // Self-delivery is fully closed by Accounts and never shown here.
      jobs = jobs.filter(j => {
        if (j.type === "self_delivery") return false;
        if (j.type === "service") return true;
        if (j.type === "delivery") {
          return (j as any).accounts_approval_status === "approved";
        }
        return false;
      });
    }
    if (dateFilter) jobs = jobs.filter(j => j.date_received >= dateFilter);
    if (phoneSearch.trim()) jobs = jobs.filter(j => j.customer_phone?.includes(phoneSearch.trim()));
    if (tab === "deliveries") jobs = jobs.filter(j => j.type === "delivery");
    else if (tab === "services") jobs = jobs.filter(j => j.type === "service");
    else if (tab === "pending") jobs = jobs.filter(j => j.status === "pending");
    else if (tab === "completed") jobs = jobs.filter(j => j.status === "completed");
    else if (tab === "overdue") {
      const today = new Date().toISOString().slice(0, 10);
      jobs = jobs.filter(j =>
        ["pending", "assigned", "on_route", "on_site"].includes(j.status) &&
        j.date_to_attend && j.date_to_attend < today
      );
    }
    return jobs;
  }, [serviceJobs, dateFilter, phoneSearch, tab, isServiceHead, isAdmin]);

  const todayStr = new Date().toISOString().split("T")[0];
  const todayJobs = serviceJobs.filter(j => j.date_to_attend === todayStr);
  const pendingJobs = serviceJobs.filter(j => j.status === "pending");
  const deliveryJobs = serviceJobs.filter(j => j.type === "delivery");

  // Revenue date anchors — use local calendar values, never toISOString()
  // (toISOString converts local→UTC which shifts the date in IST/+5:30 timezones)
  const { monthStart, fyStart, fyMonths } = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const mo = now.getMonth(); // 0-based
    const pad = (n: number) => String(n).padStart(2, "0");

    const ms = `${y}-${pad(mo + 1)}-01`;
    const fyY = mo >= 3 ? y : y - 1;
    const fys = `${fyY}-04-01`;

    const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const months: { key: string; label: string }[] = [];
    let cy = fyY, cm = 3; // start at April (index 3)
    while (cy < y || (cy === y && cm <= mo)) {
      months.push({ key: `${cy}-${pad(cm + 1)}`, label: `${MONTH_NAMES[cm]} ${cy}` });
      cm++;
      if (cm > 11) { cm = 0; cy++; }
    }
    return { monthStart: ms, fyStart: fys, fyMonths: months };
  }, []);

  // Revenue state fetched directly from DB (not paginated)
  const [revMonth, setRevMonth] = useState(0);
  const [revFY, setRevFY] = useState(0);
  const [monthlyBreakdown, setMonthlyBreakdown] = useState<{ key: string; label: string; revenue: number }[]>([]);
  const [revOpen, setRevOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      const { data } = await supabase
        .from("service_jobs")
        .select("value, date_received, completed_at")
        .eq("status", "completed")
        .eq("is_foc", false)
        .eq("type", "service")
        .is("deleted_at", null)
        .gte("date_received", fyStart);
      if (cancelled || !data) return;

      // Cap future completed_at to date_received so no revenue leaks into future months
      const nd = new Date();
      const pad2 = (n: number) => String(n).padStart(2, "0");
      const today = `${nd.getFullYear()}-${pad2(nd.getMonth() + 1)}-${pad2(nd.getDate())}`;
      const currentMonthKey = monthStart.slice(0, 7);
      let fy = 0;
      const byMonth: Record<string, number> = {};
      for (const j of data) {
        const raw = j.completed_at?.slice(0, 10) || j.date_received;
        const d = raw > today ? j.date_received : raw;
        const v = Number(j.value) || 0;
        fy += v;
        const mk = d.slice(0, 7);
        byMonth[mk] = (byMonth[mk] || 0) + v;
      }
      // Derive month total from the same bucket so card always equals table row
      setRevFY(fy);
      setRevMonth(byMonth[currentMonthKey] || 0);
      setMonthlyBreakdown(fyMonths.map(m => ({ ...m, revenue: byMonth[m.key] || 0 })));
    };
    fetch();
    return () => { cancelled = true; };
  }, [fyStart, monthStart, fyMonths]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingJob) return; // guard against double-click duplicate submissions
    if (!form.customerName || !form.customerPhone || !form.category) { toast.error("Fill required fields"); return; }
    // Validate phone: must be exactly 10 digits
    if (!/^\d{10}$/.test(form.customerPhone)) { toast.error("Phone must be exactly 10 digits"); return; }
    setSavingJob(true);
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
    } finally {
      setSavingJob(false);
    }
  };

  const handleAssignAgent = async (jobId: string) => {
    if (assigning) return; // guard against double-click duplicate notifications
    if (!selectedAgent) { toast.error("Select a field agent"); return; }
    setAssigning(true);
    try {
      await updateServiceJob(jobId, {
        assigned_agent: selectedAgent,
        status: "assigned",
        date_to_attend: assignDate || undefined,
      });
      toast.success("Job assigned to field agent!");
      setAssignOpen(null);
      setSelectedAgent("");
      setAssignDate("");
    } catch (err: any) {
      toast.error(err.message || "Failed to assign job");
    } finally {
      setAssigning(false);
    }
  };

  const handleReschedule = async () => {
    if (!rescheduleOpen) return;
    if (!rescheduleDate) { toast.error("Select a new date"); return; }
    if (!rescheduleReason) { toast.error("Select a reason"); return; }

    const job = serviceJobs.find(j => j.id === rescheduleOpen);
    const oldAgentId = job?.assigned_agent;
    const newAgentId = rescheduleAgent || oldAgentId;
    const agentChanged = rescheduleAgent && rescheduleAgent !== oldAgentId;

    try {
      // Save history including agent change
      await supabase.from("reschedule_history" as any).insert({
        job_id: rescheduleOpen,
        original_date: job?.date_to_attend || null,
        new_date: rescheduleDate,
        reason: rescheduleReason + (agentChanged ? ` | Agent changed from ${profiles.find(p => p.id === oldAgentId)?.name || "—"} to ${profiles.find(p => p.id === newAgentId)?.name || "—"}` : ""),
        rescheduled_by: user?.id,
      });

      const updates: any = {
        status: "rescheduled",
        date_to_attend: rescheduleDate,
      };
      if (agentChanged) {
        updates.assigned_agent = newAgentId;
      }

      await updateServiceJob(rescheduleOpen, updates);

      // Notify old agent (job removed)
      if (agentChanged && oldAgentId) {
        await supabase.from("notifications").insert({
          user_id: oldAgentId,
          message: `Job removed from your list: ${job?.customer_name} (reassigned)`,
          type: "warning",
        });
      }

      // Notify new/current agent
      if (newAgentId) {
        await supabase.from("notifications").insert({
          user_id: newAgentId,
          message: `Job rescheduled: ${job?.customer_name} → ${rescheduleDate} (${rescheduleReason})${agentChanged ? " — Newly assigned to you" : ""}`,
          type: "warning",
        });
      }

      toast.success("Job rescheduled!");
      setRescheduleOpen(null);
      setRescheduleDate("");
      setRescheduleReason("");
      setRescheduleAgent("");
    } catch (err: any) {
      toast.error("Failed to reschedule");
    }
  };

  const getJobPhotos = (job: typeof serviceJobs[0]) => {
    return (job.photos || []).filter(p => p.startsWith("http"));
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
                <div className="space-y-1.5">
                  <Label>Phone * (10 digits)</Label>
                  <Input value={form.customerPhone} onChange={e => { const v = e.target.value.replace(/\D/g, "").slice(0, 10); setForm(f => ({ ...f, customerPhone: v })); }} maxLength={10} />
                </div>
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
              <Button type="submit" className="w-full gradient-primary" disabled={savingJob}>{savingJob ? "Saving..." : "Save Service Job"}</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <VoiceReminderCard />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Today's Jobs" value={todayJobs.length} icon={<Clock className="w-5 h-5" />} />
        <StatCard title="Pending" value={pendingJobs.length} icon={<AlertCircle className="w-5 h-5" />} />
        <StatCard
          title="Service Revenue (Month)"
          value={`₹${revMonth.toLocaleString("en-IN")}`}
          subtitle={`FY Total: ₹${revFY.toLocaleString("en-IN")}`}
          icon={<IndianRupee className="w-5 h-5" />}
        />
        <StatCard title="Deliveries" value={deliveryJobs.length} icon={<Truck className="w-5 h-5" />} />
      </div>

      {/* Admin-only: month-wise revenue breakdown */}
      {isAdmin && monthlyBreakdown.length > 0 && (
        <Collapsible open={revOpen} onOpenChange={setRevOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 text-xs">
              <IndianRupee className="w-3.5 h-3.5" />
              Month-wise Revenue
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${revOpen ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="shadow-card mt-2">
              <CardContent className="p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Service Revenue by Month (Current FY)</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-1.5 pr-4 font-medium text-muted-foreground">Month</th>
                        <th className="text-right py-1.5 font-medium text-muted-foreground">Revenue</th>
                        <th className="text-right py-1.5 pl-4 font-medium text-muted-foreground">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyBreakdown.map(m => (
                        <tr key={m.key} className={`border-b border-border/50 ${m.key === monthStart.slice(0, 7) ? "bg-primary/5 font-semibold" : ""}`}>
                          <td className="py-1.5 pr-4">{m.label}{m.key === monthStart.slice(0, 7) ? " ●" : ""}</td>
                          <td className="text-right tabular-nums">₹{m.revenue.toLocaleString("en-IN")}</td>
                          <td className="text-right pl-4 text-muted-foreground tabular-nums">
                            {revFY > 0 ? `${((m.revenue / revFY) * 100).toFixed(1)}%` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border font-bold">
                        <td className="pt-2">FY Total</td>
                        <td className="text-right tabular-nums pt-2">₹{revFY.toLocaleString("en-IN")}</td>
                        <td className="text-right pl-4 pt-2">100%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      )}

      <div className="flex gap-3 flex-wrap items-center">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="overdue" className="data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground">Overdue</TabsTrigger>
            <TabsTrigger value="services">Services</TabsTrigger>
            <TabsTrigger value="deliveries">Deliveries</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
            <TabsTrigger value="app_requests" className="gap-1">
              <Phone className="w-3 h-3" />App Requests
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Input
          type="tel"
          placeholder="Search by phone…"
          className="w-40"
          value={phoneSearch}
          onChange={e => setPhoneSearch(e.target.value.replace(/\D/g, "").slice(0, 10))}
          maxLength={10}
        />
        <Input type="date" className="w-40" value={dateFilter} onChange={e => setDateFilter(e.target.value)} />
      </div>

      {tab === "app_requests" ? (
        <div className="space-y-3">
          {appRequestsLoading ? (
            <Card className="shadow-card"><CardContent className="p-8 text-center text-muted-foreground">Loading…</CardContent></Card>
          ) : appRequests.length === 0 ? (
            <Card className="shadow-card"><CardContent className="p-8 text-center text-muted-foreground">No app service requests.</CardContent></Card>
          ) : appRequests.map(req => {
            const statusCls =
              req.status === "open"
                ? "bg-warning/10 text-warning"
                : req.status === "in_progress"
                ? "bg-primary/10 text-primary"
                : "bg-success/10 text-success";
            const statusLabel =
              req.status === "open" ? "Open" : req.status === "in_progress" ? "In Progress" : "Resolved";
            return (
              <Card key={req.id} className="shadow-card">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold">{req.customer_name}</h3>
                        <Badge className={statusCls}>{statusLabel}</Badge>
                      </div>
                      <p className="text-sm font-medium mt-1">{req.product_description}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">{req.issue_description}</p>
                      <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{req.contact_phone}</span>
                        {req.preferred_callback && (
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />Callback: {req.preferred_callback}</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{new Date(req.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
                    </div>
                    {req.status === "open" && canAssign && (
                      <Button
                        size="sm"
                        className="gap-1 text-xs h-8 shrink-0"
                        disabled={convertingId === req.id}
                        onClick={() => handleConvertToJob(req)}
                      >
                        <ArrowRightCircle className="w-3.5 h-3.5" />
                        {convertingId === req.id ? "Converting…" : "Convert to Job"}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
      <div className="space-y-3">
        {filteredJobs.map(job => {
          const photos = getJobPhotos(job);
          return (
            <Card key={job.id} className={`shadow-card cursor-pointer hover:border-primary/40 hover:shadow-md transition-all ${job.status === "pending" ? "border-warning/30" : job.status === "completed" ? "border-success/30" : ""}`} onClick={() => setDetailJob(job)}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold">{job.customer_name}</h3>
                      <Badge className={STATUS_BADGE[job.status] || ""}>{STATUS_LABEL[job.status] || job.status}</Badge>
                      {job.type === "delivery" && <Badge variant="outline" className="text-xs gap-1"><Truck className="w-3 h-3" />Delivery</Badge>}
                      {job.is_foc && <Badge variant="outline" className="text-xs">FOC</Badge>}
                      {job.claim_part_no && <Badge variant="outline" className="text-xs border-destructive/30 text-destructive">Claim</Badge>}
                      <Pencil className="w-3 h-3 text-muted-foreground" />
                    </div>
                    <p className="text-sm mt-1">{job.description}</p>
                    <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{job.customer_phone}</span>
                      {job.address && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{job.address}</span>}
                    </div>
                    {job.claim_part_no && (
                      <p className="text-xs text-destructive mt-1">Part: {job.claim_part_no} | {job.claim_reason} | Due: {job.claim_due_date}</p>
                    )}
                    {job.remarks && (
                      <div className="mt-2 p-2 rounded-md bg-accent/10 border border-accent/30">
                        <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide flex items-center gap-1">
                          💬 Field Agent Remarks
                        </p>
                        <p className="text-xs text-foreground mt-0.5 whitespace-pre-wrap">{job.remarks}</p>
                      </div>
                    )}
                    {photos.length > 0 && (
                      <div className="flex gap-1.5 mt-2 flex-wrap">
                        {photos.slice(0, 3).map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                            <img src={url} alt="" className="w-12 h-12 rounded object-cover border border-border" />
                          </a>
                        ))}
                        {photos.length > 3 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setPhotoViewJob(job.id); }}
                            className="w-12 h-12 rounded border border-border bg-muted flex items-center justify-center text-xs text-muted-foreground"
                          >+{photos.length - 3}</button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0 space-y-1" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1 justify-end">
                      {!job.is_foc && <p className="font-bold">₹{Number(job.value).toLocaleString("en-IN")}</p>}
                      {isAdmin && <DeleteButton onDelete={() => softDeleteServiceJob(job.id)} itemName="Job" />}
                    </div>
                    <p className="text-xs text-muted-foreground">Attend: {job.date_to_attend}</p>
                    {job.status === "pending" && canAssign && (
                      <Button size="sm" className="gap-1 text-xs h-7" onClick={() => setAssignOpen(job.id)}>
                        <UserPlus className="w-3 h-3" />Assign Agent
                      </Button>
                    )}
                    {canAssign && !["completed"].includes(job.status) && (
                      <Button size="sm" variant="outline" className="gap-1 text-xs h-7" onClick={() => { setRescheduleOpen(job.id); setRescheduleAgent(job.assigned_agent || ""); }}>
                        <CalendarClock className="w-3 h-3" />Reschedule
                      </Button>
                    )}
                    {job.assigned_agent && (
                      <p className="text-xs text-muted-foreground">
                        Agent: {profiles.find(p => p.id === job.assigned_agent)?.name || "—"}
                      </p>
                    )}
                    {(() => {
                      const owner = getLeadOwner(job.source_lead_id);
                      return owner ? (
                        <p className="text-xs text-muted-foreground">
                          Salesperson: <span className="font-medium text-foreground">{owner.name}</span>
                          {owner.phone_number && <> · {owner.phone_number}</>}
                        </p>
                      ) : null;
                    })()}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {filteredJobs.length === 0 && (
          <Card className="shadow-card"><CardContent className="p-8 text-center text-muted-foreground">No jobs found.</CardContent></Card>
        )}
      </div>
      )}

      {tab !== "app_requests" && hasMoreJobs && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMoreJobs}>Load More Jobs</Button>
        </div>
      )}

      {/* Assign dialog */}
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
            <Button className="w-full gradient-primary" disabled={assigning} onClick={() => assignOpen && handleAssignAgent(assignOpen)}>{assigning ? "Assigning..." : "Assign Job"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reschedule dialog with agent change */}
      <Dialog open={!!rescheduleOpen} onOpenChange={open => { if (!open) setRescheduleOpen(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Reschedule Job</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>New Date *</Label>
              <Input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Change Field Agent (optional)</Label>
              <Select value={rescheduleAgent} onValueChange={setRescheduleAgent}>
                <SelectTrigger><SelectValue placeholder="Keep current agent" /></SelectTrigger>
                <SelectContent>
                  {fieldAgents.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Reason *</Label>
              <Select value={rescheduleReason} onValueChange={setRescheduleReason}>
                <SelectTrigger><SelectValue placeholder="Select reason" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Client not available">Client not available</SelectItem>
                  <SelectItem value="Manpower issue">Manpower issue</SelectItem>
                  <SelectItem value="Part not available">Part not available</SelectItem>
                  <SelectItem value="Weather/Transport issue">Weather/Transport issue</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full gradient-primary" onClick={handleReschedule}>Reschedule Job</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Photo viewer dialog */}
      <Dialog open={!!photoViewJob} onOpenChange={open => { if (!open) setPhotoViewJob(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Job Photos</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {photoViewJob && getJobPhotos(serviceJobs.find(j => j.id === photoViewJob)!).map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                <img src={url} alt={`Photo ${i + 1}`} className="w-full rounded-lg object-cover border border-border" />
              </a>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit job dialog */}
      <EditJobDialog job={editJob} open={!!editJob} onOpenChange={open => { if (!open) setEditJob(null); }} />

      {/* Service detail modal (opens on card click) */}
      <ServiceDetailModal
        job={detailJob}
        open={!!detailJob}
        onOpenChange={(open) => { if (!open) setDetailJob(null); }}
        onEdit={(j) => { setDetailJob(null); setEditJob(j); }}
        onAssign={(jobId) => { setDetailJob(null); setAssignOpen(jobId); }}
        onReschedule={(jobId, currentAgent) => {
          setDetailJob(null);
          setRescheduleOpen(jobId);
          setRescheduleAgent(currentAgent || "");
        }}
      />
    </div>
  );
};

export default ServiceDashboard;
