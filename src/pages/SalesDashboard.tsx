import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData, LEAD_CATEGORIES, LeadStatus } from "@/contexts/DataContext";
import { useSalesStats } from "@/hooks/useSalesStats";
import { useLeadsPage } from "@/hooks/useLeadsPage";
import StatCard from "@/components/StatCard";
import LeadForm from "@/components/LeadForm";
import DeliveryAssignDialog from "@/components/DeliveryAssignDialog";
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
import {
  Pagination, PaginationContent, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious, PaginationEllipsis,
} from "@/components/ui/pagination";
import { Users, IndianRupee, TrendingUp, AlertCircle, Phone, Calendar, Truck, Clock, Trophy, Pencil, User } from "lucide-react";
import { toast } from "sonner";
import type { Lead } from "@/contexts/DataContext";
import SalesTargetCard from "@/components/SalesTargetCard";
import TeamPerformancePanel from "@/components/TeamPerformancePanel";

const PAGE_SIZE = 20;

const STATUS_COLORS: Record<LeadStatus, string> = {
  new: "bg-primary/10 text-primary",
  contacted: "bg-muted text-muted-foreground",
  follow_up: "bg-warning/10 text-warning",
  negotiation: "bg-accent/10 text-accent",
  won: "bg-success/10 text-success",
  lost: "bg-destructive/10 text-destructive",
  overdue: "bg-destructive text-destructive-foreground",
};

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New", contacted: "Contacted", follow_up: "Follow Up",
  negotiation: "Negotiation", won: "Won", lost: "Lost", overdue: "Overdue",
};

