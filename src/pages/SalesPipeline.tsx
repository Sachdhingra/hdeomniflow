import { useData, LeadStatus } from "@/contexts/DataContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IndianRupee } from "lucide-react";

const PIPELINE_STAGES: { status: LeadStatus; label: string; color: string }[] = [
  { status: "new", label: "New", color: "border-l-primary" },
  { status: "contacted", label: "Contacted", color: "border-l-secondary" },
  { status: "follow_up", label: "Follow Up", color: "border-l-warning" },
  { status: "negotiation", label: "Negotiation", color: "border-l-accent" },
  { status: "won", label: "Won", color: "border-l-success" },
  { status: "lost", label: "Lost", color: "border-l-destructive" },
];

const SalesPipeline = () => {
  const { leads } = useData();
  const salesLeads = leads.filter(l => l.source === "sales");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Sales Pipeline</h1>
        <p className="text-sm text-muted-foreground">Track lead progression through stages</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {PIPELINE_STAGES.map(stage => {
          const stageLeads = salesLeads.filter(l => l.status === stage.status);
          const total = stageLeads.reduce((s, l) => s + l.valueInRupees, 0);
          return (
            <Card key={stage.status} className={`border-l-4 ${stage.color}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">{stage.label}</CardTitle>
                  <Badge variant="outline">{stageLeads.length}</Badge>
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <IndianRupee className="w-3 h-3" />₹{total.toLocaleString("en-IN")}
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                {stageLeads.map(lead => (
                  <div key={lead.id} className="p-2 bg-muted/50 rounded-md">
                    <p className="text-sm font-medium">{lead.customerName}</p>
                    <p className="text-xs text-muted-foreground">₹{lead.valueInRupees.toLocaleString("en-IN")}</p>
                  </div>
                ))}
                {stageLeads.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No leads</p>}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default SalesPipeline;
