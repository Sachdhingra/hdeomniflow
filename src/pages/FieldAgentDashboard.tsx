import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import StatCard from "@/components/StatCard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MapPin, Clock, CheckCircle, Navigation, Phone, Camera, Wrench, Truck } from "lucide-react";
import { toast } from "sonner";

const FieldAgentDashboard = () => {
  const { user } = useAuth();
  const { serviceJobs, updateServiceJob } = useData();
  const [completeDialog, setCompleteDialog] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [gpsActive, setGpsActive] = useState(false);

  const myJobs = serviceJobs.filter(j => j.assignedAgent === user?.id);
  const todayStr = new Date().toISOString().split("T")[0];
  const todayJobs = myJobs.filter(j => j.dateToAttend === todayStr);
  const completedJobs = myJobs.filter(j => j.status === "completed");
  const activeJobs = myJobs.filter(j => j.status === "in_progress");

  const handleAccept = (id: string) => {
    updateServiceJob(id, {
      status: "in_progress",
      acceptedAt: new Date().toISOString(),
      travelStartedAt: new Date().toISOString(),
    });
    setGpsActive(true);
    toast.success("Job accepted! GPS tracking started. 📍");
  };

  const handleReached = (id: string) => {
    updateServiceJob(id, { agentReachedAt: new Date().toISOString() });
    toast.success("Location reached! Service head notified. ✅");
  };

  const handleComplete = () => {
    if (!completeDialog) return;
    if (!remarks.trim()) {
      toast.error("Please add remarks before completing");
      return;
    }
    updateServiceJob(completeDialog, {
      status: "completed",
      completedAt: new Date().toISOString(),
      remarks,
      photos: ["photo_placeholder.jpg"], // In real app, this would be actual uploaded photos
    });
    toast.success("Job completed! 🎉");
    setCompleteDialog(null);
    setRemarks("");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">My Jobs</h1>
          <p className="text-sm text-muted-foreground">Today's assigned service & delivery visits</p>
        </div>
        {gpsActive && (
          <Badge className="bg-success/10 text-success gap-1 animate-pulse">
            <MapPin className="w-3 h-3" />GPS Active
          </Badge>
        )}
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
            <Card
              key={job.id}
              className={`shadow-card ${job.status === "completed" ? "border-success/30 bg-success/5" : job.status === "in_progress" ? "border-primary/30" : ""}`}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-lg">{job.customerName}</h3>
                      {job.type === "delivery" && <Badge variant="outline" className="gap-1"><Truck className="w-3 h-3" />Delivery</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">{job.description}</p>
                    <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{job.customerPhone}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground">
                      <MapPin className="w-3.5 h-3.5" />{job.address}
                    </div>
                  </div>
                  <Badge className={
                    job.status === "completed" ? "bg-success/10 text-success" :
                    job.status === "in_progress" ? "bg-primary/10 text-primary" :
                    "bg-warning/10 text-warning"
                  }>{job.status.replace("_", " ")}</Badge>
                </div>

                {/* Timestamps */}
                <div className="text-xs space-y-0.5 text-muted-foreground">
                  {job.acceptedAt && <p>✅ Accepted: {new Date(job.acceptedAt).toLocaleTimeString("en-IN")}</p>}
                  {job.travelStartedAt && <p>🚗 Travel started: {new Date(job.travelStartedAt).toLocaleTimeString("en-IN")}</p>}
                  {job.agentReachedAt && <p className="text-success">📍 Reached: {new Date(job.agentReachedAt).toLocaleTimeString("en-IN")}</p>}
                  {job.completedAt && <p className="text-success">🎉 Completed: {new Date(job.completedAt).toLocaleTimeString("en-IN")}</p>}
                </div>

                {/* Action buttons - large for mobile */}
                <div className="flex gap-2 flex-wrap">
                  {job.status === "assigned" && (
                    <Button size="lg" className="gradient-primary gap-2 flex-1 min-h-[48px] text-base" onClick={() => handleAccept(job.id)}>
                      <Navigation className="w-5 h-5" />Accept & Start GPS
                    </Button>
                  )}
                  {job.status === "in_progress" && !job.agentReachedAt && (
                    <Button size="lg" variant="outline" className="gap-2 flex-1 min-h-[48px] text-base" onClick={() => handleReached(job.id)}>
                      <MapPin className="w-5 h-5" />I've Reached
                    </Button>
                  )}
                  {job.status === "in_progress" && job.agentReachedAt && !job.completedAt && (
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

      {/* Job Completion Dialog */}
      <Dialog open={!!completeDialog} onOpenChange={open => { if (!open) setCompleteDialog(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Complete Job</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Upload Site Photos (mandatory)</Label>
              <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                <Camera className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Tap to capture or upload photos</p>
                <Input type="file" accept="image/*" multiple className="mt-2" capture="environment" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Remarks *</Label>
              <Textarea value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Job details, issues faced, etc." rows={3} />
            </div>
            <Button className="w-full gradient-primary min-h-[48px] text-base" onClick={handleComplete}>
              ✅ Mark as Completed
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FieldAgentDashboard;
