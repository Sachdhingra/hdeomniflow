import { useData, LeadStatus } from "@/contexts/DataContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IndianRupee } from "lucide-react";

const PIPELINE_STAGES: { status: LeadStatus; label: string; color: string }[] = [
  { status: "new", label: "New", color: "border-l-primary" },
  { status: "contacted", label: "Contacted", color: "border-l-muted-foreground" },
  { status: "follow_up", label: "Follow Up", color: "border-l-warning" },
  { status: "negotiation", label: "Negotiation", color: "border-l-accent" },
  { status: "won", label: "Won", color: "border-l-success" },
  { status: "lost", label: "Lost", color: "border-l-destructive" },
  { status: "overdue", label: "Overdue", color: "border-l-destructive" },
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {PIPELINE_STAGES.map(stage => {
          const stageLeads = salesLeads.filter(l => l.status === stage.status);
          const total = stageLeads.reduce((s, l) => s + Number(l.value_in_rupees), 0);
          return (
            <Card key={stage.status} className={`border-l-4 ${stage.color} ${stage.status === "overdue" ? "bg-destructive/5" : ""}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">{stage.label}</CardTitle>
                  <Badge variant="outline" className={stage.status === "overdue" ? "bg-destructive/10 text-destructive" : ""}>{stageLeads.length}</Badge>
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <IndianRupee className="w-3 h-3" />₹{total.toLocaleString("en-IN")}
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                {stageLeads.map(lead => (
                  <div key={lead.id} className={`p-2 rounded-md ${stage.status === "overdue" ? "bg-destructive/10" : "bg-muted/50"}`}>
                    <p className="text-sm font-medium">{lead.customer_name}</p>
                    <p className="text-xs text-muted-foreground">₹{Number(lead.value_in_rupees).toLocaleString("en-IN")}</p>
                    {lead.next_follow_up_date && (
                      <p className={`text-xs mt-0.5 ${stage.status === "overdue" ? "text-destructive" : "text-muted-foreground"}`}>
                        📅 {lead.next_follow_up_date}
                      </p>
                    )}
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