const SalesDashboard = () => {
  const { user } = useAuth();
  const { updateLead, softDeleteLead, error, retryLoad } = useData();

  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [viewMode, setViewMode] = useState<"my" | "all">(user?.role === "admin" ? "all" : "my");
  const [deliveryLead, setDeliveryLead] = useState<Lead | null>(null);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [phoneSearch, setPhoneSearch] = useState("");
  const [page, setPage] = useState(1);

  const todayStr = new Date().toISOString().split("T")[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];

  const isAdmin = user?.role === "admin";
  // Sales/site_agent always scope to own leads. Admin can switch.
  const scopeUserId = useMemo(() => {
    if (!user) return undefined;
    if (user.role === "site_agent") return user.id;
    if (user.role === "sales") return user.id;
    if (isAdmin && viewMode === "my") return user.id;
    return undefined; // admin viewing all
  }, [user, isAdmin, viewMode]);

  const filterArgs = {
    userId: scopeUserId,
    categoryFilter, statusFilter, fromDate, toDate, phoneSearch,
  };

  const { stats, loading: statsLoading, refetch: refetchStats } = useSalesStats(
    filterArgs,
    [scopeUserId, categoryFilter, statusFilter, fromDate, toDate, phoneSearch]
  );

  // reset page when filters change
  useEffect(() => { setPage(1); }, [scopeUserId, categoryFilter, statusFilter, fromDate, toDate, phoneSearch]);

  const { leads, totalCount, loading: pageLoading, refetch: refetchPage } = useLeadsPage(
    { ...filterArgs, page, pageSize: PAGE_SIZE },
    [scopeUserId, categoryFilter, statusFilter, fromDate, toDate, phoneSearch, page]
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  useEffect(() => {
    if (user?.role !== "sales") return;
    const interval = setInterval(() => {
      if (stats.totalLeads === 0) {
        toast.warning("Reminder: You haven't added any leads today! 🔔", { duration: 5000 });
      }
    }, 2 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user, stats.totalLeads]);

  const setQuickDate = (from: string, to: string) => { setFromDate(from); setToDate(to); };

  const handleStatusChange = async (id: string, status: LeadStatus) => {
    try {
      await updateLead(id, { status, last_follow_up: new Date().toISOString() });
      refetchStats();
      refetchPage();
    } catch (err: any) {
      toast.error(err.message || "Failed to update status");
    }
  };

  const onAfterMutate = () => { refetchStats(); refetchPage(); };

  if (error && leads.length === 0 && !pageLoading) return <LoadingError message={error} onRetry={retryLoad} />;
  if ((statsLoading || pageLoading) && leads.length === 0) return <DashboardSkeleton />;

  const fmt = (n: number) =>
    n >= 1000 ? (n / 1000).toFixed(0) + "K" : n.toLocaleString("en-IN");

  // Pagination items (compact: first, current-1, current, current+1, last)
  const pageNumbers: (number | "ellipsis")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pageNumbers.push(i);
  } else {
    pageNumbers.push(1);
    if (page > 3) pageNumbers.push("ellipsis");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pageNumbers.push(i);
    if (page < totalPages - 2) pageNumbers.push("ellipsis");
    pageNumbers.push(totalPages);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Sales Dashboard</h1>
          <p className="text-sm text-muted-foreground">Manage leads & track conversions</p>
        </div>
        <LeadForm source={user?.role === "site_agent" ? "site_agent" : "sales"} />
      </div>

      {stats.overdueLeads > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-3 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0 animate-pulse" />
            <p className="text-sm font-medium">
              <span className="text-destructive font-bold">{stats.overdueLeads} OVERDUE leads!</span> Follow-up date has passed. Act now!
            </p>
          </CardContent>
        </Card>
      )}

      <SalesTargetCard />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Total Leads" value={stats.totalLeads} icon={<Users className="w-5 h-5" />} />
        <StatCard
          title="Won Deals"
          value={stats.wonLeads}
          icon={<Trophy className="w-5 h-5" />}
          trend={`${stats.conversionPct}% conversion`}
          trendUp
        />
        <StatCard title="Won Value" value={`₹${fmt(stats.wonValue)}`} icon={<IndianRupee className="w-5 h-5" />} />
        <StatCard title="Pipeline Value" value={`₹${fmt(stats.pipelineValue)}`} icon={<TrendingUp className="w-5 h-5" />} />
      </div>

      {isAdmin && viewMode === "all" && <TeamPerformancePanel compact />}

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

      <div className="text-xs text-muted-foreground">
        Showing {leads.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–{(page - 1) * PAGE_SIZE + leads.length} of <span className="font-semibold text-foreground">{totalCount}</span> leads
      </div>

      <div className="space-y-3">
        {leads.map(lead => (
          <Card key={lead.id} className={`shadow-card hover:shadow-card-hover transition-shadow cursor-pointer ${lead.status === "overdue" ? "border-destructive/50 bg-destructive/5" : ""}`} onClick={() => setEditLead(lead)}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold">{lead.customer_name}</h3>
                    <Badge variant="outline" className={STATUS_COLORS[lead.status]}>{STATUS_LABELS[lead.status]}</Badge>
                    <Badge variant="outline" className="text-xs">{LEAD_CATEGORIES.find(c => c.value === lead.category)?.label}</Badge>
                    <Pencil className="w-3 h-3 text-muted-foreground" />
                  </div>
                  <div className="flex items-center gap-4 mt-1.5 text-sm text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{lead.customer_phone}</span>
                    <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{lead.created_at.split("T")[0]}</span>
                    <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" />Created by: <span className="font-medium text-foreground">{lead.creator_name || "Unknown"}</span></span>
                  </div>
                  {lead.next_follow_up_date && (
                    <p className={`text-xs mt-1 ${lead.status === "overdue" ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                      📅 Follow-up: {lead.next_follow_up_date} at {lead.next_follow_up_time}
                    </p>
                  )}
                  {lead.notes && <p className="text-sm text-muted-foreground mt-1">{lead.notes}</p>}
                  {lead.status === "won" && lead.delivery_date && (
                    <LeadPhotoGallery leadId={lead.id} />
                  )}
                </div>
                <div className="text-right shrink-0 space-y-1" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center gap-1 justify-end">
                    <p className="text-lg font-bold">₹{Number(lead.value_in_rupees).toLocaleString("en-IN")}</p>
                    {isAdmin && <DeleteButton onDelete={async () => { await softDeleteLead(lead.id); onAfterMutate(); }} itemName="Lead" />}
                  </div>
                  <Select value={lead.status} onValueChange={v => handleStatusChange(lead.id, v as LeadStatus)}>
                    <SelectTrigger className="w-28 h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {lead.status === "won" && !lead.delivery_date && (
                    <Button size="sm" className="w-full gap-1 bg-success text-success-foreground hover:bg-success/90 text-xs h-7" onClick={() => setDeliveryLead(lead)}>
                      <Truck className="w-3 h-3" />Assign Delivery
                    </Button>
                  )}
                  {lead.delivery_date && <p className="text-xs text-success">🚚 Delivery: {lead.delivery_date}</p>}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {leads.length === 0 && !pageLoading && (
          <Card className="shadow-card"><CardContent className="p-8 text-center text-muted-foreground">No leads found.</CardContent></Card>
        )}
      </div>

      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={(e) => { e.preventDefault(); if (page > 1) setPage(page - 1); }}
                className={page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
            {pageNumbers.map((p, i) =>
              p === "ellipsis" ? (
                <PaginationItem key={`e-${i}`}><PaginationEllipsis /></PaginationItem>
              ) : (
                <PaginationItem key={p}>
                  <PaginationLink
                    isActive={p === page}
                    onClick={(e) => { e.preventDefault(); setPage(p); }}
                    className="cursor-pointer"
                  >
                    {p}
                  </PaginationLink>
                </PaginationItem>
              )
            )}
            <PaginationItem>
              <PaginationNext
                onClick={(e) => { e.preventDefault(); if (page < totalPages) setPage(page + 1); }}
                className={page === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}

      {deliveryLead && (
        <DeliveryAssignDialog lead={deliveryLead} open={!!deliveryLead} onOpenChange={open => { if (!open) { setDeliveryLead(null); onAfterMutate(); } }} />
      )}

      <EditLeadDialog
        lead={editLead}
        open={!!editLead}
        onOpenChange={open => { if (!open) { setEditLead(null); onAfterMutate(); } }}
      />
    </div>
  );
};

export default SalesDashboard;
