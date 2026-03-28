import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import StatCard from "@/components/StatCard";
import LeadForm from "@/components/LeadForm";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MapPin, Camera, Plus, Navigation, Home, Users } from "lucide-react";
import { toast } from "sonner";

const SiteAgentDashboard = () => {
  const { user } = useAuth();
  const { siteVisits, addSiteVisit, leads } = useData();
  const [visitOpen, setVisitOpen] = useState(false);
  const [form, setForm] = useState({ location: "", society: "", notes: "" });

  const myVisits = siteVisits.filter(v => v.agentId === user?.id);
  const myLeads = leads.filter(l => l.source === "site_agent" && l.assignedTo === user?.id);
  const todayStr = new Date().toISOString().split("T")[0];
  const todayVisits = myVisits.filter(v => v.date === todayStr);

  const handleAddVisit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.location) { toast.error("Location required"); return; }
    addSiteVisit({
      agentId: user?.id || "",
      location: form.location,
      society: form.society,
      date: todayStr,
      photos: [],
      notes: form.notes,
      leadsGenerated: 0,
    });
    toast.success("Site visit logged!");
    setForm({ location: "", society: "", notes: "" });
    setVisitOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Site Agent Dashboard</h1>
          <p className="text-sm text-muted-foreground">New site prospecting & lead generation</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={visitOpen} onOpenChange={setVisitOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2"><MapPin className="w-4 h-4" />Log Visit</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Log Site Visit</DialogTitle></DialogHeader>
              <form onSubmit={handleAddVisit} className="space-y-4">
                <div className="space-y-1.5"><Label>Location *</Label><Input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Area / Address" /></div>
                <div className="space-y-1.5"><Label>Society / Community</Label><Input value={form.society} onChange={e => setForm(f => ({ ...f, society: e.target.value }))} placeholder="Society name" /></div>
                <div className="space-y-1.5"><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
                <Button type="submit" className="w-full gradient-primary gap-2"><Camera className="w-4 h-4" />Save Visit</Button>
              </form>
            </DialogContent>
          </Dialog>
          <LeadForm source="site_agent" />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Today's Visits" value={todayVisits.length} icon={<MapPin className="w-5 h-5" />} />
        <StatCard title="Total Visits" value={myVisits.length} icon={<Home className="w-5 h-5" />} />
        <StatCard title="Leads Generated" value={myLeads.length} icon={<Users className="w-5 h-5" />} />
        <StatCard title="This Month" value={myVisits.filter(v => v.date.startsWith(todayStr.slice(0, 7))).length} icon={<Navigation className="w-5 h-5" />} />
      </div>

      <div>
        <h2 className="font-semibold mb-3">Recent Visits</h2>
        {myVisits.length === 0 ? (
          <p className="text-muted-foreground text-sm">No visits logged yet. Start prospecting!</p>
        ) : (
          <div className="space-y-3">
            {[...myVisits].reverse().map(visit => (
              <Card key={visit.id} className="shadow-card">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold">{visit.location}</h3>
                      {visit.society && <p className="text-sm text-muted-foreground">{visit.society}</p>}
                      {visit.notes && <p className="text-sm mt-1">{visit.notes}</p>}
                    </div>
                    <div className="text-right text-sm text-muted-foreground">
                      <p>{visit.date}</p>
                      <Button size="sm" variant="ghost" className="mt-1 gap-1" onClick={() => window.open(`https://maps.google.com/?q=${encodeURIComponent(visit.location)}`, "_blank")}>
                        <Navigation className="w-3 h-3" />Map
                      </Button>
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
