import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData, LEAD_CATEGORIES, LeadCategory } from "@/contexts/DataContext";
import StatCard from "@/components/StatCard";
import LeadForm from "@/components/LeadForm";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { MapPin, Camera, Navigation, Home, Users, Play, Square, Route, ArrowRightCircle } from "lucide-react";
import { toast } from "sonner";

const SiteAgentDashboard = () => {
  const { user } = useAuth();
  const { siteVisits, addSiteVisit, addLead, updateSiteVisit, leads } = useData();
  const [visitOpen, setVisitOpen] = useState(false);
  const [tripStarted, setTripStarted] = useState(false);
  const [tripStartTime, setTripStartTime] = useState<Date | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    location: "", society: "", notes: "",
    customerName: "", customerPhone: "",
    category: "" as LeadCategory | "",
    budget: "", followUpDate: "", visitStatus: "new",
  });

  const myVisits = siteVisits.filter(v => v.agent_id === user?.id);
  const myLeads = leads.filter(l => l.source === "site_agent" && l.assigned_to === user?.id);
  const todayStr = new Date().toISOString().split("T")[0];
  const todayVisits = myVisits.filter(v => v.date === todayStr);

  const handleStartTrip = () => {
    setTripStarted(true);
    setTripStartTime(new Date());
    toast.success("Trip started! GPS tracking active. 📍");
  };

  const handleEndTrip = () => {
    setTripStarted(false);
    const duration = tripStartTime ? Math.round((Date.now() - tripStartTime.getTime()) / 60000) : 0;
    const estimatedKm = Math.round(duration * 0.5);
    toast.success(`Trip ended! Duration: ${duration} min, Est. KM: ${estimatedKm}`);
  };

  const handleAddVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.location) { toast.error("Location required"); return; }
    try {
      await addSiteVisit({
        agent_id: user?.id || "",
        location: form.location,
        society: form.society,
        date: todayStr,
        photos: [],
        notes: form.notes,
        leads_generated: form.customerName ? 1 : 0,
        customer_name: form.customerName || null,
        customer_phone: form.customerPhone || null,
        category: (form.category as LeadCategory) || null,
        budget: form.budget ? Number(form.budget) : null,
        follow_up_date: form.followUpDate || null,
        status: form.visitStatus,
      });
      toast.success("Site visit logged!");
      setForm({ location: "", society: "", notes: "", customerName: "", customerPhone: "", category: "", budget: "", followUpDate: "", visitStatus: "new" });
      setVisitOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to log visit");
    }
  };

  const handleConvertToLead = async (visitId: string) => {
    const visit = myVisits.find(v => v.id === visitId);
    if (!visit) return;
    if (!visit.customer_name || !visit.customer_phone) {
      toast.error("Customer name and phone are required to convert to lead");
      return;
    }
    if (!/^\d{10}$/.test(visit.customer_phone)) {
      toast.error("Phone must be exactly 10 digits to convert");
      return;
    }
    setConvertingId(visitId);
    try {
      await addLead({
        customer_name: visit.customer_name,
        customer_phone: visit.customer_phone,
        category: (visit.category as LeadCategory) || "others",
        value_in_rupees: visit.budget ? Number(visit.budget) : 0,
        status: "new",
        assigned_to: user?.id || "",
        notes: `Converted from site visit at ${visit.location}${visit.society ? ` (${visit.society})` : ""}. ${visit.notes || ""}`.trim(),
        source: "site_agent",
        next_follow_up_date: visit.follow_up_date || null,
        next_follow_up_time: null,
        created_by: user?.id || "",
        updated_by: user?.id || "",
      });
      await updateSiteVisit(visitId, { status: "converted" } as any);
      toast.success("Site visit converted to lead! 🎉");
    } catch (err: any) {
      toast.error(err.message || "Failed to convert");
    } finally {
      setConvertingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Site Agent Dashboard</h1>
          <p className="text-sm text-muted-foreground">New site prospecting & lead generation</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!tripStarted ? (
            <Button className="bg-success text-success-foreground gap-2 min-h-[44px]" onClick={handleStartTrip}>
              <Play className="w-4 h-4" />Start Trip
            </Button>
          ) : (
            <Button variant="destructive" className="gap-2 min-h-[44px]" onClick={handleEndTrip}>
              <Square className="w-4 h-4" />End Trip
            </Button>
          )}
        </div>
      </div>

      {tripStarted && (
        <Card className="border-success/30 bg-success/5">
          <CardContent className="p-3 flex items-center gap-3">
            <MapPin className="w-5 h-5 text-success animate-pulse" />
            <div>
              <p className="text-sm font-medium text-success">Trip Active — GPS Tracking On</p>
              <p className="text-xs text-muted-foreground">Started at {tripStartTime?.toLocaleTimeString("en-IN")}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Today's Visits" value={todayVisits.length} icon={<MapPin className="w-5 h-5" />} />
        <StatCard title="Total Visits" value={myVisits.length} icon={<Home className="w-5 h-5" />} />
        <StatCard title="Leads Generated" value={myLeads.length} icon={<Users className="w-5 h-5" />} />
        <StatCard title="This Month" value={myVisits.filter(v => v.date.startsWith(todayStr.slice(0, 7))).length} icon={<Route className="w-5 h-5" />} />
      </div>

      <div className="flex gap-2 flex-wrap">
        <Dialog open={visitOpen} onOpenChange={setVisitOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="gap-2 min-h-[44px]"><MapPin className="w-4 h-4" />Log Site Visit</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Log Site Visit</DialogTitle></DialogHeader>
            <form onSubmit={handleAddVisit} className="space-y-4">
              <div className="space-y-1.5"><Label>Location (Auto GPS) *</Label><Input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Area / Address" /></div>
              <div className="space-y-1.5"><Label>Society / Community</Label><Input value={form.society} onChange={e => setForm(f => ({ ...f, society: e.target.value }))} placeholder="Society name" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Customer Name</Label><Input value={form.customerName} onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))} /></div>
                <div className="space-y-1.5"><Label>Contact Number</Label><Input value={form.customerPhone} onChange={e => setForm(f => ({ ...f, customerPhone: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Category Interest</Label>
                  <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v as LeadCategory }))}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{LEAD_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>Budget (₹)</Label><Input type="number" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Follow-up Date</Label><Input type="date" value={form.followUpDate} onChange={e => setForm(f => ({ ...f, followUpDate: e.target.value }))} /></div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={form.visitStatus} onValueChange={v => setForm(f => ({ ...f, visitStatus: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="interested">Interested</SelectItem>
                      <SelectItem value="not_interested">Not Interested</SelectItem>
                      <SelectItem value="follow_up">Follow Up</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Upload Site Images</Label>
                <div className="border-2 border-dashed border-border rounded-lg p-4 text-center">
                  <Camera className="w-6 h-6 mx-auto text-muted-foreground mb-1" />
                  <Input type="file" accept="image/*" multiple className="mt-1" capture="environment" />
                </div>
              </div>
              <div className="space-y-1.5"><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
              <Button type="submit" className="w-full gradient-primary min-h-[44px]">Save Visit</Button>
            </form>
          </DialogContent>
        </Dialog>
        <LeadForm source="site_agent" />
        <Button variant="outline" className="gap-2 min-h-[44px]" onClick={() => window.open("https://maps.google.com/", "_blank")}>
          <Navigation className="w-4 h-4" />Open Map
        </Button>
      </div>

      {todayVisits.length > 0 && (
        <Card className="shadow-card bg-primary/5 border-primary/20">
          <CardContent className="p-4">
            <h3 className="font-semibold mb-2">Today's Summary</h3>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div><p className="text-2xl font-bold">{todayVisits.length}</p><p className="text-xs text-muted-foreground">Visits</p></div>
              <div><p className="text-2xl font-bold">{todayVisits.filter(v => v.customer_name).length}</p><p className="text-xs text-muted-foreground">Leads</p></div>
              <div><p className="text-2xl font-bold">—</p><p className="text-xs text-muted-foreground">KM Traveled</p></div>
            </div>
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="font-semibold mb-3">Recent Visits</h2>
        {myVisits.length === 0 ? (
          <p className="text-muted-foreground text-sm">No visits logged yet. Start prospecting!</p>
        ) : (
          <div className="space-y-3">
            {myVisits.map(visit => (
              <Card key={visit.id} className="shadow-card">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold">{visit.location}</h3>
                      {visit.society && <p className="text-sm text-muted-foreground">{visit.society}</p>}
                      {visit.customer_name && (
                        <p className="text-sm mt-1">👤 {visit.customer_name} {visit.customer_phone && `• ${visit.customer_phone}`}</p>
                      )}
                      {visit.category && <Badge variant="outline" className="text-xs mt-1">{LEAD_CATEGORIES.find(c => c.value === visit.category)?.label}</Badge>}
                      {visit.budget && <span className="text-xs text-muted-foreground ml-2">Budget: ₹{Number(visit.budget).toLocaleString("en-IN")}</span>}
                      {visit.notes && <p className="text-sm text-muted-foreground mt-1">{visit.notes}</p>}
                    </div>
                    <div className="text-right text-sm text-muted-foreground shrink-0 space-y-1">
                      <p>{visit.date}</p>
                      {visit.status && <Badge variant="outline" className="text-xs mt-1">{visit.status === "converted" ? "Converted ✅" : visit.status}</Badge>}
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" className="gap-1 h-7" onClick={() => window.open(`https://maps.google.com/?q=${encodeURIComponent(visit.location)}`, "_blank")}>
                          <Navigation className="w-3 h-3" />Map
                        </Button>
                        {visit.customer_name && visit.customer_phone && visit.status !== "converted" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 h-7 text-xs text-primary"
                            disabled={convertingId === visit.id}
                            onClick={() => handleConvertToLead(visit.id)}
                          >
                            <ArrowRightCircle className="w-3 h-3" />
                            {convertingId === visit.id ? "Converting..." : "Convert to Lead"}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SiteAgentDashboard;
