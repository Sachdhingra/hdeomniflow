import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData, LEAD_CATEGORIES, LeadCategory, LeadStatus } from "@/contexts/DataContext";
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
import { Users, IndianRupee, TrendingUp, AlertCircle, Phone, Calendar, Truck, Clock, Trophy, Pencil, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import type { Lead } from "@/contexts/DataContext";
import SalesTargetCard from "@/components/SalesTargetCard";

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
  const ownerName = (id: string | null) => profiles.find(p => p.id === id)?.name || "Unknown";
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [viewMode, setViewMode] = useState<"my" | "all">(user?.role === "admin" ? "all" : "my");
  const [deliveryLead, setDeliveryLead] = useState<Lead | null>(null);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [recentlyUpdatedId, setRecentlyUpdatedId] = useState<string | null>(null);
  const [phoneSearch, setPhoneSearch] = useState("");

  const todayStr = new Date().toISOString().split("T")[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];

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
      return true;
    });
  }, [leads, categoryFilter, statusFilter, fromDate, toDate, viewMode, user, phoneSearch]);

  const totalValue = filteredLeads.reduce((s, l) => s + Number(l.value_in_rupees), 0);
  const wonLeads = filteredLeads.filter(l => l.status === "won");
  const wonValue = wonLeads.reduce((s, l) => s + Number(l.value_in_rupees), 0);
  const overdueLeads = filteredLeads.filter(l => l.status === "overdue");
  const needFollowUp = filteredLeads.filter(l => {
    const daysSince = Math.floor((Date.now() - new Date(l.last_follow_up).getTime()) / 86400000);
    return daysSince >= 2 && l.status !== "won" && l.status !== "lost";
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
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-3 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0 animate-pulse" />
            <p className="text-sm font-medium">
              <span className="text-destructive font-bold">{overdueLeads.length} OVERDUE leads!</span> Follow-up date has passed. Act now!
            </p>
          </CardContent>
        </Card>
      )}

      {needFollowUp.length > 0 && (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="p-3 flex items-center gap-3">
            <Clock className="w-5 h-5 text-warning shrink-0 animate-pulse" />
            <p className="text-sm font-medium">
              <span className="text-warning font-bold">{needFollowUp.length} leads</span> need follow-up!
            </p>
          </CardContent>
        </Card>
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

      <EditLeadDialog lead={editLead} open={!!editLead} onOpenChange={open => { if (!open) setEditLead(null); }} onSaved={(id) => { setRecentlyUpdatedId(id); setTimeout(() => setRecentlyUpdatedId(curr => curr === id ? null : curr), 3000); }} />
    </div>
  );
};

export default SalesDashboard;
