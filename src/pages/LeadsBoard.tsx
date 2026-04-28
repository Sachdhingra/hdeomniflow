import { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData, LeadStatus, LEAD_CATEGORIES, type Lead } from "@/contexts/DataContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Phone, MoveHorizontal, Sparkles, MessageCircle, MapPin, Zap, Info } from "lucide-react";
import { toast } from "sonner";
import LeadDetailsDrawer from "@/components/LeadDetailsDrawer";
import SendTemplateDialog from "@/components/SendTemplateDialog";
import { neighborhoodColor, responseTimeColor, formatRelativeTime, PREFERRED_STYLES, BUDGET_RANGES } from "@/lib/leadConstants";

const COLUMNS: { status: LeadStatus; label: string; accent: string }[] = [
  { status: "new", label: "New", accent: "border-t-primary" },
  { status: "contacted", label: "Contacted", accent: "border-t-muted-foreground" },
  { status: "follow_up", label: "Follow Up", accent: "border-t-warning" },
  { status: "negotiation", label: "Negotiation", accent: "border-t-accent" },
  { status: "overdue", label: "Overdue", accent: "border-t-destructive" },
];

const ALL_STATUSES: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "follow_up", label: "Follow Up" },
  { value: "negotiation", label: "Negotiation" },
  { value: "overdue", label: "Overdue" },
  { value: "won", label: "Won" },
  { value: "converted", label: "Converted" },
  { value: "lost", label: "Lost" },
];

const probColor = (p: number) => p >= 70 ? "bg-success/10 text-success" : p >= 40 ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive";

const LeadsBoard = () => {
  const { user } = useAuth();
  const { leads, updateLead } = useData();
  const [selected, setSelected] = useState<Lead | null>(null);
  const [templateLead, setTemplateLead] = useState<Lead | null>(null);

  const visibleLeads = useMemo(() => {
    if (user?.role === "admin") return leads;
    return leads.filter(l => l.created_by === user?.id || l.assigned_to === user?.id);
  }, [leads, user]);

  const byStage = useMemo(() => {
    const map: Record<LeadStatus, Lead[]> = {
      new: [], contacted: [], follow_up: [], negotiation: [],
      won: [], lost: [], overdue: [], converted: [],
    };
    for (const l of visibleLeads) map[l.status]?.push(l);
    return map;
  }, [visibleLeads]);

  const handleMove = async (lead: Lead, newStatus: LeadStatus) => {
    if (lead.status === newStatus) return;
    try {
      await updateLead(lead.id, { status: newStatus });
      toast.success(`Moved to ${newStatus.replace("_", " ")}`);
    } catch (e: any) {
      toast.error(e.message || "Failed to move lead");
    }
  };

  const handleSendMessage = async (lead: Lead) => {
    const template = `Hi ${lead.customer_name}, this is HD Eomni Furniture. Following up on your interest in ${lead.product_viewed || lead.liked_product || (lead.category as string).replace("_", " ")}. Can we help with anything specific?`;
    try {
      const { data, error } = await supabase.functions.invoke("send-whatsapp", {
        body: {
          phone: lead.customer_phone,
          message: template,
          user_id: user?.id,
          user_name: user?.name,
        },
      });
      if (error) throw error;
      // Log inside lead_messages so card stats update
      await supabase.from("lead_messages").insert({
        lead_id: lead.id,
        message_type: "outbound",
        message_body: template,
        template_used: "follow_up_default",
        status: data?.success ? "sent" : "failed",
        created_by: user?.id,
      } as any);
      toast.success("Message sent via WhatsApp");
    } catch (e: any) {
      toast.error(e.message || "Failed to send");
    }
  };

  return (
    <TooltipProvider delayDuration={150}>
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Leads Board</h1>
        <p className="text-sm text-muted-foreground">Drag stages manually. Tap a card for full details.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        {COLUMNS.map(col => {
          const items = byStage[col.status];
          return (
            <div key={col.status} className={`bg-card rounded-lg border border-t-4 ${col.accent} flex flex-col min-h-[200px]`}>
              <div className="p-3 border-b flex items-center justify-between">
                <h3 className="font-semibold text-sm">{col.label}</h3>
                <Badge variant="secondary">{items.length}</Badge>
              </div>
              <div className="p-2 space-y-2 flex-1">
                {items.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">No leads</p>
                )}
                {items.map(lead => {
                  const l: any = lead;
                  const prob = lead.conversion_probability ?? 30;
                  const styleLabel = PREFERRED_STYLES.find(s => s.value === l.preferred_style)?.label;
                  const budgetLabel = BUDGET_RANGES.find(b => b.value === l.budget_range)?.label;
                  const categoryLabel = LEAD_CATEGORIES.find(c => c.value === lead.category)?.label;
                  const respMins = l.response_time_minutes;
                  return (
                    <Card
                      key={lead.id}
                      className="cursor-pointer hover:shadow-card-hover transition-shadow"
                      onClick={() => setSelected(lead)}
                    >
                      <CardContent className="p-3 space-y-2">
                        {/* Header: name + quality */}
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-sm line-clamp-1 uppercase">{lead.customer_name}</p>
                          <Tooltip>
                            <TooltipTrigger asChild onClick={e => e.stopPropagation()}>
                              <Badge variant="outline" className={`${probColor(prob)} text-[10px] shrink-0 gap-0.5`}>
                                <Sparkles className="w-2.5 h-2.5" />{prob}%
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="max-w-[220px] text-xs">
                              <p className="font-semibold mb-1">Quality score</p>
                              <p className="text-muted-foreground">Based on visit recency, message engagement, family involvement, decision timeline, budget filled, response speed, and barriers addressed.</p>
                            </TooltipContent>
                          </Tooltip>
                        </div>

                        {/* Neighborhood + product */}
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

                        {/* Phone + value */}
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Phone className="w-3 h-3" />{lead.customer_phone}
                          </span>
                          <span className="font-semibold">₹{Number(lead.value_in_rupees).toLocaleString("en-IN")}</span>
                        </div>

                        {/* Style + budget */}
                        {(styleLabel || budgetLabel) && (
                          <p className="text-[11px] text-muted-foreground">
                            {styleLabel && <span>{styleLabel} style</span>}
                            {styleLabel && budgetLabel && <span> · </span>}
                            {budgetLabel && <span>Budget: {budgetLabel}</span>}
                          </p>
                        )}

                        {/* Message stats */}
                        <div className="border-t pt-1.5 space-y-0.5 text-[11px]">
                          <div className="flex items-center justify-between text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <MessageCircle className="w-3 h-3" />
                              {l.last_message_at ? `Last msg: ${formatRelativeTime(l.last_message_at)}` : "No messages yet"}
                            </span>
                            {l.last_response_at && <span>✅</span>}
                          </div>
                          {respMins != null && (
                            <div className={`flex items-center gap-1 ${responseTimeColor(respMins)}`}>
                              <Zap className="w-3 h-3" />Response: {respMins}m
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 pt-1" onClick={e => e.stopPropagation()}>
                          <Button
                            size="sm"
                            className="h-7 flex-1 text-xs gap-1 gradient-primary"
                            onClick={() => handleSendMessage(lead)}
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
                              {ALL_STATUSES.filter(s => s.value !== lead.status).map(s => (
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
    </div>
    </TooltipProvider>
  );
};

export default LeadsBoard;
