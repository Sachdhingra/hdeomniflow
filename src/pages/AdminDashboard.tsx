import { useState, useMemo } from "react";
import { useData, LEAD_CATEGORIES } from "@/contexts/DataContext";
import { useAuth, User } from "@/contexts/AuthContext";
import StatCard from "@/components/StatCard";
import CsvImport from "@/components/CsvImport";
import AdminExport from "@/components/AdminExport";
import AdminDeletedRecords from "@/components/AdminDeletedRecords";
import DeleteButton from "@/components/DeleteButton";
import AgentTrackingTimeline from "@/components/AgentTrackingTimeline";
import AdminSalesTargets from "@/components/AdminSalesTargets";
import AuditDashboard from "@/components/AuditDashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, Wrench, IndianRupee, TrendingUp, MapPin, BarChart3, UserPlus, Trophy, Truck, KeyRound, Ban, CheckCircle, Trash2, Loader2, Download, Archive, Locate, Search, MessageSquare, Send, ShieldAlert, Target } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import LoadingError from "@/components/LoadingError";
import { DashboardSkeleton } from "@/components/DashboardSkeleton";

const MessageLogsPanel = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [triggerLoading, setTriggerLoading] = useState(false);

  const fetchLogs = async () => {
    setLogsLoading(true);
    const { data } = await supabase.from("message_logs").select("*").order("created_at", { ascending: false }).limit(50);
    setLogs(data || []);
    setLogsLoading(false);
  };

  const triggerSummary = async () => {
    setTriggerLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("daily-summary");
      if (error) throw error;
      toast.success(`Summary sent to ${data?.sent || 0} users`);
      fetchLogs();
    } catch (e: any) {
      toast.error("Failed: " + (e.message || "Unknown error"));
    }
    setTriggerLoading(false);
  };

  useState(() => { fetchLogs(); });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">WhatsApp Message Logs</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={fetchLogs} disabled={logsLoading}>
            {logsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Refresh"}
          </Button>
          <Button size="sm" onClick={triggerSummary} disabled={triggerLoading} className="gap-1">
            {triggerLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send Now
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">
          Auto-scheduled daily at 7:45 PM. Mode: <Badge variant="outline">{logs[0]?.provider || "web"}</Badge>
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Recipient</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No messages yet</TableCell></TableRow>
            )}
            {logs.map(log => (
              <TableRow key={log.id}>
                <TableCell className="font-medium">{log.recipient_name || "—"}</TableCell>
                <TableCell>{log.phone || "—"}</TableCell>
                <TableCell>
                  <Badge variant={log.status === "sent" ? "default" : log.status === "failed" ? "destructive" : "secondary"}>
                    {log.status}
                  </Badge>
                  {log.retry_count > 0 && <span className="text-xs text-muted-foreground ml-1">(retry: {log.retry_count})</span>}
                </TableCell>
                <TableCell>{log.provider}</TableCell>
                <TableCell className="text-xs">{new Date(log.created_at).toLocaleString("en-IN")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

const AdminDashboard = () => {
  const { leads, serviceJobs, siteVisits, profiles, getProfilesByRole, softDeleteLead, softDeleteServiceJob, softDeleteSiteVisit, summaryLoading, summary, error, retryLoad, loading } = useData();
  const { allProfiles, refreshProfiles } = useAuth();
  const [tab, setTab] = useState("overview");
  const [staffOpen, setStaffOpen] = useState(false);
  const [newStaff, setNewStaff] = useState({ name: "", role: "", password: "", phone_number: "" });
  const [resetPwOpen, setResetPwOpen] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [trackingAgent, setTrackingAgent] = useState<string | null>(null);
  const [nameSearch, setNameSearch] = useState("");
  const [phoneSearch, setPhoneSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [assignedFilter, setAssignedFilter] = useState("all");

  const filteredLeads = useMemo(() => {
    let result = leads;
    if (nameSearch.trim()) {
      const q = nameSearch.toLowerCase();
      result = result.filter(l => l.customer_name.toLowerCase().includes(q));
    }
    if (phoneSearch.trim()) {
      result = result.filter(l => l.customer_phone.includes(phoneSearch.trim()));
    }
    if (statusFilter !== "all") result = result.filter(l => l.status === statusFilter);
    if (categoryFilter !== "all") result = result.filter(l => l.category === categoryFilter);
    if (assignedFilter !== "all") result = result.filter(l => l.assigned_to === assignedFilter);
    return result;
  }, [leads, nameSearch, phoneSearch, statusFilter, categoryFilter, assignedFilter]);

  const totalPipeline = leads.reduce((s, l) => s + Number(l.value_in_rupees), 0);
  const wonValue = leads.filter(l => l.status === "won").reduce((s, l) => s + Number(l.value_in_rupees), 0);
  const serviceRevenue = serviceJobs.filter(j => !j.is_foc && j.status === "completed" && j.type === "service").reduce((s, j) => s + Number(j.value), 0);
  const todayStr = new Date().toISOString().split("T")[0];
  const overdueLeads = leads.filter(l => l.status === "overdue");
  const deliveryJobs = serviceJobs.filter(j => j.type === "delivery");

  const salesProfiles = getProfilesByRole("sales");
  const salesPerformance = salesProfiles.map(s => {
    const sLeads = leads.filter(l => l.assigned_to === s.id);
    const won = sLeads.filter(l => l.status === "won");
    return {
      ...s, totalLeads: sLeads.length, wonLeads: won.length,
      wonValue: won.reduce((sum, l) => sum + Number(l.value_in_rupees), 0),
      conversion: sLeads.length ? Math.round((won.length / sLeads.length) * 100) : 0,
    };
  }).sort((a, b) => b.wonValue - a.wonValue);

  const fieldProfiles = getProfilesByRole("field_agent");
  const fieldPerformance = fieldProfiles.map(s => {
    const jobs = serviceJobs.filter(j => j.assigned_agent === s.id);
    const completed = jobs.filter(j => j.status === "completed").length;
    const pending = jobs.filter(j => !["completed"].includes(j.status)).length;
    return {
      ...s,
      totalJobs: jobs.length,
      completedJobs: completed,
      pendingJobs: pending,
      completionRate: jobs.length ? Math.round((completed / jobs.length) * 100) : 0,
    };
  });

  const siteProfiles = getProfilesByRole("site_agent");
  const sitePerformance = siteProfiles.map(s => {
    const visits = siteVisits.filter(v => v.agent_id === s.id);
    return {
      ...s, totalVisits: visits.length, totalLeads: leads.filter(l => l.source === "site_agent" && l.assigned_to === s.id).length,
      todayVisits: visits.filter(v => v.date === todayStr).length,
    };
  });

  const categoryStats = LEAD_CATEGORIES.map(c => ({
    ...c,
    count: leads.filter(l => l.category === c.value).length,
    totalValue: leads.filter(l => l.category === c.value).reduce((s, l) => s + Number(l.value_in_rupees), 0),
  })).filter(c => c.count > 0);

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStaff.name || !newStaff.role || !newStaff.password) { toast.error("Fill all fields"); return; }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const res = await supabase.functions.invoke("create-user", {
        body: { name: newStaff.name, password: newStaff.password, role: newStaff.role, phone_number: newStaff.phone_number },
      });
      if (res.error) throw new Error(res.error.message || "Failed to create user");
      if (res.data?.error) throw new Error(res.data.error);
      toast.success(`${newStaff.name} added as ${newStaff.role}!`);
      setNewStaff({ name: "", role: "", password: "", phone_number: "" });
      setStaffOpen(false);
      await refreshProfiles();
    } catch (err: any) {
      toast.error(err.message || "Failed to add staff");
    }
  };

  const handleUserAction = async (action: string, userId: string, password?: string) => {
    setActionLoading(userId + action);
    try {
      const body: any = { action, user_id: userId };
      if (password) body.password = password;
      const res = await supabase.functions.invoke("manage-user", { body });
      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);
      toast.success(`User ${action === "reset_password" ? "password reset" : action === "disable" ? "disabled" : action === "enable" ? "enabled" : "deleted"} successfully`);
      if (action === "reset_password") { setResetPwOpen(null); setNewPassword(""); }
      await refreshProfiles();
    } catch (err: any) {
      toast.error(err.message || "Action failed");
    }
    setActionLoading(null);
  };

  const [editPhoneUser, setEditPhoneUser] = useState<string | null>(null);
  const [editPhoneValue, setEditPhoneValue] = useState("");

  const allUsersWithStatus = allProfiles.map(p => {
    const profile = profiles.find(pr => pr.id === p.id);
    return { ...p, active: profile?.active ?? true, phone_number: profile?.phone_number || "" };
  });

  const handleUpdatePhone = async (userId: string) => {
    const digits = editPhoneValue.replace(/\D/g, "");
    if (digits.length === 10) {
      // Auto-prepend 91
      const phone = "91" + digits;
      setActionLoading(userId + "phone");
      try {
        const res = await supabase.functions.invoke("manage-user", {
          body: { action: "update_phone", user_id: userId, phone_number: phone },
        });
        if (res.error) throw new Error(res.error.message);
        if (res.data?.error) throw new Error(res.data.error);
        toast.success("Phone number updated!");
        setEditPhoneUser(null);
        setEditPhoneValue("");
        await refreshProfiles();
      } catch (err: any) {
        toast.error(err.message || "Failed to update phone");
      }
      setActionLoading(null);
    } else if (digits.length === 12 && digits.startsWith("91")) {
      setActionLoading(userId + "phone");
      try {
        const res = await supabase.functions.invoke("manage-user", {
          body: { action: "update_phone", user_id: userId, phone_number: digits },
        });
        if (res.error) throw new Error(res.error.message);
        if (res.data?.error) throw new Error(res.data.error);
        toast.success("Phone number updated!");
        setEditPhoneUser(null);
        setEditPhoneValue("");
        await refreshProfiles();
      } catch (err: any) {
        toast.error(err.message || "Failed to update phone");
      }
      setActionLoading(null);
    } else {
      toast.error("Enter 10-digit number (or 91XXXXXXXXXX)");
    }
  };

  if (error && leads.length === 0) return <LoadingError message={error} onRetry={retryLoad} />;
  if (summaryLoading && leads.length === 0) return <DashboardSkeleton />;

  return (
    <div className="space-y-6">
      {error && <LoadingError message={error} onRetry={retryLoad} />}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          <p className="text-sm text-muted-foreground">Complete business overview & management</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <CsvImport salesProfiles={allProfiles.filter(p => p.role === "sales") as User[]} />
          <Dialog open={staffOpen} onOpenChange={setStaffOpen}>
            <DialogTrigger asChild>
              <Button className="gradient-primary gap-2"><UserPlus className="w-4 h-4" />Add Staff</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add New Staff</DialogTitle></DialogHeader>
              <form onSubmit={handleAddStaff} className="space-y-4">
                <div className="space-y-1.5"><Label>Username *</Label><Input placeholder="Enter unique name" value={newStaff.name} onChange={e => setNewStaff(f => ({ ...f, name: e.target.value }))} /></div>
                <div className="space-y-1.5"><Label>Password *</Label><Input type="password" value={newStaff.password} onChange={e => setNewStaff(f => ({ ...f, password: e.target.value }))} /></div>
                <div className="space-y-1.5">
                  <Label>Role *</Label>
                  <Select value={newStaff.role} onValueChange={v => setNewStaff(f => ({ ...f, role: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="sales">Sales</SelectItem>
                      <SelectItem value="service_head">Service Head</SelectItem>
                      <SelectItem value="field_agent">Field Agent</SelectItem>
                      <SelectItem value="site_agent">Site Agent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>Phone (91XXXXXXXXXX)</Label><Input placeholder="91XXXXXXXXXX" value={newStaff.phone_number} onChange={e => setNewStaff(f => ({ ...f, phone_number: e.target.value.replace(/\D/g, "").slice(0, 12) }))} /></div>
                <Button type="submit" className="w-full gradient-primary">Add Staff Member</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {overdueLeads.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-3 flex items-center gap-3">
            <span className="text-destructive font-bold animate-pulse">⚠️ {overdueLeads.length} OVERDUE leads across the system!</span>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Sales Leads" value={summaryLoading ? "..." : summary.totalLeads} icon={<Users className="w-5 h-5" />} />
        <StatCard title="Pipeline Value" value={summaryLoading ? "..." : `₹${(summary.totalPipelineValue / 1000).toFixed(0)}K`} icon={<IndianRupee className="w-5 h-5" />} />
        <StatCard title="Won Value" value={`₹${(wonValue / 1000).toFixed(0)}K`} icon={<TrendingUp className="w-5 h-5" />} trendUp trend="Closed" />
        <StatCard title="Service Revenue" value={`₹${serviceRevenue.toLocaleString("en-IN")}`} icon={<Wrench className="w-5 h-5" />} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="leads" className="gap-1"><Search className="w-3 h-3" />Leads</TabsTrigger>
          <TabsTrigger value="sales">Sales Team</TabsTrigger>
          <TabsTrigger value="service">Service</TabsTrigger>
          <TabsTrigger value="field">Field Agents</TabsTrigger>
          <TabsTrigger value="site">Site Agents</TabsTrigger>
          <TabsTrigger value="targets" className="gap-1"><Target className="w-3 h-3" />Targets</TabsTrigger>
          <TabsTrigger value="staff">User Mgmt</TabsTrigger>
          <TabsTrigger value="export" className="gap-1"><Download className="w-3 h-3" />Export</TabsTrigger>
          <TabsTrigger value="deleted" className="gap-1"><Archive className="w-3 h-3" />Deleted</TabsTrigger>
          <TabsTrigger value="messages" className="gap-1"><MessageSquare className="w-3 h-3" />Messages</TabsTrigger>
          <TabsTrigger value="audit" className="gap-1"><ShieldAlert className="w-3 h-3" />Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="shadow-card">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4 text-primary" />Sales Pipeline</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {(["new", "contacted", "follow_up", "negotiation", "overdue", "won", "lost"] as const).map(status => {
                  const count = leads.filter(l => l.status === status).length;
                  return (
                    <div key={status} className={`flex items-center justify-between text-sm ${status === "overdue" ? "text-destructive font-medium" : ""}`}>
                      <span className="capitalize">{status.replace("_", " ")}</span>
                      <Badge variant="outline" className={status === "overdue" ? "bg-destructive/10 text-destructive" : ""}>{count}</Badge>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
            <Card className="shadow-card">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Wrench className="w-4 h-4 text-primary" />Service & Delivery</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm"><span>Total Jobs</span><Badge variant="outline">{serviceJobs.length}</Badge></div>
                <div className="flex justify-between text-sm"><span>Deliveries</span><Badge variant="outline">{deliveryJobs.length}</Badge></div>
                <div className="flex justify-between text-sm"><span>Pending</span><Badge className="bg-warning/10 text-warning">{serviceJobs.filter(j => j.status === "pending").length}</Badge></div>
                <div className="flex justify-between text-sm"><span>Completed</span><Badge className="bg-success/10 text-success">{serviceJobs.filter(j => j.status === "completed").length}</Badge></div>
              </CardContent>
            </Card>
            <Card className="shadow-card">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><MapPin className="w-4 h-4 text-primary" />Site Agents</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm"><span>Total Visits</span><Badge variant="outline">{siteVisits.length}</Badge></div>
                <div className="flex justify-between text-sm"><span>Today</span><Badge variant="outline">{siteVisits.filter(v => v.date === todayStr).length}</Badge></div>
                <div className="flex justify-between text-sm"><span>Site Leads</span><Badge variant="outline">{leads.filter(l => l.source === "site_agent").length}</Badge></div>
              </CardContent>
            </Card>
          </div>
          <Card className="shadow-card">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" />Category Breakdown</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {categoryStats.map(c => (
                  <div key={c.value} className="p-3 bg-muted/50 rounded-lg text-center">
                    <p className="text-sm font-medium">{c.label}</p>
                    <p className="text-lg font-bold">{c.count}</p>
                    <p className="text-xs text-muted-foreground">₹{(c.totalValue / 1000).toFixed(0)}K</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="leads" className="space-y-4 mt-4">
          <Card className="shadow-card">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Search className="w-4 h-4 text-primary" />Search & Filter Leads ({filteredLeads.length})</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input placeholder="Search by name..." value={nameSearch} onChange={e => setNameSearch(e.target.value)} className="pl-9" />
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input placeholder="Search by phone..." value={phoneSearch} onChange={e => setPhoneSearch(e.target.value)} className="pl-9" />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {(["new", "contacted", "follow_up", "negotiation", "won", "lost", "overdue"] as const).map(s => (
                      <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {LEAD_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={assignedFilter} onValueChange={setAssignedFilter}>
                  <SelectTrigger><SelectValue placeholder="Assigned To" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Staff</SelectItem>
                    {allProfiles.filter(p => p.role === "sales" || p.role === "site_agent").map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Assigned</TableHead>
                      <TableHead>Follow-up</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLeads.slice(0, 50).map(l => (
                      <TableRow key={l.id}>
                        <TableCell className="font-medium">{l.customer_name}</TableCell>
                        <TableCell>{LEAD_CATEGORIES.find(c => c.value === l.category)?.label}</TableCell>
                        <TableCell>₹{Number(l.value_in_rupees).toLocaleString("en-IN")}</TableCell>
                        <TableCell><Badge variant="outline" className="capitalize">{l.status.replace("_", " ")}</Badge></TableCell>
                        <TableCell>{profiles.find(p => p.id === l.assigned_to)?.name || "—"}</TableCell>
                        <TableCell className="text-xs">{l.next_follow_up_date || "—"}</TableCell>
                      </TableRow>
                    ))}
                    {filteredLeads.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No leads match your filters.</TableCell></TableRow>
                    )}
                    {filteredLeads.length > 50 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-2 text-xs">Showing first 50 of {filteredLeads.length} results</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sales" className="space-y-4 mt-4">
          <Card className="shadow-card">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Trophy className="w-4 h-4 text-warning" />Sales Leaderboard</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {salesPerformance.map((sp, idx) => (
                  <div key={sp.id} className={`flex items-center gap-3 p-3 rounded-lg ${idx === 0 ? "bg-warning/10 border border-warning/20" : "bg-muted/50"}`}>
                    <span className={`text-lg font-bold ${idx === 0 ? "text-warning" : "text-muted-foreground"}`}>#{idx + 1}</span>
                    <div className="flex-1">
                      <p className="font-medium">{sp.name}</p>
                      <div className="flex gap-4 text-xs text-muted-foreground mt-0.5">
                        <span>Leads: {sp.totalLeads}</span><span>Won: {sp.wonLeads}</span><span>Conversion: {sp.conversion}%</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-success">₹{(sp.wonValue / 1000).toFixed(0)}K</p>
                    </div>
                  </div>
                ))}
                {salesPerformance.length === 0 && <p className="text-muted-foreground text-sm text-center py-4">No sales staff yet.</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="service" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard title="Total Jobs" value={serviceJobs.filter(j => j.type === "service").length} icon={<Wrench className="w-5 h-5" />} />
            <StatCard title="Deliveries" value={deliveryJobs.length} icon={<Truck className="w-5 h-5" />} />
            <StatCard title="Completed" value={serviceJobs.filter(j => j.status === "completed").length} icon={<TrendingUp className="w-5 h-5" />} />
            <StatCard title="Revenue" value={`₹${serviceRevenue.toLocaleString("en-IN")}`} icon={<IndianRupee className="w-5 h-5" />} />
          </div>
        </TabsContent>

        <TabsContent value="field" className="space-y-4 mt-4">
          <Card className="shadow-card">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Wrench className="w-4 h-4 text-primary" />Field Agent Performance</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {fieldPerformance.map(fp => (
                  <div key={fp.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                    <div className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center text-primary-foreground text-sm font-bold">
                      {fp.name.charAt(0)}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">{fp.name}</p>
                      <div className="flex gap-4 text-xs text-muted-foreground mt-0.5">
                        <span>Total: {fp.totalJobs}</span>
                        <span>Done: {fp.completedJobs}</span>
                        <span>Pending: {fp.pendingJobs}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">{fp.completionRate}%</p>
                      <p className="text-xs text-muted-foreground">Completion</p>
                    </div>
                    <Badge className={fp.completionRate >= 80 ? "bg-success/10 text-success" : fp.completionRate >= 50 ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive"}>
                      {fp.completedJobs}/{fp.totalJobs}
                    </Badge>
                    <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => setTrackingAgent(fp.id)}>
                      <Locate className="w-3 h-3" />Track
                    </Button>
                  </div>
                ))}
                {fieldPerformance.length === 0 && <p className="text-muted-foreground text-sm text-center py-4">No field agents yet.</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="site" className="space-y-4 mt-4">
          <div className="space-y-3">
            {sitePerformance.map(sp => (
              <Card key={sp.id} className="shadow-card">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{sp.name}</p>
                    <div className="flex gap-4 text-xs text-muted-foreground mt-0.5">
                      <span>Visits: {sp.totalVisits}</span><span>Today: {sp.todayVisits}</span><span>Leads: {sp.totalLeads}</span>
                    </div>
                  </div>
                  <Badge variant="outline">{sp.totalVisits} visits</Badge>
                </CardContent>
              </Card>
            ))}
            {sitePerformance.length === 0 && <p className="text-muted-foreground text-sm">No site agents yet.</p>}
          </div>
        </TabsContent>

        <TabsContent value="staff" className="space-y-4 mt-4">
          <Card className="shadow-card">
            <CardHeader className="pb-2"><CardTitle className="text-sm">User Management</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allUsersWithStatus.map(u => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">{u.name}</TableCell>
                        <TableCell><Badge variant="outline" className="capitalize">{u.role.replace("_", " ")}</Badge></TableCell>
                        <TableCell>
                          {editPhoneUser === u.id ? (
                            <div className="flex items-center gap-1">
                              <Input
                                className="w-32 h-7 text-xs"
                                placeholder="91XXXXXXXXXX"
                                value={editPhoneValue}
                                onChange={e => setEditPhoneValue(e.target.value.replace(/\D/g, "").slice(0, 12))}
                                onKeyDown={e => { if (e.key === "Enter") handleUpdatePhone(u.id); if (e.key === "Escape") setEditPhoneUser(null); }}
                              />
                              <Button size="sm" className="h-7 text-xs px-2" onClick={() => handleUpdatePhone(u.id)} disabled={actionLoading === u.id + "phone"}>
                                {actionLoading === u.id + "phone" ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                              </Button>
                            </div>
                          ) : (
                            <button
                              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                              onClick={() => { setEditPhoneUser(u.id); setEditPhoneValue(u.phone_number || ""); }}
                            >
                              {u.phone_number || "Add phone"}
                            </button>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge className={u.active ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}>
                            {u.active ? "Active" : "Disabled"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end flex-wrap">
                            <Dialog open={resetPwOpen === u.id} onOpenChange={o => { setResetPwOpen(o ? u.id : null); setNewPassword(""); }}>
                              <DialogTrigger asChild>
                                <Button size="sm" variant="outline" className="gap-1 h-7 text-xs">
                                  <KeyRound className="w-3 h-3" />Reset
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader><DialogTitle>Reset Password for {u.name}</DialogTitle></DialogHeader>
                                <div className="space-y-3">
                                  <Input type="password" placeholder="New password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                                  <Button className="w-full" disabled={!newPassword || actionLoading === u.id + "reset_password"} onClick={() => handleUserAction("reset_password", u.id, newPassword)}>
                                    {actionLoading === u.id + "reset_password" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Reset Password"}
                                  </Button>
                                </div>
                              </DialogContent>
                            </Dialog>
                            {u.active ? (
                              <Button size="sm" variant="outline" className="gap-1 h-7 text-xs text-destructive" onClick={() => handleUserAction("disable", u.id)} disabled={actionLoading === u.id + "disable"}>
                                <Ban className="w-3 h-3" />Disable
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" className="gap-1 h-7 text-xs text-success" onClick={() => handleUserAction("enable", u.id)} disabled={actionLoading === u.id + "enable"}>
                                <CheckCircle className="w-3 h-3" />Enable
                              </Button>
                            )}
                            <Button size="sm" variant="outline" className="gap-1 h-7 text-xs text-destructive" onClick={() => {
                              if (confirm("Delete this user permanently?")) handleUserAction("delete", u.id);
                            }} disabled={actionLoading === u.id + "delete"}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {allUsersWithStatus.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No staff members yet.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="targets" className="mt-4">
          <AdminSalesTargets />
        </TabsContent>

        <TabsContent value="export" className="mt-4">
          <AdminExport />
        </TabsContent>

        <TabsContent value="deleted" className="mt-4">
          <AdminDeletedRecords />
        </TabsContent>

        <TabsContent value="messages" className="mt-4">
          <MessageLogsPanel />
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <AuditDashboard />
        </TabsContent>
      </Tabs>

      <AgentTrackingTimeline agentId={trackingAgent} open={!!trackingAgent} onOpenChange={open => { if (!open) setTrackingAgent(null); }} />
    </div>
  );
};

export default AdminDashboard;
