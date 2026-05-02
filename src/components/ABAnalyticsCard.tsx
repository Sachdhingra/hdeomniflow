import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, FlaskConical } from "lucide-react";

interface Row {
  variant_id: string;
  template_id: string;
  template_title: string;
  stage: string;
  variant_label: string;
  sent_count: number;
  reply_count: number;
  reply_rate_pct: number;
  is_active: boolean;
}

const ABAnalyticsCard = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.role !== "admin") return;
    (async () => {
      const { data } = await supabase
        .from("template_variant_performance" as any)
        .select("*")
        .order("template_title");
      setRows((data as Row[]) || []);
      setLoading(false);
    })();
  }, [user]);

  if (user?.role !== "admin") return null;

  // Group by template to pick winner
  const byTemplate = new Map<string, Row[]>();
  for (const r of rows) {
    const arr = byTemplate.get(r.template_title) ?? [];
    arr.push(r);
    byTemplate.set(r.template_title, arr);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="w-4 h-4" />A/B Variant Performance
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No variants tracked yet. Variants are created by admin and rotated automatically by the nurture engine.</p>
        ) : (
          <div className="space-y-3">
            {Array.from(byTemplate.entries()).map(([title, variants]) => {
              const winner = [...variants].sort((a, b) => b.reply_rate_pct - a.reply_rate_pct)[0];
              return (
                <div key={title} className="space-y-1.5">
                  <p className="font-medium text-sm">{title}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {variants.map(v => (
                      <div key={v.variant_id} className={`rounded p-2 border text-xs ${winner?.variant_id === v.variant_id && v.sent_count > 0 ? "border-success/40 bg-success/5" : "border-border"}`}>
                        <div className="flex items-center justify-between mb-1">
                          <Badge variant="secondary" className="text-[10px]">Variant {v.variant_label}</Badge>
                          {winner?.variant_id === v.variant_id && v.sent_count > 0 && (
                            <Badge className="text-[10px] bg-success/15 text-success border-success/30 border">winning</Badge>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-1 text-center">
                          <div><p className="text-[10px] text-muted-foreground">Sent</p><p className="font-bold">{v.sent_count}</p></div>
                          <div><p className="text-[10px] text-muted-foreground">Replies</p><p className="font-bold">{v.reply_count}</p></div>
                          <div><p className="text-[10px] text-muted-foreground">Reply %</p><p className="font-bold">{v.reply_rate_pct}%</p></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ABAnalyticsCard;
