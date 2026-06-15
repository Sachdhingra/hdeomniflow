import { useMemo, useState } from "react";
import { useData } from "@/contexts/DataContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserPlus, Inbox } from "lucide-react";
import LeadAssignmentModal from "./LeadAssignmentModal";

const UnassignedLeadsCard = () => {
  const { leads } = useData();
  const [openLead, setOpenLead] = useState<{ id: string; name: string } | null>(null);

  const unassigned = useMemo(
    () => leads.filter(l => !l.assigned_to && !l.deleted_at).sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ),
    [leads]
  );

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Inbox className="w-4 h-4" /> Unassigned Leads
            <Badge variant={unassigned.length > 0 ? "destructive" : "secondary"}>{unassigned.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {unassigned.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">All leads are assigned ✓</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {unassigned.slice(0, 20).map(l => (
                <div key={l.id} className="flex items-center justify-between gap-2 p-2 rounded border bg-card hover:bg-muted/40 transition">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{l.customer_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {l.customer_phone} · ₹{Number(l.value_in_rupees).toLocaleString("en-IN")} · {l.category}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" className="gap-1 shrink-0"
                    onClick={() => setOpenLead({ id: l.id, name: l.customer_name })}>
                    <UserPlus className="w-3.5 h-3.5" /> Assign
                  </Button>
                </div>
              ))}
              {unassigned.length > 20 && (
                <p className="text-xs text-center text-muted-foreground pt-1">+ {unassigned.length - 20} more</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      {openLead && (
        <LeadAssignmentModal
          open={!!openLead}
          onOpenChange={(v) => !v && setOpenLead(null)}
          leadId={openLead.id}
          customerName={openLead.name}
          currentAssignee={null}
        />
      )}
    </>
  );
};

export default UnassignedLeadsCard;
