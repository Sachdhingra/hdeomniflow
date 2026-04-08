import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Target, TrendingUp } from "lucide-react";

const SalesTargetCard = () => {
  const { user } = useAuth();
  const { leads } = useData();
  const [target, setTarget] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

  useEffect(() => {
    if (!user) return;
    const fetchTarget = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("sales_targets")
        .select("target_value")
        .eq("user_id", user.id)
        .eq("month", currentMonth)
        .maybeSingle();
      setTarget(data ? Number(data.target_value) : 0);
      setLoading(false);
    };
    fetchTarget();
  }, [user, currentMonth]);

  const wonValue = leads
    .filter(l => l.status === "won" && l.assigned_to === user?.id && l.updated_at?.startsWith(currentMonth))
    .reduce((s, l) => s + Number(l.value_in_rupees), 0);

  const percentage = target > 0 ? Math.min(Math.round((wonValue / target) * 100), 100) : 0;
  const remaining = Math.max(target - wonValue, 0);

  if (loading || target === 0) return null;

  return (
    <Card className="shadow-card border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" />Monthly Target
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex justify-between text-sm">
          <span>Target: ₹{target.toLocaleString("en-IN")}</span>
          <span className="font-bold text-success">Achieved: ₹{wonValue.toLocaleString("en-IN")}</span>
        </div>
        <Progress value={percentage} className="h-3" />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{percentage}% achieved</span>
          <span className="flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            ₹{remaining.toLocaleString("en-IN")} remaining
          </span>
        </div>
      </CardContent>
    </Card>
  );
};

export default SalesTargetCard;
