import { useData } from "@/contexts/DataContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

interface Props {
  agentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const AgentTrackingTimeline = ({ agentId, open, onOpenChange }: Props) => {
  const { serviceJobs, profiles } = useData();

  if (!agentId) return null;

  const agent = profiles.find(p => p.id === agentId);
  const agentJobs = serviceJobs
    .filter(j => j.assigned_agent === agentId && j.status !== "pending")
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  const getSteps = (job: typeof agentJobs[0]) => {
    const steps: { label: string; time: string | null; done: boolean }[] = [
      { label: "Job Assigned", time: job.created_at, done: true },
      { label: "Accepted / On Route", time: job.accepted_at || job.travel_started_at, done: !!job.accepted_at || !!job.travel_started_at },
      { label: "Reached Site", time: job.agent_reached_at, done: !!job.agent_reached_at },
      { label: "Completed", time: job.completed_at, done: !!job.completed_at },
    ];
    return steps;
  };

  const statusColor = (status: string) => {
    if (status === "completed") return "bg-success/10 text-success";
    if (["on_route", "on_site"].includes(status)) return "bg-primary/10 text-primary";
    return "bg-warning/10 text-warning";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>📍 Track: {agent?.name || "Agent"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          {agentJobs.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No active/recent jobs.</p>
          )}
          {agentJobs.slice(0, 5).map(job => (
            <div key={job.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm">{job.customer_name}</p>
                <Badge className={statusColor(job.status)}>{job.status.replace("_", " ")}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{job.address}</p>
              {/* Timeline */}
              <div className="relative pl-6 space-y-0">
                {getSteps(job).map((step, i) => (
                  <div key={i} className="relative pb-4 last:pb-0">
                    {/* Vertical line */}
                    {i < getSteps(job).length - 1 && (
                      <div className={`absolute left-[-16px] top-3 w-0.5 h-full ${step.done ? "bg-success" : "bg-border"}`} />
                    )}
                    {/* Dot */}
                    <div className={`absolute left-[-20px] top-1 w-3 h-3 rounded-full border-2 ${step.done ? "bg-success border-success" : "bg-background border-border"}`} />
                    <div>
                      <p className={`text-sm font-medium ${step.done ? "" : "text-muted-foreground"}`}>{step.label}</p>
                      {step.time && (
                        <p className="text-xs text-muted-foreground">
                          {new Date(step.time).toLocaleDateString("en-IN")} - {new Date(step.time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AgentTrackingTimeline;
