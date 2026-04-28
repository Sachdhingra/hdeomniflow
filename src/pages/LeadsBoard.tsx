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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Leads Board</h1>
        <p className="text-sm text-muted-foreground">Drag stages manually. Tap a card for details & history.</p>
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
                  const prob = lead.conversion_probability ?? 30;
                  return (
                    <Card
                      key={lead.id}
                      className="cursor-pointer hover:shadow-card-hover transition-shadow"
                      onClick={() => setSelected(lead)}
                    >
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium text-sm line-clamp-1">{lead.customer_name}</p>
                          <Badge variant="outline" className={`${probColor(prob)} text-[10px] shrink-0`}>
                            <Sparkles className="w-2.5 h-2.5 mr-0.5" />{prob}%
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Phone className="w-3 h-3" />{lead.customer_phone}
                        </p>
                        {lead.liked_product && (
                          <p className="text-xs text-muted-foreground line-clamp-1">❤ {lead.liked_product}</p>
                        )}
                        <div className="flex items-center justify-between pt-1" onClick={e => e.stopPropagation()}>
                          <p className="text-xs font-semibold">₹{Number(lead.value_in_rupees).toLocaleString("en-IN")}</p>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1">
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
  );
};

export default LeadsBoard;
