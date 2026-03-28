import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Clock, CheckCircle, Navigation, Phone } from "lucide-react";
import { toast } from "sonner";

const FieldAgentDashboard = () => {
  const { user } = useAuth();
  const { serviceJobs, updateServiceJob } = useData();
  const myJobs = serviceJobs.filter(j => j.assignedAgent === user?.id);

  const handleAccept = (id: string) => {
    updateServiceJob(id, { status: "in_progress" });
    toast.success("Job accepted! GPS tracking started.");
  };

  const handleReached = (id: string) => {
    updateServiceJob(id, { agentReachedAt: new Date().toISOString() });
    toast.success("Location reached! Service head notified.");
  };

  const handleComplete = (id: string) => {
    updateServiceJob(id, { status: "completed", completedAt: new Date().toISOString() });
    toast.success("Job completed!");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Jobs</h1>
        <p className="text-sm text-muted-foreground">Today's assigned service visits</p>
      </div>

      {myJobs.length === 0 ? (
        <Card className="shadow-card"><CardContent className="p-8 text-center text-muted-foreground">No jobs assigned yet.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {myJobs.map(job => (
            <Card key={job.id} className="shadow-card">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">{job.customerName}</h3>
                    <p className="text-sm text-muted-foreground">{job.description}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{job.customerPhone}</span>
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{job.address}</span>
                    </div>
                  </div>
                  <Badge>{job.status.replace("_", " ")}</Badge>
                </div>

                {job.agentReachedAt && (
                  <p className="text-xs text-success flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />Reached at {new Date(job.agentReachedAt).toLocaleTimeString()}
                  </p>
                )}
                {job.completedAt && (
                  <p className="text-xs text-success flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />Completed at {new Date(job.completedAt).toLocaleTimeString()}
                  </p>
                )}

                <div className="flex gap-2 flex-wrap">
                  {job.status === "assigned" && (
                    <Button size="sm" className="gradient-primary gap-1" onClick={() => handleAccept(job.id)}>
                      <Navigation className="w-3.5 h-3.5" />Accept & Start GPS
                    </Button>
                  )}
                  {job.status === "in_progress" && !job.agentReachedAt && (
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => handleReached(job.id)}>
                      <MapPin className="w-3.5 h-3.5" />Mark Reached
                    </Button>
                  )}
                  {job.status === "in_progress" && job.agentReachedAt && !job.completedAt && (
                    <Button size="sm" className="bg-success text-success-foreground gap-1" onClick={() => handleComplete(job.id)}>
                      <CheckCircle className="w-3.5 h-3.5" />Complete Job
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => window.open(`https://maps.google.com/?q=${encodeURIComponent(job.address)}`, "_blank")}>
                    <MapPin className="w-3.5 h-3.5" />Open Map
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default FieldAgentDashboard;
