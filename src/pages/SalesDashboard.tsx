import { useState, useMemo } from "react";
import { useData, LEAD_CATEGORIES, LeadCategory, LeadStatus } from "@/contexts/DataContext";
import StatCard from "@/components/StatCard";
import LeadForm from "@/components/LeadForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Users, IndianRupee, TrendingUp, AlertCircle, Phone, Calendar } from "lucide-react";

const STATUS_COLORS: Record<LeadStatus, string> = {
  new: "bg-primary/10 text-primary",
  contacted: "bg-secondary/20 text-secondary-foreground",
  follow_up: "bg-warning/10 text-warning",
  negotiation: "bg-accent/10 text-accent",
  won: "bg-success/10 text-success",
  lost: "bg-destructive/10 text-destructive",
};

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New", contacted: "Contacted", follow_up: "Follow Up",
  negotiation: "Negotiation", won: "Won", lost: "Lost",
};

const SalesDashboard = () => {
  const { leads, updateLeadStatus } = useData();
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState("");

  const salesLeads = useMemo(() => {
    return leads.filter(l => {
      if (l.source !== "sales") return false;
      if (categoryFilter !== "all" && l.category !== categoryFilter) return false;
      if (dateFilter && l.createdAt < dateFilter) return false;
      return true;
    });
  }, [leads, categoryFilter, dateFilter]);

  const totalValue = salesLeads.reduce((s, l) => s + l.valueInRupees, 0);
  const wonValue = salesLeads.filter(l => l.status === "won").reduce((s, l) => s + l.valueInRupees, 0);
  const needFollowUp = salesLeads.filter(l => {
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
        <LeadForm source="sales" />
      </div>

      {needFollowUp.length > 0 && (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="p-3 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-warning shrink-0 animate-pulse" />
            <p className="text-sm font-medium">
              <span className="text-warning font-bold">{needFollowUp.length} leads</span> need follow-up! Don't let them go cold.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Total Leads" value={salesLeads.length} icon={<Users className="w-5 h-5" />} />
        <StatCard title="Pipeline Value" value={`₹${(totalValue / 1000).toFixed(0)}K`} icon={<IndianRupee className="w-5 h-5" />} />
        <StatCard title="Won Value" value={`₹${(wonValue / 1000).toFixed(0)}K`} icon={<TrendingUp className="w-5 h-5" />} trend="Closed deals" trendUp />
        <StatCard title="Conversion" value={salesLeads.length ? `${Math.round((salesLeads.filter(l => l.status === "won").length / salesLeads.length) * 100)}%` : "0%"} icon={<TrendingUp className="w-5 h-5" />} />
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {LEAD_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" className="w-40" value={dateFilter} onChange={e => setDateFilter(e.target.value)} placeholder="From date" />
      </div>

      {/* Lead cards */}
      <div className="space-y-3">
        {salesLeads.map(lead => (
          <Card key={lead.id} className="shadow-card hover:shadow-card-hover transition-shadow">
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
                  {lead.notes && <p className="text-sm text-muted-foreground mt-1">{lead.notes}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-bold">₹{lead.valueInRupees.toLocaleString("en-IN")}</p>
                  <Select value={lead.status} onValueChange={v => updateLeadStatus(lead.id, v as LeadStatus)}>
                    <SelectTrigger className="w-28 h-7 text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
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

export default SalesDashboard;
