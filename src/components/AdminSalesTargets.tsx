import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Target, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

// Achievement is fetched directly from the DB (not from the paginated leads array)
// and filtered by stage_changed_at (set by the trg_track_lead_stage trigger on
// every status change) rather than updated_at (which changes on any field edit).
const AdminSalesTargets = () => {
  const { allProfiles } = useAuth();
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [existingTargets, setExistingTargets] = useState<Record<string, number>>({});
  const [achievedValues, setAchievedValues] = useState<Record<string, number>>({});

  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const salesProfiles = allProfiles.filter(p => p.role === "sales");

  // Fetch targets for the current month
  useEffect(() => {
    const fetchTargets = async () => {
      const { data } = await supabase
        .from("sales_targets")
        .select("user_id, target_value")
        .eq("month", currentMonth);
      if (data) {
        const map: Record<string, number> = {};
        const inputMap: Record<string, string> = {};
        data.forEach(t => {
          map[t.user_id] = Number(t.target_value);
          inputMap[t.user_id] = String(t.target_value);
        });
        setExistingTargets(map);
        setTargets(inputMap);
      }
    };
    fetchTargets();
  }, [currentMonth]);

  // Fetch each rep's monthly won value directly from the DB.
  // Filters by assigned_to and COALESCE(stage_changed_at, updated_at) — matches
  // the same logic used by the dashboard summary RPC so per-rep achievement
  // stays in sync with the team Won-this-month figure.
  useEffect(() => {
    const fetchAchievements = async () => {
      const monthStart = `${currentMonth}-01`;
      const { data } = await supabase
        .from("leads")
        .select("assigned_to, value_in_rupees, stage_changed_at, updated_at")
        .eq("status", "won")
        .is("deleted_at", null)
        .or(`stage_changed_at.gte.${monthStart},and(stage_changed_at.is.null,updated_at.gte.${monthStart})`);

      const map: Record<string, number> = {};
      (data ?? []).forEach(l => {
        if (!l.assigned_to) return;
        const ref = (l.stage_changed_at || l.updated_at || "").slice(0, 7);
        if (ref !== currentMonth) return;
        map[l.assigned_to] = (map[l.assigned_to] ?? 0) + Number(l.value_in_rupees);
      });
      setAchievedValues(map);
    };
    fetchAchievements();
  }, [currentMonth]);

  const handleSave = async (userId: string) => {
    const val = Number(targets[userId] || 0);
    if (val < 0) { toast.error("Target must be positive"); return; }
    setSaving(userId);
    try {
      const { error } = await supabase.from("sales_targets").upsert({
        user_id: userId,
        month: currentMonth,
        target_value: val,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,month" });
      if (error) throw error;
      setExistingTargets(prev => ({ ...prev, [userId]: val }));
      toast.success("Target saved!");
    } catch (e: any) {
      toast.error(e.message || "Failed to save");
    }
    setSaving(null);
  };

  return (
    <Card className="shadow-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" />
          Sales Targets — {new Date().toLocaleString("en-IN", { month: "long", year: "numeric" })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Salesperson</TableHead>
              <TableHead>Target (₹)</TableHead>
              <TableHead>Achieved (₹)</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {salesProfiles.map(sp => {
              const wonValue = achievedValues[sp.id] ?? 0;
              const targetVal = existingTargets[sp.id] || 0;
              const pct = targetVal > 0 ? Math.min(Math.round((wonValue / targetVal) * 100), 100) : 0;

              return (
                <TableRow key={sp.id}>
                  <TableCell className="font-medium">{sp.name}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      className="w-28 h-8 text-sm"
                      value={targets[sp.id] || ""}
                      onChange={e => setTargets(prev => ({ ...prev, [sp.id]: e.target.value }))}
                      placeholder="0"
                    />
                  </TableCell>
                  <TableCell className="font-bold text-success">₹{wonValue.toLocaleString("en-IN")}</TableCell>
                  <TableCell className="min-w-[120px]">
                    {targetVal > 0 ? (
                      <div className="space-y-1">
                        <Progress value={pct} className="h-2" />
                        <span className="text-xs text-muted-foreground">{pct}%</span>
                      </div>
                    ) : (
                      <Badge variant="outline" className="text-xs">No target</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => handleSave(sp.id)} disabled={saving === sp.id}>
                      {saving === sp.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      Save
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {salesProfiles.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">No sales staff</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default AdminSalesTargets;
