import { useState, useMemo } from "react";
import { useData, LEAD_CATEGORIES } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import StatCard from "@/components/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Wrench, IndianRupee, TrendingUp, MapPin, BarChart3, UserPlus, Trophy, Truck, Shield } from "lucide-react";
import { toast } from "sonner";

const AdminDashboard = () => {
  const { leads, serviceJobs, siteVisits, staff, addStaff, removeStaff } = useData();
  const { allUsers } = useAuth();
  const [tab, setTab] = useState("overview");
  const [dateFilter, setDateFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [staffOpen, setStaffOpen] = useState(false);
  const [newStaff, setNewStaff] = useState({ name: "", email: "", role: "" as any, password: "" });

  const salesLeads = leads.filter(l => l.source === "sales");
  const siteLeads = leads.filter(l => l.source === "site_agent");
  const totalPipeline = salesLeads.reduce((s, l) => s + l.valueInRupees, 0);
  const wonValue = salesLeads.filter(l => l.status === "won").reduce((s, l) => s + l.valueInRupees, 0);
  const serviceRevenue = serviceJobs.filter(j => !j.isFOC && j.status === "completed").reduce((s, j) => s + j.value, 0);
  const todayStr = new Date().toISOString().split("T")[0];
  const overdueLeads = leads.filter(l => l.status === "overdue");
  const deliveryJobs = serviceJobs.filter(j => j.type === "delivery");

  // Per-salesperson stats
  const salesStaff = staff.filter(s => s.role === "sales" && s.active);
  const salesPerformance = salesStaff.map(s => {
    const sLeads = leads.filter(l => l.assignedTo === s.id);
    const won = sLeads.filter(l => l.status === "won");
    return {
      ...s,
      totalLeads: sLeads.length,
      wonLeads: won.length,
      wonValue: won.reduce((sum, l) => sum + l.valueInRupees, 0),
      conversion: sLeads.length ? Math.round((won.length / sLeads.length) * 100) : 0,
    };
  }).sort((a, b) => b.wonValue - a.wonValue);

  // Field agent stats
  const fieldStaff = staff.filter(s => s.role === "field_agent" && s.active);
  const fieldPerformance = fieldStaff.map(s => {
    const jobs = serviceJobs.filter(j => j.assignedAgent === s.id);
    const completed = jobs.filter(j => j.status === "completed");
    return {
      ...s,
      totalJobs: jobs.length,
      completedJobs: completed.length,
      onTime: completed.length, // simplified
    };
  });

  // Site agent stats
  const siteStaff = staff.filter(s => s.role === "site_agent" && s.active);
  const sitePerformance = siteStaff.map(s => {
    const visits = siteVisits.filter(v => v.agentId === s.id);
    const agentLeads = leads.filter(l => l.source === "site_agent" && l.assignedTo === s.id);
    return {
      ...s,
      totalVisits: visits.length,
      totalLeads: agentLeads.length,
      todayVisits: visits.filter(v => v.date === todayStr).length,
    };
  });

  const categoryStats = LEAD_CATEGORIES.map(c => ({
    ...c,
    count: leads.filter(l => l.category === c.value).length,
    totalValue: leads.filter(l => l.category === c.value).reduce((s, l) => s + l.valueInRupees, 0),
  })).filter(c => c.count > 0);

  const handleAddStaff = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStaff.name || !newStaff.email || !newStaff.role) {
      toast.error("Fill all fields"); return;
    }
    addStaff({ name: newStaff.name, email: newStaff.email, role: newStaff.role, active: true });
    toast.success(`${newStaff.name} added as ${newStaff.role}!`);
    setNewStaff({ name: "", email: "", role: "", password: "" });
    setStaffOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          <p className="text-sm text-muted-foreground">Complete business overview & management</p>
        </div>
        <Dialog open={staffOpen} onOpenChange={setStaffOpen}>
          <DialogTrigger asChild>
            <Button className="gradient-primary gap-2"><UserPlus className="w-4 h-4" />Add Staff</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add New Staff</DialogTitle></DialogHeader>
            <form onSubmit={handleAddStaff} className="space-y-4">
              <div className="space-y-1.5"><Label>Full Name *</Label><Input value={newStaff.name} onChange={e => setNewStaff(f => ({ ...f, name: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Email *</Label><Input type="email" value={newStaff.email} onChange={e => setNewStaff(f => ({ ...f, email: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Password *</Label><Input type="password" value={newStaff.password} onChange={e => setNewStaff(f => ({ ...f, password: e.target.value }))} /></div>
              <div className="space-y-1.5">
                <Label>Role *</Label>
                <Select value={newStaff.role} onValueChange={v => setNewStaff(f => ({ ...f, role: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sales">Sales</SelectItem>
                    <SelectItem value="service_head">Service Head</SelectItem>
                    <SelectItem value="field_agent">Field Agent</SelectItem>
                    <SelectItem value="site_agent">Site Agent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full gradient-primary">Add Staff Member</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {overdueLeads.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-3 flex items-center gap-3">
            <span className="text-destructive font-bold animate-pulse">⚠️ {overdueLeads.length} OVERDUE leads across the system!</span>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Sales Leads" value={salesLeads.length} icon={<Users className="w-5 h-5" />} />
        <StatCard title="Pipeline Value" value={`₹${(totalPipeline / 1000).toFixed(0)}K`} icon={<IndianRupee className="w-5 h-5" />} />
        <StatCard title="Won Value" value={`₹${(wonValue / 1000).toFixed(0)}K`} icon={<TrendingUp className="w-5 h-5" />} trendUp trend="Closed" />
        <StatCard title="Service Revenue" value={`₹${serviceRevenue.toLocaleString("en-IN")}`} icon={<Wrench className="w-5 h-5" />} />
      </div>

      <div className="flex gap-3 flex-wrap">
        <Input type="date" className="w-40" value={dateFilter} onChange={e => setDateFilter(e.target.value)} placeholder="Filter by date" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="sales">Sales Team</TabsTrigger>
          <TabsTrigger value="service">Service</TabsTrigger>
          <TabsTrigger value="field">Field Agents</TabsTrigger>
          <TabsTrigger value="site">Site Agents</TabsTrigger>
          <TabsTrigger value="staff">Staff Management</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="shadow-card">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4 text-primary" />Sales Pipeline</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {(["new", "contacted", "follow_up", "negotiation", "overdue", "won", "lost"] as const).map(status => {
                  const count = salesLeads.filter(l => l.status === status).length;
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
                <div className="flex justify-between text-sm"><span>In Progress</span><Badge variant="outline">{serviceJobs.filter(j => j.status === "in_progress").length}</Badge></div>
                <div className="flex justify-between text-sm"><span>Completed</span><Badge className="bg-success/10 text-success">{serviceJobs.filter(j => j.status === "completed").length}</Badge></div>
              </CardContent>
            </Card>

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

        <TabsContent value="sales" className="space-y-4 mt-4">
          <Card className="shadow-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Trophy className="w-4 h-4 text-warning" />Sales Leaderboard</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {salesPerformance.map((sp, idx) => (
                  <div key={sp.id} className={`flex items-center gap-3 p-3 rounded-lg ${idx === 0 ? "bg-warning/10 border border-warning/20" : "bg-muted/50"}`}>
                    <span className={`text-lg font-bold ${idx === 0 ? "text-warning" : "text-muted-foreground"}`}>#{idx + 1}</span>
                    <div className="flex-1">
                      <p className="font-medium">{sp.name}</p>
                      <div className="flex gap-4 text-xs text-muted-foreground mt-0.5">
                        <span>Leads: {sp.totalLeads}</span>
                        <span>Won: {sp.wonLeads}</span>
                        <span>Conversion: {sp.conversion}%</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-success">₹{(sp.wonValue / 1000).toFixed(0)}K</p>
                      <p className="text-xs text-muted-foreground">Won Value</p>
                    </div>
                  </div>
                ))}
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
          <div className="space-y-3">
            {fieldPerformance.map(fp => (
              <Card key={fp.id} className="shadow-card">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{fp.name}</p>
                    <div className="flex gap-4 text-xs text-muted-foreground mt-0.5">
                      <span>Total Jobs: {fp.totalJobs}</span>
                      <span>Completed: {fp.completedJobs}</span>
                    </div>
                  </div>
                  <Badge className="bg-success/10 text-success">{fp.completedJobs}/{fp.totalJobs}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="site" className="space-y-4 mt-4">
          <div className="space-y-3">
            {sitePerformance.map(sp => (
              <Card key={sp.id} className="shadow-card">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{sp.name}</p>
                    <div className="flex gap-4 text-xs text-muted-foreground mt-0.5">
                      <span>Visits: {sp.totalVisits}</span>
                      <span>Today: {sp.todayVisits}</span>
                      <span>Leads: {sp.totalLeads}</span>
                    </div>
                  </div>
                  <Badge variant="outline">{sp.totalVisits} visits</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="staff" className="space-y-4 mt-4">
          <div className="space-y-3">
            {staff.map(s => (
              <Card key={s.id} className={`shadow-card ${!s.active ? "opacity-50" : ""}`}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center text-primary-foreground font-bold">
                      {s.name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize">{s.role.replace("_", " ")}</Badge>
                    {s.active ? (
                      <Button size="sm" variant="destructive" className="text-xs" onClick={() => { removeStaff(s.id); toast.success("Staff deactivated"); }}>
                        Remove
                      </Button>
                    ) : (
                      <Badge className="bg-muted text-muted-foreground">Inactive</Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminDashboard;
