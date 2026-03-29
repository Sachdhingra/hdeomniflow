import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData, LEAD_CATEGORIES, LeadCategory, LeadStatus } from "@/contexts/DataContext";
import StatCard from "@/components/StatCard";
import LeadForm from "@/components/LeadForm";
import DeliveryAssignDialog from "@/components/DeliveryAssignDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Users, IndianRupee, TrendingUp, AlertCircle, Phone, Calendar, Truck, Clock } from "lucide-react";
import { toast } from "sonner";

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
  const { leads, updateLeadStatus } = useData();
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState("");
  const [viewMode, setViewMode] = useState<"my" | "all">(user?.role === "admin" ? "all" : "my");
  const [deliveryLead, setDeliveryLead] = useState<any>(null);

  // Lead add reminder
  useEffect(() => {
    if (user?.role !== "sales") return;
    const interval = setInterval(() => {
      const todayStr = new Date().toISOString().split("T")[0];
      const todayLeads = leads.filter(l => l.createdAt === todayStr && l.assignedTo === user.id);
      if (todayLeads.length === 0) {
        toast.warning("Reminder: You haven't added any leads today! 🔔", { duration: 5000 });
      }
    }, 2 * 60 * 60 * 1000); // Every 2 hours
    return () => clearInterval(interval);
  }, [user, leads]);

  const filteredLeads = useMemo(() => {
    return leads.filter(l => {
      if (l.source !== "sales" && l.source !== "site_agent") return false;
      // For site agent viewing my-leads, show only their leads
      if (user?.role === "site_agent") return l.assignedTo === user.id;
      // My leads vs all leads
      if (viewMode === "my" && user?.role !== "admin") {
        if (l.assignedTo !== user?.id) return false;
      }
      if (categoryFilter !== "all" && l.category !== categoryFilter) return false;
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (dateFilter && l.createdAt < dateFilter) return false;
      return true;
    });
  }, [leads, categoryFilter, statusFilter, dateFilter, viewMode, user]);

  const totalValue = filteredLeads.reduce((s, l) => s + l.valueInRupees, 0);
  const wonValue = filteredLeads.filter(l => l.status === "won").reduce((s, l) => s + l.valueInRupees, 0);
  const overdueLeads = filteredLeads.filter(l => l.status === "overdue");
  const needFollowUp = filteredLeads.filter(l => {
    const lastDate = new Date(l.lastFollowUp);
    const daysSince = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
    return daysSince >= 2 && l.status !== "won" && l.status !== "lost";
  });

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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Total Leads" value={filteredLeads.length} icon={<Users className="w-5 h-5" />} />
        <StatCard title="Pipeline Value" value={`₹${(totalValue / 1000).toFixed(0)}K`} icon={<IndianRupee className="w-5 h-5" />} />
        <StatCard title="Won Value" value={`₹${(wonValue / 1000).toFixed(0)}K`} icon={<TrendingUp className="w-5 h-5" />} trend="Closed deals" trendUp />
        <StatCard title="Conversion" value={filteredLeads.length ? `${Math.round((filteredLeads.filter(l => l.status === "won").length / filteredLeads.length) * 100)}%` : "0%"} icon={<TrendingUp className="w-5 h-5" />} />
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {LEAD_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-32"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" className="w-40" value={dateFilter} onChange={e => setDateFilter(e.target.value)} />
        {user?.role === "admin" && (
          <Select value={viewMode} onValueChange={v => setViewMode(v as "my" | "all")}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Leads</SelectItem>
              <SelectItem value="my">My Leads</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Lead cards */}
      <div className="space-y-3">
        {filteredLeads.map(lead => (
          <Card
            key={lead.id}
            className={`shadow-card hover:shadow-card-hover transition-shadow ${lead.status === "overdue" ? "border-destructive/50 bg-destructive/5" : ""}`}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold">{lead.customerName}</h3>
                    <Badge variant="outline" className={STATUS_COLORS[lead.status]}>{STATUS_LABELS[lead.status]}</Badge>
                    <Badge variant="outline" className="text-xs">{LEAD_CATEGORIES.find(c => c.value === lead.category)?.label}</Badge>
                  </div>
                  <div className="flex items-center gap-4 mt-1.5 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{lead.customerPhone}</span>
                    <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{lead.createdAt}</span>
                  </div>
                  {lead.nextFollowUpDate && (
                    <p className={`text-xs mt-1 ${lead.status === "overdue" ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                      📅 Follow-up: {lead.nextFollowUpDate} at {lead.nextFollowUpTime}
                    </p>
                  )}
                  {lead.notes && <p className="text-sm text-muted-foreground mt-1">{lead.notes}</p>}
                </div>
                <div className="text-right shrink-0 space-y-1">
                  <p className="text-lg font-bold">₹{lead.valueInRupees.toLocaleString("en-IN")}</p>
                  <Select value={lead.status} onValueChange={v => updateLeadStatus(lead.id, v as LeadStatus, user?.id || "")}>
                    <SelectTrigger className="w-28 h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {lead.status === "won" && !lead.deliveryDate && (
                    <Button
                      size="sm"
                      className="w-full gap-1 bg-success text-success-foreground hover:bg-success/90 text-xs h-7"
                      onClick={() => setDeliveryLead(lead)}
                    >
                      <Truck className="w-3 h-3" />Assign Delivery
                    </Button>
                  )}
                  {lead.deliveryDate && (
                    <p className="text-xs text-success">🚚 Delivery: {lead.deliveryDate}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {filteredLeads.length === 0 && (
          <Card className="shadow-card">
            <CardContent className="p-8 text-center text-muted-foreground">No leads found.</CardContent>
          </Card>
        )}
      </div>

      {deliveryLead && (
        <DeliveryAssignDialog lead={deliveryLead} open={!!deliveryLead} onOpenChange={open => { if (!open) setDeliveryLead(null); }} />
      )}
    </div>
  );
};

export default SalesDashboard;
