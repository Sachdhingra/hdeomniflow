import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useData, LEAD_CATEGORIES, LeadCategory, LeadStatus } from "@/contexts/DataContext";
import StatCard from "@/components/StatCard";
import LeadForm from "@/components/LeadForm";
import DeliveryAssignDialog from "@/components/DeliveryAssignDialog";
import SelfDeliveryDialog from "@/components/SelfDeliveryDialog";
import DeleteButton from "@/components/DeleteButton";
import EditLeadDialog from "@/components/EditLeadDialog";
import LeadPhotoGallery from "@/components/LeadPhotoGallery";
import LoadingError from "@/components/LoadingError";
import { DashboardSkeleton } from "@/components/DashboardSkeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Users, IndianRupee, TrendingUp, AlertCircle, Phone, Calendar, Truck, Clock, Trophy, Pencil, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import type { Lead } from "@/contexts/DataContext";
import SalesTargetCard from "@/components/SalesTargetCard";
import { supabase } from "@/integrations/supabase/client";

const STATUS_COLORS: Record<LeadStatus, string> = {
  new: "bg-primary/10 text-primary",
  contacted: "bg-muted text-muted-foreground",
  follow_up: "bg-warning/10 text-warning",
  negotiation: "bg-accent/10 text-accent",
  won: "bg-success/10 text-success",
  lost: "bg-destructive/10 text-destructive",
  overdue: "bg-destructive text-destructive-foreground",
  converted: "bg-success text-success-foreground",
};

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New", contacted: "Contacted", follow_up: "Follow Up",
  negotiation: "Negotiation", won: "Won", lost: "Lost", overdue: "Overdue",
  converted: "Converted",
};

