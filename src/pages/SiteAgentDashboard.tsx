import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData, LEAD_CATEGORIES, LeadCategory } from "@/contexts/DataContext";
import { useGeolocation } from "@/hooks/useGeolocation";
import StatCard from "@/components/StatCard";
import LeadForm from "@/components/LeadForm";
import SiteVisitForm from "@/components/SiteVisitForm";
import SiteVisitLocationDialog from "@/components/SiteVisitLocationDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, Navigation, Home, Users, Play, Square, Route, ArrowRightCircle } from "lucide-react";
import { toast } from "sonner";

const SiteAgentDashboard = () => {
  const { user } = useAuth();
  const { siteVisits, addLead, updateSiteVisit, leads } = useData();
  const [tripStarted, setTripStarted] = useState(false);
  const [tripStartTime, setTripStartTime] = useState<Date | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  // Real GPS odometer — only active during a trip
  const { kmTraveled, position, error: gpsError, resetOdometer } = useGeolocation(tripStarted);

  const myVisits = siteVisits.filter(v => v.agent_id === user?.id);
  const myLeads = leads.filter(l =>
    (l as any).created_by_agent_id === user?.id ||
    (l.source === "site_agent" && l.assigned_to === user?.id)
  );
  const todayStr = new Date().toISOString().split("T")[0];
  const todayVisits = myVisits.filter(v => v.date === todayStr);

  const handleStartTrip = () => {
    setTripStarted(true);
    setTripStartTime(new Date());
    resetOdometer();
    toast.success("Trip started! GPS tracking active. 📍");
  };

  const handleEndTrip = () => {
    setTripStarted(false);
    const duration = tripStartTime ? Math.round((Date.now() - tripStartTime.getTime()) / 60000) : 0;
    toast.success(`Trip ended! Duration: ${duration} min · Distance: ${kmTraveled.toFixed(2)} km`);
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
      const visitPhoto = (visit as any).photo_url || (visit.photos && visit.photos[0]) || null;
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
        created_by_agent_id: user?.id || null,
        visit_photo: visitPhoto,
      } as any);
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
        <SiteVisitForm />
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
            {myVisits.map(visit => {
              const photo = (visit as any).photo_url || (visit.photos && visit.photos[0]) || null;
              const lat = (visit as any).lat;
              const lng = (visit as any).lng;
              return (
                <Card key={visit.id} className="shadow-card">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      {photo && (
                        <img
                          src={photo}
                          alt="Site"
                          className="w-16 h-16 rounded object-cover border border-border shrink-0"
                          loading="lazy"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="font-semibold truncate">{visit.location}</h3>
                            {visit.society && <p className="text-sm text-muted-foreground truncate">{visit.society}</p>}
                            {visit.customer_name && (
                              <p className="text-sm mt-1">👤 {visit.customer_name} {visit.customer_phone && `• ${visit.customer_phone}`}</p>
                            )}
                            <div className="flex flex-wrap gap-1 mt-1 items-center">
                              {visit.category && <Badge variant="outline" className="text-xs">{LEAD_CATEGORIES.find(c => c.value === visit.category)?.label}</Badge>}
                              {visit.budget && <span className="text-xs text-muted-foreground">Budget: ₹{Number(visit.budget).toLocaleString("en-IN")}</span>}
                            </div>
                            {visit.notes && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{visit.notes}</p>}
                          </div>
                          <div className="text-right text-xs text-muted-foreground shrink-0 space-y-1">
                            <p>{visit.date}</p>
                            {visit.status && <Badge variant="outline" className="text-xs">{visit.status === "converted" ? "Converted ✅" : visit.status}</Badge>}
                          </div>
                        </div>
                        <div className="flex gap-1 flex-wrap mt-2">
                          {lat != null && lng != null ? (
                            <SiteVisitLocationDialog
                              lat={lat}
                              lng={lng}
                              accuracy={(visit as any).accuracy_meters}
                              capturedAt={(visit as any).gps_timestamp}
                              trigger={
                                <Button size="sm" variant="ghost" className="gap-1 h-7 text-xs">
                                  <MapPin className="w-3 h-3" />Location
                                </Button>
                              }
                            />
                          ) : (
                            <Button size="sm" variant="ghost" className="gap-1 h-7 text-xs" onClick={() => window.open(`https://maps.google.com/?q=${encodeURIComponent(visit.location)}`, "_blank")}>
                              <Navigation className="w-3 h-3" />Map
                            </Button>
                          )}
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SiteAgentDashboard;
