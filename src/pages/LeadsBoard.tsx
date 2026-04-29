import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData, LEAD_CATEGORIES, type Lead } from "@/contexts/DataContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Phone, MoveHorizontal, Sparkles, MessageCircle, MapPin, Zap, AlertTriangle, Snowflake } from "lucide-react";
import { toast } from "sonner";
import LeadDetailsDrawer from "@/components/LeadDetailsDrawer";
import SendTemplateDialog from "@/components/SendTemplateDialog";
import { neighborhoodColor, responseTimeColor, formatRelativeTime, PREFERRED_STYLES, BUDGET_RANGES } from "@/lib/leadConstants";
import { type JourneyStage, statusToStage } from "@/lib/messageTemplates";

type LeadAlert = { id: string; lead_id: string; alert_type: string; severity: string; message: string };

const COLUMNS: { stage: JourneyStage | "cold"; label: string; accent: string; sub: string }[] = [
  { stage: "problem",     label: "Problem",     accent: "border-t-destructive",       sub: "Day -30 to 0" },
  { stage: "exploration", label: "Exploration", accent: "border-t-warning",           sub: "Day 0–7" },
  { stage: "evaluation",  label: "Evaluation",  accent: "border-t-accent",            sub: "Day 7–14" },
  { stage: "reassurance", label: "Reassurance", accent: "border-t-primary",           sub: "Day 14–21" },
  { stage: "decision",    label: "Decision",    accent: "border-t-success",           sub: "Day 21+" },
  { stage: "cold",        label: "Cold",        accent: "border-t-muted-foreground",  sub: "No response 7d+" },
];

const ALL_STAGES: { value: JourneyStage | "cold"; label: string }[] = COLUMNS.map(c => ({ value: c.stage, label: c.label }));

const probColor = (p: number) => p >= 70 ? "bg-success/10 text-success" : p >= 40 ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive";

const daysSince = (iso?: string | null) => {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
};