const SalesDashboard = () => {
  const { user } = useAuth();
  const { leads, updateLead, softDeleteLead, hasMoreLeads, loadMoreLeads, error, retryLoad, loading, profiles, summary } = useData();
  const [searchParams, setSearchParams] = useSearchParams();
  const quickFilter = searchParams.get("filter"); // overdue | followup-today | followup-week
  const ownerName = (id: string | null) => profiles.find(p => p.id === id)?.name || "Unknown";
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [viewMode, setViewMode] = useState<"my" | "all">(user?.role === "admin" ? "all" : "my");
  const [deliveryLead, setDeliveryLead] = useState<Lead | null>(null);
  const [selfDeliveryLead, setSelfDeliveryLead] = useState<Lead | null>(null);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [recentlyUpdatedId, setRecentlyUpdatedId] = useState<string | null>(null);
  const [phoneSearch, setPhoneSearch] = useState("");
  const [approvalByLead, setApprovalByLead] = useState<Record<string, { jobId: string; status: string; reason: string | null; notes: string | null; customer: string }>>({});
  const [resubmitJobId, setResubmitJobId] = useState<string | null>(null);
  const [resubmitNote, setResubmitNote] = useState("");
  const [resubmitting, setResubmitting] = useState(false);

  const todayStr = new Date().toISOString().split("T")[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
  const weekAhead = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];

  const clearQuickFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("filter");
    setSearchParams(next, { replace: true });
  };
  const applyQuickFilter = (f: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("filter", f);
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (user?.role !== "sales") return;
    const interval = setInterval(() => {
      const todayLeads = leads.filter(l => l.created_at.startsWith(todayStr) && l.assigned_to === user.id);
      if (todayLeads.length === 0) {
        toast.warning("Reminder: You haven't added any leads today! 🔔", { duration: 5000 });
      }
    }, 2 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user, leads, todayStr]);

  // Fetch accounts approval status for leads that have a service_job (won/converted)
  const loadApprovals = async () => {
    const ids = leads.filter(l => l.status === "won" || l.status === "converted").map(l => l.id);
    if (ids.length === 0) { setApprovalByLead({}); return; }
    const { data } = await supabase
      .from("service_jobs")
      .select("id,source_lead_id,customer_name,accounts_approval_status,accounts_rejection_reason,accounts_notes")
      .in("source_lead_id", ids)
      .is("deleted_at", null);
    if (!data) return;
    const map: Record<string, { jobId: string; status: string; reason: string | null; notes: string | null; customer: string }> = {};
    data.forEach((r: any) => {
      if (r.source_lead_id) map[r.source_lead_id] = {
        jobId: r.id,
        status: r.accounts_approval_status || "pending",
        reason: r.accounts_rejection_reason,
        notes: r.accounts_notes,
        customer: r.customer_name,
      };
    });
    setApprovalByLead(map);
  };
  useEffect(() => { loadApprovals(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leads]);

  // Build list of rejected dispatches owned by current sales user
  const myRejectedDispatches = useMemo(() => {
    const myLeadIds = new Set(
      leads.filter(l => l.created_by === user?.id || l.assigned_to === user?.id).map(l => l.id)
    );
    return Object.entries(approvalByLead)
      .filter(([leadId, a]) => a.status === "rejected" && myLeadIds.has(leadId))
      .map(([leadId, a]) => ({ leadId, ...a }));
  }, [approvalByLead, leads, user]);

  const handleResubmit = async () => {
    if (!resubmitJobId) return;
    setResubmitting(true);
    try {
      const { error } = await supabase
        .from("service_jobs")
        .update({
          accounts_approval_status: "pending",
          accounts_rejection_reason: null,
          accounts_notes: resubmitNote ? `[Resubmitted by sales] ${resubmitNote}` : "[Resubmitted by sales]",
          accounts_approved_by: null,
          accounts_approved_at: null,
          status: "pending_accounts_approval",
        } as any)
        .eq("id", resubmitJobId);
      if (error) throw error;
      // Audit log entry
      await supabase.from("accounts_approvals_log" as any).insert({
        service_job_id: resubmitJobId,
        action: "resubmitted",
        performed_by: user?.id,
        notes: resubmitNote || null,
      });
      toast.success("Dispatch resubmitted for approval");
      setResubmitJobId(null);
      setResubmitNote("");
      loadApprovals();
    } catch (e: any) {
      toast.error(e.message || "Failed to resubmit");
    } finally {
      setResubmitting(false);
    }
  };

  const setQuickDate = (from: string, to: string) => { setFromDate(from); setToDate(to); };

  const filteredLeads = useMemo(() => {
    return leads.filter(l => {
      if (user?.role === "site_agent") return l.assigned_to === user.id;
      if (viewMode === "my" && user?.role !== "admin") {
        if (l.assigned_to !== user?.id) return false;
      }
      if (phoneSearch.trim() && !l.customer_phone.includes(phoneSearch.trim())) return false;
      if (categoryFilter !== "all" && l.category !== categoryFilter) return false;
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (fromDate && l.created_at.split("T")[0] < fromDate) return false;
      if (toDate && l.created_at.split("T")[0] > toDate) return false;
      // URL-driven quick filters from clickable alerts
      if (quickFilter === "overdue" && l.status !== "overdue") return false;
      if (quickFilter === "followup-today" && l.next_follow_up_date !== todayStr) return false;
      if (quickFilter === "followup-week") {
        if (!l.next_follow_up_date) return false;
        if (l.next_follow_up_date < todayStr || l.next_follow_up_date > weekAhead) return false;
      }
      return true;
    });
  }, [leads, categoryFilter, statusFilter, fromDate, toDate, viewMode, user, phoneSearch, quickFilter, todayStr, weekAhead]);

  const totalValue = filteredLeads.reduce((s, l) => s + Number(l.value_in_rupees), 0);
  const wonLeads = filteredLeads.filter(l => l.status === "won");
  const wonValue = wonLeads.reduce((s, l) => s + Number(l.value_in_rupees), 0);

  // Alert scope: user's own leads (admin sees all) — independent of UI filters & URL quickFilter
  const scopeLeads = useMemo(() => {
    if (user?.role === "admin") return leads;
    return leads.filter(l => l.assigned_to === user?.id || l.created_by === user?.id);
  }, [leads, user]);
  // Closed deals never appear in urgency lists
  const isOpen = (l: Lead) => l.status !== "won" && l.status !== "lost" && l.status !== "converted";
  const overdueLeads = scopeLeads.filter(l => l.status === "overdue" && isOpen(l));
  const followUpsToday = scopeLeads.filter(l => l.next_follow_up_date === todayStr && isOpen(l));
  const followUpsThisWeek = scopeLeads.filter(l => l.next_follow_up_date && l.next_follow_up_date >= todayStr && l.next_follow_up_date <= weekAhead && isOpen(l));
  const needFollowUp = scopeLeads.filter(l => {
    const daysSince = Math.floor((Date.now() - new Date(l.last_follow_up).getTime()) / 86400000);
    return daysSince >= 2 && isOpen(l);
  });

  const handleStatusChange = async (id: string, status: LeadStatus) => {
    try {
      await updateLead(id, { status, last_follow_up: new Date().toISOString() });
    } catch (err: any) {
      toast.error(err.message || "Failed to update status");
    }
  };

  const isAdmin = user?.role === "admin";

  if (error && leads.length === 0) return <LoadingError message={error} onRetry={retryLoad} />;
  if (loading && leads.length === 0) return <DashboardSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Sales Dashboard</h1>
          <p className="text-sm text-muted-foreground">Manage leads & track conversions</p>
        </div>
        <LeadForm source={user?.role === "site_agent" ? "site_agent" : "sales"} />
      </div>

      {overdueLeads.length > 0 && (
        <button
          type="button"
          onClick={() => applyQuickFilter("overdue")}
          aria-label={`View ${overdueLeads.length} overdue leads`}
          className="w-full text-left rounded-lg border-2 border-destructive/40 bg-destructive/5 hover:bg-destructive/10 transition p-3 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3 min-w-0">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0 animate-pulse" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-destructive">
                {overdueLeads.length} OVERDUE {overdueLeads.length === 1 ? "lead" : "leads"}!
              </p>
              <p className="text-xs text-destructive/80">Follow-up date has passed. Tap to view all overdue.</p>
            </div>
          </div>
          <span className="text-destructive shrink-0">→</span>
        </button>
      )}

      {followUpsToday.length > 0 && (
        <button
          type="button"
          onClick={() => applyQuickFilter("followup-today")}
          aria-label={`View ${followUpsToday.length} follow-ups due today`}
          className="w-full text-left rounded-lg border-2 border-warning/40 bg-warning/5 hover:bg-warning/10 transition p-3 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3 min-w-0">
            <Calendar className="w-5 h-5 text-warning shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-warning">
                {followUpsToday.length} follow-{followUpsToday.length === 1 ? "up" : "ups"} due today
              </p>
              <p className="text-xs text-warning/80">Tap to view and take action.</p>
            </div>
          </div>
          <span className="text-warning shrink-0">→</span>
        </button>
      )}

      {followUpsThisWeek.length > 0 && (
        <button
          type="button"
          onClick={() => applyQuickFilter("followup-week")}
          aria-label={`View ${followUpsThisWeek.length} follow-ups this week`}
          className="w-full text-left rounded-lg border-2 border-primary/30 bg-primary/5 hover:bg-primary/10 transition p-3 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3 min-w-0">
            <Clock className="w-5 h-5 text-primary shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-primary">
                {followUpsThisWeek.length} follow-{followUpsThisWeek.length === 1 ? "up" : "ups"} this week
              </p>
              <p className="text-xs text-primary/80">Tap to view all upcoming.</p>
            </div>
          </div>
          <span className="text-primary shrink-0">→</span>
        </button>
      )}

      {quickFilter && (
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="secondary" className="gap-1">
            Filter:{" "}
            {quickFilter === "overdue" ? "Overdue" : quickFilter === "followup-today" ? "Follow-ups today" : "Follow-ups this week"}
          </Badge>
          <Button size="sm" variant="ghost" className="h-7" onClick={clearQuickFilter}>Clear</Button>
        </div>
      )}

      <SalesTargetCard />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="My Total Leads" value={user?.role === "admin" ? filteredLeads.length : summary.myTotalLeads} icon={<Users className="w-5 h-5" />} trend={user?.role !== "admin" && filteredLeads.length < summary.myTotalLeads ? `${filteredLeads.length} shown` : undefined} />
        <StatCard title="Won This Month" value={summary.myMonthWonCount} icon={<Trophy className="w-5 h-5" />} trend={summary.myTotalLeads ? `${Math.round((summary.myMonthWonCount / summary.myTotalLeads) * 100)}% conversion` : undefined} trendUp />
        <StatCard title="Won Value (Month)" value={`₹${summary.myMonthWonValue >= 1000 ? (summary.myMonthWonValue / 1000).toFixed(0) + "K" : summary.myMonthWonValue.toLocaleString("en-IN")}`} icon={<IndianRupee className="w-5 h-5" />} />
        <StatCard title="Pipeline Value" value={`₹${totalValue >= 1000 ? (totalValue / 1000).toFixed(0) + "K" : totalValue.toLocaleString("en-IN")}`} icon={<TrendingUp className="w-5 h-5" />} />
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <Button size="sm" variant={fromDate === todayStr && toDate === todayStr ? "default" : "outline"} onClick={() => setQuickDate(todayStr, todayStr)}>Today</Button>
        <Button size="sm" variant={fromDate === weekAgo && toDate === todayStr ? "default" : "outline"} onClick={() => setQuickDate(weekAgo, todayStr)}>This Week</Button>
        <Button size="sm" variant={fromDate === monthStart && toDate === todayStr ? "default" : "outline"} onClick={() => setQuickDate(monthStart, todayStr)}>This Month</Button>
        {(fromDate || toDate) && <Button size="sm" variant="ghost" onClick={() => { setFromDate(""); setToDate(""); }}>Clear</Button>}
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative">
          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by phone..." value={phoneSearch} onChange={e => setPhoneSearch(e.target.value)} className="pl-9 w-44 h-9" />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">From</span>
          <Input type="date" className="w-36 h-9" value={fromDate} onChange={e => setFromDate(e.target.value)} />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">To</span>
          <Input type="date" className="w-36 h-9" value={toDate} onChange={e => setToDate(e.target.value)} />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {LEAD_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-32 h-9"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        {isAdmin && (
          <Select value={viewMode} onValueChange={v => setViewMode(v as "my" | "all")}>
            <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Leads</SelectItem>
              <SelectItem value="my">My Leads</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="space-y-3">
        {filteredLeads.map(lead => (
          <Card key={lead.id} className={`shadow-card hover:shadow-card-hover transition-all cursor-pointer ${lead.status === "overdue" ? "border-destructive/50 bg-destructive/5" : ""} ${recentlyUpdatedId === lead.id ? "ring-2 ring-primary/60" : ""}`} onClick={() => setEditLead(lead)}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold">{lead.customer_name}</h3>
                    <Badge variant="outline" className={STATUS_COLORS[lead.status]}>{STATUS_LABELS[lead.status]}</Badge>
                    <Badge variant="outline" className="text-xs">{LEAD_CATEGORIES.find(c => c.value === lead.category)?.label}</Badge>
                    <Pencil className="w-3 h-3 text-muted-foreground" />
                    {recentlyUpdatedId === lead.id && <Badge className="text-[10px] h-4 px-1.5 bg-success text-success-foreground">Updated</Badge>}
                  </div>
                  <div className="flex items-center gap-4 mt-1.5 text-sm text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{lead.customer_phone}</span>
                    <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{lead.created_at.split("T")[0]}</span>
                    <span className="flex items-center gap-1"><UserIcon className="w-3.5 h-3.5" />Owner: <span className="font-medium text-foreground">{ownerName(lead.created_by)}</span></span>
                  </div>
                  {lead.next_follow_up_date && (
                    <p className={`text-xs mt-1 ${lead.status === "overdue" ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                      📅 Follow-up: {lead.next_follow_up_date} at {lead.next_follow_up_time}
                    </p>
                  )}
                  {lead.notes && <p className="text-sm text-muted-foreground mt-1">{lead.notes}</p>}
                  {lead.status === "won" && (
                    <LeadPhotoGallery leadId={lead.id} />
                  )}
                </div>
                <div className="text-right shrink-0 space-y-1" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center gap-1 justify-end">
                    <p className="text-lg font-bold">₹{Number(lead.value_in_rupees).toLocaleString("en-IN")}</p>
                    {isAdmin && <DeleteButton onDelete={() => softDeleteLead(lead.id)} itemName="Lead" />}
                  </div>
                  <Select value={lead.status} onValueChange={v => handleStatusChange(lead.id, v as LeadStatus)}>
                    <SelectTrigger className="w-28 h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {lead.status === "won" && !lead.delivery_date && (
                    <div className="flex flex-col gap-1">
                      <Button size="sm" className="w-full gap-1 bg-success text-success-foreground hover:bg-success/90 text-xs h-7" onClick={() => setDeliveryLead(lead)}>
                        <Truck className="w-3 h-3" />Assign Delivery
                      </Button>
                      <Button size="sm" variant="outline" className="w-full gap-1 text-xs h-7 border-success/40 text-success hover:bg-success/10" onClick={() => setSelfDeliveryLead(lead)}>
                        📦 Self Delivery
                      </Button>
                    </div>
                  )}
                  {lead.delivery_date && <p className="text-xs text-success">🚚 Delivery: {lead.delivery_date}</p>}
                  {approvalByLead[lead.id] && (
                    <Badge variant="outline" className={`text-[10px] ${
                      approvalByLead[lead.id].status === "approved" ? "bg-success/10 text-success border-success/30" :
                      approvalByLead[lead.id].status === "rejected" ? "bg-destructive/10 text-destructive border-destructive/30" :
                      "bg-warning/10 text-warning border-warning/30"
                    }`} title={approvalByLead[lead.id].reason || undefined}>
                      Accounts: {approvalByLead[lead.id].status}
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {filteredLeads.length === 0 && (
          <Card className="shadow-card"><CardContent className="p-8 text-center text-muted-foreground">No leads found.</CardContent></Card>
        )}
      </div>

      {hasMoreLeads && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMoreLeads}>Load More Leads</Button>
        </div>
      )}

      {deliveryLead && (
        <DeliveryAssignDialog lead={deliveryLead} open={!!deliveryLead} onOpenChange={open => { if (!open) setDeliveryLead(null); }} />
      )}

      {selfDeliveryLead && (
        <SelfDeliveryDialog lead={selfDeliveryLead} open={!!selfDeliveryLead} onOpenChange={open => { if (!open) setSelfDeliveryLead(null); }} />
      )}

      <EditLeadDialog lead={editLead} open={!!editLead} onOpenChange={open => { if (!open) setEditLead(null); }} onSaved={(id) => { setRecentlyUpdatedId(id); setTimeout(() => setRecentlyUpdatedId(curr => curr === id ? null : curr), 3000); }} />
    </div>
  );
};

export default SalesDashboard;
