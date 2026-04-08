import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Target, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

const AdminSalesTargets = () => {
  const { allProfiles } = useAuth();
  const { leads } = useData();
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [existingTargets, setExistingTargets] = useState<Record<string, number>>({});

  const currentMonth = new Date().toISOString().slice(0, 7);
  const salesProfiles = allProfiles.filter(p => p.role === "sales");

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
              const wonValue = leads
                .filter(l => l.status === "won" && l.assigned_to === sp.id && l.updated_at?.startsWith(currentMonth))
                .reduce((s, l) => s + Number(l.value_in_rupees), 0);
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