const LeadsBoard = () => {
  const { user } = useAuth();
  const { leads, updateLead } = useData();
  const [selected, setSelected] = useState<Lead | null>(null);
  const [templateLead, setTemplateLead] = useState<Lead | null>(null);
  const [alerts, setAlerts] = useState<LeadAlert[]>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from("lead_alerts")
        .select("id, lead_id, alert_type, severity, message")
        .eq("resolved", false);
      if (mounted) setAlerts((data ?? []) as LeadAlert[]);
    })();
    const ch = supabase
      .channel("lead-alerts")
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_alerts" }, () => {
        supabase.from("lead_alerts").select("id, lead_id, alert_type, severity, message").eq("resolved", false)
          .then(({ data }) => mounted && setAlerts((data ?? []) as LeadAlert[]));
      })
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, []);

  const visibleLeads = useMemo(() => {
    if (user?.role === "admin") return leads;
    return leads.filter(l => l.created_by === user?.id || l.assigned_to === user?.id);
  }, [leads, user]);

  const alertsByLead = useMemo(() => {
    const m = new Map<string, LeadAlert[]>();
    for (const a of alerts) {
      const arr = m.get(a.lead_id) ?? [];
      arr.push(a);
      m.set(a.lead_id, arr);
    }
    return m;
  }, [alerts]);

  const journeyOf = (l: Lead): JourneyStage | "cold" => {
    const j = (l as any).journey_stage as string | null;
    if (j) return j as JourneyStage | "cold";
    return statusToStage(l.status);
  };

  const byStage = useMemo(() => {
    const map: Record<string, Lead[]> = {};
    COLUMNS.forEach(c => { map[c.stage] = []; });
    for (const l of visibleLeads) {
      if (["won", "converted", "lost"].includes(l.status)) continue;
      const s = journeyOf(l);
      if (map[s]) map[s].push(l);
    }
    return map;
  }, [visibleLeads]);

  const stageStats = (stage: string, items: Lead[]) => {
    if (items.length === 0) return { avgDays: 0, needAction: 0 };
    const totalDays = items.reduce((s, l) => s + daysSince((l as any).journey_stage_changed_at ?? l.stage_changed_at ?? l.created_at), 0);
    const needAction = items.filter(l => (alertsByLead.get(l.id)?.length ?? 0) > 0).length;
    return { avgDays: Math.round(totalDays / items.length), needAction };
  };

  const handleMove = async (lead: Lead, newStage: JourneyStage | "cold") => {
    const current = journeyOf(lead);
    if (current === newStage) return;
    try {
      await updateLead(lead.id, { journey_stage: newStage, journey_stage_auto: false } as any);
      toast.success(`Moved to ${newStage}`);
    } catch (e: any) {
      toast.error(e.message || "Failed to move lead");
    }
  };

  const handleOpenTemplates = (lead: Lead) => setTemplateLead(lead);

  const totalNeedAction = alerts.length;

  return (
    <TooltipProvider delayDuration={150}>
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Leads Board</h1>
          <p className="text-sm text-muted-foreground">Psychology funnel — auto-detected by the engine. Drag to override.</p>
        </div>
        {totalNeedAction > 0 && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="w-3 h-3" /> {totalNeedAction} need action
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {COLUMNS.map(col => {
          const items = byStage[col.stage] ?? [];
          const stats = stageStats(col.stage, items);
          return (
            <div key={col.stage} className={`bg-card rounded-lg border border-t-4 ${col.accent} flex flex-col min-h-[220px]`}>
              <div className="p-3 border-b space-y-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm flex items-center gap-1">
                    {col.stage === "cold" && <Snowflake className="w-3.5 h-3.5" />}
                    {col.label}
                  </h3>
                  <Badge variant="secondary">{items.length}</Badge>
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{col.sub}</span>
                  {items.length > 0 && <span>avg {stats.avgDays}d</span>}
                </div>
                {stats.needAction > 0 && (
                  <Badge variant="destructive" className="text-[10px] gap-0.5 h-4">
                    <AlertTriangle className="w-2.5 h-2.5" />{stats.needAction}
                  </Badge>
                )}
              </div>
              <div className="p-2 space-y-2 flex-1">
                {items.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">No leads</p>
                )}
                {items.map(lead => {
                  const l: any = lead;
                  const prob = lead.conversion_probability ?? 30;
                  const breakdown = (l.score_breakdown ?? {}) as { engagement?: number; intent?: number; timeline?: number; total?: number };
                  const styleLabel = PREFERRED_STYLES.find(s => s.value === l.preferred_style)?.label;
                  const budgetLabel = BUDGET_RANGES.find(b => b.value === l.budget_range)?.label;
                  const categoryLabel = LEAD_CATEGORIES.find(c => c.value === lead.category)?.label;
                  const respMins = l.response_time_minutes;
                  const leadAlerts = alertsByLead.get(lead.id) ?? [];
                  return (
                    <Card
                      key={lead.id}
                      className="cursor-pointer hover:shadow-card-hover transition-shadow"
                      onClick={() => setSelected(lead)}
                    >
                      <CardContent className="p-3 space-y-2">
                        {leadAlerts.length > 0 && (
                          <div className="space-y-0.5">
                            {leadAlerts.slice(0, 2).map(a => (
                              <div key={a.id} className={`flex items-start gap-1 text-[10px] rounded px-1.5 py-0.5 ${a.severity === "critical" ? "bg-destructive/10 text-destructive" : a.severity === "warning" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"}`}>
                                <AlertTriangle className="w-2.5 h-2.5 mt-0.5 shrink-0" />
                                <span className="line-clamp-2">{a.message}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-sm line-clamp-1 uppercase">{lead.customer_name}</p>
                          <Tooltip>
                            <TooltipTrigger asChild onClick={e => e.stopPropagation()}>
                              <Badge variant="outline" className={`${probColor(prob)} text-[10px] shrink-0 gap-0.5`}>
                                <Sparkles className="w-2.5 h-2.5" />{prob}%
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="max-w-[240px] text-xs">
                              <p className="font-semibold mb-1">Quality score: {breakdown.total ?? prob}/100</p>
                              <div className="space-y-0.5 text-muted-foreground">
                                <div className="flex justify-between"><span>Engagement (40)</span><span>{breakdown.engagement ?? "—"}</span></div>
                                <div className="flex justify-between"><span>Intent (40)</span><span>{breakdown.intent ?? "—"}</span></div>
                                <div className="flex justify-between"><span>Timeline (20)</span><span>{breakdown.timeline ?? "—"}</span></div>
                              </div>
                              <p className="mt-1 text-[10px]">Engagement = response speed + msg count. Intent = budget + need + objections. Timeline = decision month.</p>
                            </TooltipContent>
                          </Tooltip>
                        </div>

                        {(l.neighborhood || categoryLabel) && (
                          <div className="flex items-center gap-1 flex-wrap">
                            {l.neighborhood && (
                              <Badge className={`${neighborhoodColor(l.neighborhood)} text-[10px] gap-0.5 border-0`}>
                                <MapPin className="w-2.5 h-2.5" />{l.neighborhood}
                              </Badge>
                            )}
                            {categoryLabel && (
                              <Badge variant="outline" className="text-[10px]">{categoryLabel}</Badge>
                            )}
                          </div>
                        )}

                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Phone className="w-3 h-3" />{lead.customer_phone}
                          </span>
                          <span className="font-semibold">₹{Number(lead.value_in_rupees).toLocaleString("en-IN")}</span>
                        </div>

                        {(styleLabel || budgetLabel) && (
                          <p className="text-[11px] text-muted-foreground">
                            {styleLabel && <span>{styleLabel} style</span>}
                            {styleLabel && budgetLabel && <span> · </span>}
                            {budgetLabel && <span>Budget: {budgetLabel}</span>}
                          </p>
                        )}

                        <div className="border-t pt-1.5 space-y-0.5 text-[11px]">
                          <div className="flex items-center justify-between text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <MessageCircle className="w-3 h-3" />
                              {l.last_message_at ? `Last: ${formatRelativeTime(l.last_message_at)}` : "No messages"}
                            </span>
                            {l.last_response_at && <span>✅</span>}
                          </div>
                          {respMins != null && (
                            <div className={`flex items-center gap-1 ${responseTimeColor(respMins)}`}>
                              <Zap className="w-3 h-3" />Response: {respMins}m
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 pt-1" onClick={e => e.stopPropagation()}>
                          <Button
                            size="sm"
                            className="h-7 flex-1 text-xs gap-1 gradient-primary"
                            onClick={() => handleOpenTemplates(lead)}
                          >
                            <MessageCircle className="w-3 h-3" />Send
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="sm" className="h-7 px-2 text-xs gap-1">
                                <MoveHorizontal className="w-3 h-3" />Move
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel className="text-xs">Move to stage</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {ALL_STAGES.filter(s => s.value !== journeyOf(lead)).map(s => (
                                <DropdownMenuItem key={s.value} onClick={() => handleMove(lead, s.value)}>
                                  {s.label}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <LeadDetailsDrawer
        lead={selected}
        open={!!selected}
        onOpenChange={open => { if (!open) setSelected(null); }}
      />

      <SendTemplateDialog
        lead={templateLead}
        open={!!templateLead}
        onOpenChange={open => { if (!open) setTemplateLead(null); }}
      />
    </div>
    </TooltipProvider>
  );
};

export default LeadsBoard;
