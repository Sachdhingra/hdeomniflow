import { useData, LEAD_CATEGORIES } from "@/contexts/DataContext";
import StatCard from "@/components/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Wrench, IndianRupee, TrendingUp, MapPin, Navigation, BarChart3 } from "lucide-react";

const AdminDashboard = () => {
  const { leads, serviceJobs, siteVisits } = useData();

  const salesLeads = leads.filter(l => l.source === "sales");
  const siteLeads = leads.filter(l => l.source === "site_agent");
  const totalPipeline = salesLeads.reduce((s, l) => s + l.valueInRupees, 0);
  const wonValue = salesLeads.filter(l => l.status === "won").reduce((s, l) => s + l.valueInRupees, 0);
  const serviceRevenue = serviceJobs.filter(j => !j.isFOC).reduce((s, j) => s + j.value, 0);
  const todayStr = new Date().toISOString().split("T")[0];
  const todayJobs = serviceJobs.filter(j => j.dateToAttend === todayStr);

  // Category breakdown
  const categoryStats = LEAD_CATEGORIES.map(c => ({
    ...c,
    count: leads.filter(l => l.category === c.value).length,
    value: leads.filter(l => l.category === c.value).reduce((s, l) => s + l.valueInRupees, 0),
  })).filter(c => c.count > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <p className="text-sm text-muted-foreground">Complete business overview</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Sales Leads" value={salesLeads.length} icon={<Users className="w-5 h-5" />} />
        <StatCard title="Pipeline Value" value={`₹${(totalPipeline / 1000).toFixed(0)}K`} icon={<IndianRupee className="w-5 h-5" />} />
        <StatCard title="Won Value" value={`₹${(wonValue / 1000).toFixed(0)}K`} icon={<TrendingUp className="w-5 h-5" />} trendUp trend="Closed" />
        <StatCard title="Service Revenue" value={`₹${serviceRevenue.toLocaleString("en-IN")}`} icon={<Wrench className="w-5 h-5" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Sales Overview */}
        <Card className="shadow-card">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4 text-primary" />Sales Pipeline</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(["new", "contacted", "follow_up", "negotiation", "won", "lost"] as const).map(status => {
              const count = salesLeads.filter(l => l.status === status).length;
              return (
                <div key={status} className="flex items-center justify-between text-sm">
                  <span className="capitalize">{status.replace("_", " ")}</span>
                  <Badge variant="outline">{count}</Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Service Overview */}
        <Card className="shadow-card">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Wrench className="w-4 h-4 text-primary" />Service Jobs</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between text-sm"><span>Total</span><Badge variant="outline">{serviceJobs.length}</Badge></div>
            <div className="flex justify-between text-sm"><span>Today</span><Badge variant="outline">{todayJobs.length}</Badge></div>
            <div className="flex justify-between text-sm"><span>Pending</span><Badge variant="outline">{serviceJobs.filter(j => j.status === "pending").length}</Badge></div>
            <div className="flex justify-between text-sm"><span>In Progress</span><Badge variant="outline">{serviceJobs.filter(j => j.status === "in_progress").length}</Badge></div>
            <div className="flex justify-between text-sm"><span>Completed</span><Badge variant="outline">{serviceJobs.filter(j => j.status === "completed").length}</Badge></div>
            <div className="flex justify-between text-sm"><span>Claims</span><Badge className="bg-destructive/10 text-destructive">{serviceJobs.filter(j => j.claimPartNo).length}</Badge></div>
          </CardContent>
        </Card>

        {/* Site Agent Overview */}
        <Card className="shadow-card">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><MapPin className="w-4 h-4 text-primary" />Site Agents</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between text-sm"><span>Total Visits</span><Badge variant="outline">{siteVisits.length}</Badge></div>
            <div className="flex justify-between text-sm"><span>Today</span><Badge variant="outline">{siteVisits.filter(v => v.date === todayStr).length}</Badge></div>
            <div className="flex justify-between text-sm"><span>Site Leads</span><Badge variant="outline">{siteLeads.length}</Badge></div>
            <div className="flex justify-between text-sm"><span>Lead Value</span><span className="text-sm font-semibold">₹{siteLeads.reduce((s, l) => s + l.valueInRupees, 0).toLocaleString("en-IN")}</span></div>
          </CardContent>
        </Card>
      </div>

      {/* Category Breakdown */}
      <Card className="shadow-card">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" />Category Breakdown</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {categoryStats.map(c => (
              <div key={c.value} className="p-3 bg-muted/50 rounded-lg text-center">
                <p className="text-sm font-medium">{c.label}</p>
                <p className="text-lg font-bold">{c.count}</p>
                <p className="text-xs text-muted-foreground">₹{(c.value / 1000).toFixed(0)}K</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminDashboard;
