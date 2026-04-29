import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingDown, MessageSquare, MapPin, Package, Users } from "lucide-react";
import { toast } from "sonner";
import { STAGE_META, type JourneyStage } from "@/lib/messageTemplates";

const STAGE_ORDER: (JourneyStage | "cold")[] = ["problem", "exploration", "evaluation", "reassurance", "decision", "cold"];
const STAGE_LABELS: Record<string, string> = {
  problem: "Problem", exploration: "Exploration", evaluation: "Evaluation",
  reassurance: "Reassurance", decision: "Decision", cold: "Cold",
};

interface LeadRow {
  id: string;
  journey_stage: string | null;
  journey_stage_changed_at: string | null;
  status: string;
  neighborhood: string | null;
  category: string | null;
  created_at: string;
  conversion_probability: number | null;
}

interface MsgRow {
  id: string;
  lead_id: string;
  template_id: string | null;
  template_used: string | null;
  status: string;
  message_type: string;
  journey_stage: string | null;
  sent_at: string | null;
}

const AdminFunnelAnalytics = () => {
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [messages, setMessages] = useState<MsgRow[]>([]);
  const [wonIds, setWonIds] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    try {
      const { data: leadData, error: e1 } = await supabase
        .from("leads")
        .select("id, journey_stage, journey_stage_changed_at, status, neighborhood, category, created_at, conversion_probability")
        .is("deleted_at", null)
        .limit(2000);
      if (e1) throw e1;

      const { data: msgData, error: e2 } = await supabase
        .from("lead_messages")
        .select("id, lead_id, template_id, template_used, status, message_type, journey_stage, sent_at")
        .eq("message_type", "outbound")
        .limit(5000);
      if (e2) throw e2;

      setLeads((leadData ?? []) as LeadRow[]);
      setMessages((msgData ?? []) as MsgRow[]);
      setWonIds(new Set((leadData ?? []).filter(l => ["won", "converted"].includes(l.status)).map(l => l.id)));
    } catch (err: any) {
      toast.error(err.message || "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // 1. Stage distribution (funnel)
  const funnel = useMemo(() => {
    const counts: Record<string, number> = {};
    STAGE_ORDER.forEach(s => counts[s] = 0);
    leads.forEach(l => {
      const s = l.journey_stage || "exploration";
      if (counts[s] != null) counts[s]++;
    });
    const max = Math.max(1, ...Object.values(counts));
    return STAGE_ORDER.map(s => ({ stage: s, count: counts[s], pct: Math.round((counts[s] / max) * 100) }));
  }, [leads]);

  // 2. Avg conversion time (created_at -> won/converted updated_at proxy: stage changed)
  const avgConversionDays = useMemo(() => {
    const won = leads.filter(l => ["won", "converted"].includes(l.status));
    if (won.length === 0) return null;
    const total = won.reduce((s, l) => {
      const days = Math.max(0, (Date.now() - new Date(l.created_at).getTime()) / 86400000);
      return s + days;
    }, 0);
    return Math.round(total / won.length);
  }, [leads]);

  // 3. Bottleneck = stage with biggest drop-off vs next stage (excluding cold)
  const bottleneck = useMemo(() => {
    const live = funnel.filter(f => f.stage !== "cold");
    let worst = { stage: "—", dropPct: 0 };
    for (let i = 0; i < live.length - 1; i++) {
      const a = live[i].count, b = live[i + 1].count;
      if (a === 0) continue;
      const drop = Math.round(((a - b) / a) * 100);
      if (drop > worst.dropPct) worst = { stage: STAGE_LABELS[live[i].stage], dropPct: drop };
    }
    return worst;
  }, [funnel]);

  // 4. Response rate by stage (msgs sent vs leads in stage)
  const responseByStage = useMemo(() => {
    const sentByStage: Record<string, number> = {};
    messages.forEach(m => {
      const s = m.journey_stage || "exploration";
      sentByStage[s] = (sentByStage[s] || 0) + 1;
    });
    return STAGE_ORDER.filter(s => s !== "cold").map(s => {
      const leadsInStage = funnel.find(f => f.stage === s)?.count || 0;
      const sent = sentByStage[s] || 0;
      return { stage: STAGE_LABELS[s], leads: leadsInStage, sent };
    });
  }, [messages, funnel]);

  // 5. Template effectiveness — which templates closed deals (sent to leads that ended up won)
  const templateEffectiveness = useMemo(() => {
    const map = new Map<string, { name: string; sent: number; converted: number }>();
    messages.forEach(m => {
      if (!m.template_used) return;
      const e = map.get(m.template_used) ?? { name: m.template_used, sent: 0, converted: 0 };
      e.sent++;
      if (wonIds.has(m.lead_id)) e.converted++;
      map.set(m.template_used, e);
    });
    return Array.from(map.values())
      .sort((a, b) => (b.converted / Math.max(1, b.sent)) - (a.converted / Math.max(1, a.sent)))
      .slice(0, 8);
  }, [messages, wonIds]);

  // 6. Neighborhood patterns
  const neighborhoodStats = useMemo(() => {
    const map = new Map<string, { name: string; total: number; won: number }>();
    leads.forEach(l => {
      const n = l.neighborhood || "Unknown";
      const e = map.get(n) ?? { name: n, total: 0, won: 0 };
      e.total++;
      if (["won", "converted"].includes(l.status)) e.won++;
      map.set(n, e);
    });
    return Array.from(map.values())
      .filter(n => n.total >= 1)
      .sort((a, b) => (b.won / Math.max(1, b.total)) - (a.won / Math.max(1, a.total)))
      .slice(0, 6);
  }, [leads]);

  // 7. Category patterns
  const categoryStats = useMemo(() => {
    const map = new Map<string, { name: string; total: number; won: number }>();
    leads.forEach(l => {
      const n = l.category || "Unknown";
      const e = map.get(n) ?? { name: n, total: 0, won: 0 };
      e.total++;
      if (["won", "converted"].includes(l.status)) e.won++;
      map.set(n, e);
    });
    return Array.from(map.values())
      .sort((a, b) => (b.won / Math.max(1, b.total)) - (a.won / Math.max(1, a.total)))
      .slice(0, 6);
  }, [leads]);

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Funnel Analytics</h1>
        <p className="text-sm text-muted-foreground">Psychology funnel performance — bottlenecks, template impact, and conversion patterns.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Active leads</div>
          <p className="text-2xl font-bold">{leads.filter(l => !["won", "lost", "converted"].includes(l.status)).length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Avg conversion time</div>
          <p className="text-2xl font-bold">{avgConversionDays != null ? `${avgConversionDays}d` : "—"}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingDown className="w-3 h-3" />Bottleneck stage</div>
          <p className="text-lg font-bold">{bottleneck.stage}</p>
          <p className="text-xs text-destructive">{bottleneck.dropPct}% drop</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Won this period</div>
          <p className="text-2xl font-bold text-success">{wonIds.size}</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Stage funnel</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {funnel.map(f => (
            <div key={f.stage} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{STAGE_LABELS[f.stage]}</span>
                <span className="text-muted-foreground">{f.count} leads</span>
              </div>
              <div className="h-6 bg-muted rounded overflow-hidden">
                <div className="h-full gradient-primary" style={{ width: `${f.pct}%` }} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><MessageSquare className="w-4 h-4" />Messages by stage</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {responseByStage.map(r => (
              <div key={r.stage} className="flex items-center justify-between text-sm border-b last:border-0 pb-1">
                <span>{r.stage}</span>
                <span className="text-muted-foreground">{r.sent} sent / {r.leads} leads</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Package className="w-4 h-4" />Template effectiveness</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {templateEffectiveness.length === 0 && <p className="text-sm text-muted-foreground">No template messages sent yet.</p>}
            {templateEffectiveness.map(t => (
              <div key={t.name} className="flex items-center justify-between text-sm border-b last:border-0 pb-1">
                <span className="truncate flex-1">{t.name}</span>
                <Badge variant={t.converted > 0 ? "default" : "outline"} className="text-[10px]">
                  {t.converted}/{t.sent} ({Math.round((t.converted / Math.max(1, t.sent)) * 100)}%)
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><MapPin className="w-4 h-4" />Top neighborhoods (conversion)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {neighborhoodStats.map(n => (
              <div key={n.name} className="flex items-center justify-between text-sm border-b last:border-0 pb-1">
                <span>{n.name}</span>
                <span className="text-muted-foreground">{n.won}/{n.total} ({Math.round((n.won / n.total) * 100)}%)</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" />Top categories (conversion)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {categoryStats.map(c => (
              <div key={c.name} className="flex items-center justify-between text-sm border-b last:border-0 pb-1">
                <span className="capitalize">{c.name.replace("_", " ")}</span>
                <span className="text-muted-foreground">{c.won}/{c.total} ({Math.round((c.won / c.total) * 100)}%)</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AdminFunnelAnalytics;
