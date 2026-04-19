import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trophy, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

interface Row {
  user_id: string;
  name: string;
  total: number;
  won: number;
  wonValue: number;
  pipelineValue: number;
  conversion: number;
}

const TeamPerformancePanel = ({ compact = false }: { compact?: boolean }) => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Get sales + site_agent users
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("role", ["sales", "site_agent"]);
      const ids = Array.from(new Set((roles ?? []).map(r => r.user_id)));
      if (!ids.length) { setRows([]); setLoading(false); return; }

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, name")
        .in("id", ids);
      const nameMap = new Map((profiles ?? []).map(p => [p.id, p.name]));

      const { data: leads } = await supabase
        .from("leads")
        .select("created_by, status, value_in_rupees")
        .is("deleted_at", null)
        .in("created_by", ids);

      const agg = new Map<string, Row>();
      ids.forEach(id => agg.set(id, {
        user_id: id, name: nameMap.get(id) || "Unknown",
        total: 0, won: 0, wonValue: 0, pipelineValue: 0, conversion: 0,
      }));
      (leads ?? []).forEach(l => {
        const r = agg.get(l.created_by);
        if (!r) return;
        r.total += 1;
        r.pipelineValue += Number(l.value_in_rupees);
        if (l.status === "won") {
          r.won += 1;
          r.wonValue += Number(l.value_in_rupees);
        }
      });
      const list = Array.from(agg.values()).map(r => ({
        ...r,
        conversion: r.total > 0 ? Math.round((r.won / r.total) * 100) : 0,
      })).sort((a, b) => b.wonValue - a.wonValue);

      setRows(compact ? list.slice(0, 5) : list);
      setLoading(false);
    })();
  }, [compact]);

  return (
    <Card className="shadow-card">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Trophy className="w-4 h-4 text-primary" /> Team Performance
        </CardTitle>
        {compact && (
          <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
            <Link to="/sales-leaderboard">View all</Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No salespeople found.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Salesperson</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Won</TableHead>
                  <TableHead className="text-right">Conv %</TableHead>
                  <TableHead className="text-right">Won ₹</TableHead>
                  <TableHead className="text-right">Pipeline ₹</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={r.user_id}>
                    <TableCell className="font-medium">
                      {i === 0 && !compact && <Badge className="mr-2 bg-warning/10 text-warning">🥇</Badge>}
                      {r.name}
                    </TableCell>
                    <TableCell className="text-right">{r.total}</TableCell>
                    <TableCell className="text-right text-success font-semibold">{r.won}</TableCell>
                    <TableCell className="text-right">{r.conversion}%</TableCell>
                    <TableCell className="text-right">₹{r.wonValue.toLocaleString("en-IN")}</TableCell>
                    <TableCell className="text-right text-muted-foreground">₹{r.pipelineValue.toLocaleString("en-IN")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default TeamPerformancePanel;
