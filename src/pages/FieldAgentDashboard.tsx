import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { useGeolocation, distanceMeters } from "@/hooks/useGeolocation";
import StatCard from "@/components/StatCard";
import ServiceJobPhotoUpload from "@/components/ServiceJobPhotoUpload";
import LeadForm from "@/components/LeadForm";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MapPin, Clock, CheckCircle, Navigation, Phone, Wrench, Truck } from "lucide-react";
import { toast } from "sonner";
import LoadingError from "@/components/LoadingError";
import { DashboardSkeleton } from "@/components/DashboardSkeleton";

const AUTO_REACH_RADIUS_M = 100;

const FieldAgentDashboard = () => {
  const { user } = useAuth();
  const { serviceJobs, updateServiceJob, error, retryLoad, loading, leads, profiles } = useData();
  const getLeadOwner = (sourceLeadId: string | null) => {
    if (!sourceLeadId) return null;
    const lead = leads.find(l => l.id === sourceLeadId);
    if (!lead) return null;
    return profiles.find(p => p.id === lead.created_by) || null;
  };
  const [completeDialog, setCompleteDialog] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [gpsActive, setGpsActive] = useState(false);
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);

  const myJobs = serviceJobs.filter(j => j.assigned_agent === user?.id);
  const todayStr = new Date().toISOString().split("T")[0];
  const todayJobs = myJobs.filter(j => j.date_to_attend === todayStr);
  const completedJobs = myJobs.filter(j => j.status === "completed");
  const activeJobs = myJobs.filter(j => ["in_progress", "on_route", "on_site"].includes(j.status));

  const handleAccept = async (id: string) => {
    await updateServiceJob(id, {
      status: "on_route" as any,
      accepted_at: new Date().toISOString(),
      travel_started_at: new Date().toISOString(),
    });
    setGpsActive(true);
    toast.success("Job accepted! On route. 🚗");
  };

  const handleReached = async (id: string) => {
    await updateServiceJob(id, {
      status: "on_site" as any,
      agent_reached_at: new Date().toISOString(),
    });
    toast.success("Marked as on site! ✅");
  };

  const handleComplete = async () => {
    if (!completeDialog) return;
    if (uploadedUrls.length === 0) {
      toast.error("Upload photos first");
      return;
    }
    if (!remarks.trim()) {
      toast.error("Please add remarks before completing");
      return;
    }

    try {
      await updateServiceJob(completeDialog, {
        status: "completed",
        completed_at: new Date().toISOString(),
        remarks,
        photos: uploadedUrls,
      });
      toast.success("Job completed with photos! 🎉");
      resetDialog();
    } catch {
      toast.error("Failed to save. Photos uploaded — try again.");
    }
  };

  const resetDialog = () => {
    setCompleteDialog(null);
    setRemarks("");
    setUploadedUrls([]);
  };

  const statusLabel = (status: string) => {
    const map: Record<string, string> = {
      assigned: "Assigned", on_route: "On Route", on_site: "On Site",
      in_progress: "In Progress", completed: "Completed", pending: "Pending",
      rescheduled: "Rescheduled",
    };
    return map[status] || status;
  };

  const statusColor = (status: string) => {
    if (status === "completed") return "bg-success/10 text-success";
    if (status === "on_route") return "bg-primary/10 text-primary";
    if (status === "on_site") return "bg-accent/10 text-accent-foreground";
    if (status === "in_progress") return "bg-primary/10 text-primary";
    if (status === "rescheduled") return "bg-warning/10 text-warning";
    return "bg-warning/10 text-warning";
  };

  if (error && myJobs.length === 0) return <LoadingError message={error} onRetry={retryLoad} />;
  if (loading && myJobs.length === 0) return <DashboardSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">My Jobs</h1>
          <p className="text-sm text-muted-foreground">Today's assigned service & delivery visits</p>
        </div>
        <div className="flex items-center gap-2">
          <LeadForm source="field_agent" />
          {gpsActive && (
            <Badge className="bg-success/10 text-success gap-1 animate-pulse"><MapPin className="w-3 h-3" />GPS Active</Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Today's Jobs" value={todayJobs.length} icon={<Clock className="w-5 h-5" />} />
        <StatCard title="Active" value={activeJobs.length} icon={<Navigation className="w-5 h-5" />} />
        <StatCard title="Completed" value={completedJobs.length} icon={<CheckCircle className="w-5 h-5" />} />
        <StatCard title="Total Assigned" value={myJobs.length} icon={<Wrench className="w-5 h-5" />} />
      </div>

      {myJobs.length === 0 ? (
        <Card className="shadow-card"><CardContent className="p-8 text-center text-muted-foreground">No jobs assigned yet.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {myJobs.map(job => (
            <Card key={job.id} className={`shadow-card ${job.status === "completed" ? "border-success/30 bg-success/5" : ["on_route", "on_site", "in_progress"].includes(job.status) ? "border-primary/30" : ""}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-lg">{job.customer_name}</h3>
                      {job.type === "delivery" && <Badge variant="outline" className="gap-1"><Truck className="w-3 h-3" />Delivery</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">{job.description}</p>
                    <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{job.customer_phone}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground">
                      <MapPin className="w-3.5 h-3.5" />{job.address}
                    </div>
                    {(() => {
                      const owner = getLeadOwner(job.source_lead_id);
                      return owner ? (
                        <p className="text-xs text-muted-foreground mt-1">
                          Salesperson: <span className="font-medium text-foreground">{owner.name}</span>
                          {owner.phone_number && (
                            <> · <a href={`tel:${owner.phone_number}`} className="text-primary underline" onClick={e => e.stopPropagation()}>{owner.phone_number}</a></>
                          )}
                        </p>
                      ) : null;
                    })()}
                  </div>
                  <Badge className={statusColor(job.status)}>{statusLabel(job.status)}</Badge>
                </div>

                <div className="text-xs space-y-0.5 text-muted-foreground">
                  {job.accepted_at && <p>✅ Accepted: {new Date(job.accepted_at).toLocaleTimeString("en-IN")}</p>}
                  {job.travel_started_at && <p>🚗 On Route: {new Date(job.travel_started_at).toLocaleTimeString("en-IN")}</p>}
                  {job.agent_reached_at && <p className="text-success">📍 On Site: {new Date(job.agent_reached_at).toLocaleTimeString("en-IN")}</p>}
                  {job.completed_at && <p className="text-success">🎉 Completed: {new Date(job.completed_at).toLocaleTimeString("en-IN")}</p>}
                </div>

                {job.photos && job.photos.length > 0 && job.photos[0] !== "" && (
                  <div className="flex gap-2 flex-wrap">
                    {job.photos.filter(p => p.startsWith("http")).map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                        <img src={url} alt={`Photo ${i + 1}`} className="w-16 h-16 rounded-lg object-cover border border-border" loading="lazy" />
                      </a>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 flex-wrap">
                  {job.status === "assigned" && (
                    <Button size="lg" className="gradient-primary gap-2 flex-1 min-h-[48px] text-base" onClick={() => handleAccept(job.id)}>
                      <Navigation className="w-5 h-5" />Accept & Start
                    </Button>
                  )}
                  {["on_route", "in_progress"].includes(job.status) && !job.agent_reached_at && (
                    <Button size="lg" variant="outline" className="gap-2 flex-1 min-h-[48px] text-base" onClick={() => handleReached(job.id)}>
                      <MapPin className="w-5 h-5" />I've Reached
                    </Button>
                  )}
                  {["on_site", "in_progress"].includes(job.status) && job.agent_reached_at && !job.completed_at && (
                    <Button size="lg" className="bg-success text-success-foreground gap-2 flex-1 min-h-[48px] text-base" onClick={() => setCompleteDialog(job.id)}>
                      <CheckCircle className="w-5 h-5" />Complete Job
                    </Button>
                  )}
                  <Button size="lg" variant="outline" className="gap-2 min-h-[48px]" onClick={() => window.open(`https://maps.google.com/?q=${encodeURIComponent(job.address)}`, "_blank")}>
                    <MapPin className="w-5 h-5" />Navigate
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!completeDialog} onOpenChange={open => { if (!open) resetDialog(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Complete Job</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Upload Site Photos (mandatory, auto-compressed)</Label>
              {completeDialog && (
                <ServiceJobPhotoUpload
                  jobId={completeDialog}
                  onUploadComplete={(urls) => setUploadedUrls(urls)}
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Remarks *</Label>
              <Textarea value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Job details, issues faced, etc." rows={3} />
            </div>

            <Button
              className="w-full gradient-primary min-h-[48px] text-base"
              onClick={handleComplete}
              disabled={uploadedUrls.length === 0 || !remarks.trim()}
            >
              ✅ Mark as Completed
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FieldAgentDashboard;
