import { useData } from "@/contexts/DataContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle } from "lucide-react";

const ServiceClaims = () => {
  const { serviceJobs } = useData();
  const claims = serviceJobs.filter(j => j.claimPartNo);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Claims</h1>
        <p className="text-sm text-muted-foreground">Parts claims & warranty tracking</p>
      </div>

      {claims.length === 0 ? (
        <p className="text-muted-foreground">No claims raised yet.</p>
      ) : (
        <div className="space-y-3">
          {claims.map(job => {
            const isOverdue = job.claimDueDate && new Date(job.claimDueDate) < new Date();
            return (
              <Card key={job.id} className={`shadow-card ${isOverdue ? "border-destructive/30" : ""}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{job.customerName}</h3>
                        {isOverdue && <Badge className="bg-destructive/10 text-destructive gap-1"><AlertCircle className="w-3 h-3" />Overdue</Badge>}
                      </div>
                      <p className="text-sm mt-1">Part No: <span className="font-mono font-semibold">{job.claimPartNo}</span></p>
                      <p className="text-sm text-muted-foreground">Reason: {job.claimReason}</p>
                    </div>
                    <div className="text-right text-sm">
                      <p className="text-muted-foreground">Due: {job.claimDueDate}</p>
                      <Badge className="mt-1">{job.status.replace("_", " ")}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ServiceClaims;
