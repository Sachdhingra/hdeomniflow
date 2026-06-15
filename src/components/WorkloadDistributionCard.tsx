import { useMemo } from "react";
import { useData } from "@/contexts/DataContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users } from "lucide-react";

const CLOSED = new Set(["won", "lost", "converted"]);

const WorkloadDistributionCard = () => {
  const { leads, getProfilesByRole } = useData();
  const sales = getProfilesByRole("sales");

  const rows = useMemo(() => {
    const counts = sales.map(s => {
      const all = leads.filter(l => l.assigned_to === s.id && !l.deleted_at);
      const active = all.filter(l => !CLOSED.has(l.status as string));
      const overdue = all.filter(l => l.status === "overdue");
      return { id: s.id, name: s.name, active: active.length, overdue: overdue.length, total: all.length };
    }).sort((a, b) => b.active - a.active);
    const max = Math.max(1, ...counts.map(c => c.active));
    return { counts, max };
  }, [leads, sales]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="w-4 h-4" /> Workload Distribution
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.counts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No sales staff yet</p>
        ) : (
          <div className="space-y-3">
            {rows.counts.map(r => (
              <div key={r.id}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium truncate">{r.name}</span>
                  <span className="text-muted-foreground text-xs">
                    <span className="text-foreground font-semibold">{r.active}</span> active
                    {r.overdue > 0 && <span className="text-destructive ml-2">{r.overdue} overdue</span>}
                  </span>
                </div>
                <div className="h-2 rounded bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${(r.active / rows.max) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default WorkloadDistributionCard;
