import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Lead } from "@/contexts/DataContext";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send, AlertCircle, Sparkles, ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import {
  STAGE_META, statusToStage, extractVariables, fillTemplate,
  autoFillFromLead, variableLabel, type JourneyStage,
} from "@/lib/messageTemplates";

interface MessageTemplate {
  id: string;
  stage: JourneyStage;
  title: string;
  body: string;
  variables: string[];
  sort_order: number;
}

interface Props {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const SendTemplateDialog = ({ lead, open, onOpenChange }: Props) => {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<JourneyStage>("exploration");
  const [picked, setPicked] = useState<MessageTemplate | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPicked(null);
    if (lead) setStage(statusToStage(lead.status));
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("message_templates")
        .select("id,stage,title,body,variables,sort_order")
        .eq("is_active", true)
        .order("stage")
        .order("sort_order");
      if (error) toast.error("Failed to load templates");
      setTemplates((data as any) || []);
      setLoading(false);
    })();
  }, [open, lead]);

  // Initialise variable values when a template is picked
  useEffect(() => {
    if (!picked || !lead) return;
    const auto = autoFillFromLead(lead);
    const next: Record<string, string> = {};
    for (const key of picked.variables) next[key] = auto[key] || "";
    setValues(next);
  }, [picked, lead]);

  const grouped = useMemo(() => {
    const map: Record<JourneyStage, MessageTemplate[]> = {
      problem: [], exploration: [], evaluation: [], reassurance: [], decision: [],
    };
    for (const t of templates) map[t.stage]?.push(t);
    return map;
  }, [templates]);

  const missingVars = useMemo(() => {
    if (!picked) return [];
    const required = extractVariables(picked.body);
    return required.filter(v => !values[v] || !values[v].trim());
  }, [picked, values]);

  const filledBody = useMemo(() => {
    if (!picked) return "";
    return fillTemplate(picked.body, values);
  }, [picked, values]);

  const handleSend = async () => {
    if (!lead || !picked || !user) return;
    if (missingVars.length > 0) {
      toast.error(`Fill required fields: ${missingVars.map(variableLabel).join(", ")}`);
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-whatsapp", {
        body: {
          phone: lead.customer_phone,
          message: filledBody,
          user_id: user.id,
          user_name: user.name,
        },
      });
      if (error) throw error;
      await supabase.from("lead_messages").insert({
        lead_id: lead.id,
        message_type: "outbound",
        message_body: filledBody,
        template_used: picked.title,
        template_id: picked.id,
        journey_stage: picked.stage,
        status: data?.success ? "sent" : "failed",
        created_by: user.id,
      } as any);
      toast.success(`Sent: ${picked.title}`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to send");
    } finally {
      setSending(false);
    }
  };

  if (!lead) return null;
  const suggested = statusToStage(lead.status);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {picked && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPicked(null)}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
            )}
            {picked ? picked.title : `Send Template — ${lead.customer_name}`}
          </DialogTitle>
          <DialogDescription>
            {picked ? "Review and fill any missing details, then send via WhatsApp."
                    : <>Pick a message by customer journey stage. <span className="text-primary font-medium">Suggested: {STAGE_META.find(s => s.value === suggested)?.label}</span></>}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : !picked ? (
          <Tabs value={stage} onValueChange={(v) => setStage(v as JourneyStage)} className="flex-1 flex flex-col min-h-0">
            <TabsList className="grid grid-cols-5 h-auto">
              {STAGE_META.map(s => (
                <TabsTrigger key={s.value} value={s.value} className="text-[11px] py-1.5 px-1 flex-col gap-0.5">
                  <span className="flex items-center gap-1">
                    {s.label}
                    {s.value === suggested && <Sparkles className="w-2.5 h-2.5 text-primary" />}
                  </span>
                  <span className="text-[9px] text-muted-foreground hidden md:block">{s.days}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            {STAGE_META.map(s => (
              <TabsContent key={s.value} value={s.value} className="flex-1 min-h-0 mt-3">
                <ScrollArea className="h-[55vh] pr-2">
                  <div className="space-y-2">
                    {grouped[s.value].length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-8">No templates in this stage</p>
                    )}
                    {grouped[s.value].map(t => (
                      <Card key={t.id} className="cursor-pointer hover:border-primary transition-colors" onClick={() => setPicked(t)}>
                        <CardContent className="p-3 space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold text-sm">{t.title}</p>
                            <Badge variant="outline" className={`text-[10px] ${s.color}`}>{s.label}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-line">{t.body}</p>
                          {t.variables.length > 0 && (
                            <div className="flex flex-wrap gap-1 pt-0.5">
                              {t.variables.map(v => (
                                <span key={v} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{`{{${v}}}`}</span>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
            {/* Variable fill-in */}
            {picked.variables.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fill in details</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {picked.variables.map(v => {
                    const isMissing = !values[v] || !values[v].trim();
                    return (
                      <div key={v} className="space-y-1">
                        <Label className="text-xs flex items-center gap-1">
                          {variableLabel(v)}
                          {isMissing && <AlertCircle className="w-3 h-3 text-destructive" />}
                        </Label>
                        <Input
                          value={values[v] || ""}
                          onChange={e => setValues(p => ({ ...p, [v]: e.target.value }))}
                          className={isMissing ? "border-destructive focus-visible:ring-destructive" : ""}
                          placeholder={`Enter ${variableLabel(v).toLowerCase()}`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Preview */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Preview</p>
              <Textarea value={filledBody} readOnly rows={9} className="resize-none text-sm bg-muted/30" />
            </div>

            {missingVars.length > 0 && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2.5 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-destructive">
                  Missing required fields: <strong>{missingVars.map(variableLabel).join(", ")}</strong>. Send is blocked until these are filled.
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2 pt-2 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {picked && (
            <Button onClick={handleSend} disabled={sending || missingVars.length > 0} className="gap-2">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Send via WhatsApp
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SendTemplateDialog;
