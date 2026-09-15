// Admin view of the WhatsApp quick-reply conversation.
//
// Each step is a Twilio Content template with tappable buttons. The flow itself
// is code (so the engine and the webhook agree on what a tap means); only the
// Content SID is configurable here, because that value is minted in the Twilio
// console once Meta approves the template.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, AlertTriangle, Hand, Loader2, MessageSquareReply } from "lucide-react";
import { toast } from "@/lib/toast";
import { QUICK_REPLY_STEPS, type QuickReplyStep } from "@/lib/quickReplyFlow";

type StepRow = {
  step_key: string;
  title: string;
  question: string;
  requires_approved_template: boolean;
  content_sid: string | null;
  is_active: boolean;
  sort_order: number;
};

const QuickReplyFlowCard = ({ isAdmin }: { isAdmin: boolean }) => {
  const [rows, setRows] = useState<StepRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data, error } = await supabase
      .from("whatsapp_quick_reply_steps")
      .select("step_key, title, question, requires_approved_template, content_sid, is_active, sort_order")
      .order("sort_order", { ascending: true });
    if (error) {
      toast.error(error.message || "Could not load the quick-reply flow");
    } else {
      setRows((data ?? []) as StepRow[]);
      setDrafts(Object.fromEntries((data ?? []).map(r => [r.step_key, r.content_sid ?? ""])));
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Button labels, template name and Meta category all come from the flow code,
  // not the database — they are what gets submitted to Meta, so there is only
  // ever one copy of them.
  const stepsByKey = useMemo(
    () => Object.fromEntries(QUICK_REPLY_STEPS.map(s => [s.key, s])) as Record<string, QuickReplyStep>,
    [],
  );

  const configured = rows.filter(r => !!r.content_sid?.trim()).length;

  const save = async (stepKey: string) => {
    const sid = (drafts[stepKey] ?? "").trim();
    // Twilio Content SIDs always look like HX + 32 hex characters.
    if (sid && !/^HX[0-9a-fA-F]{32}$/.test(sid)) {
      toast.error("That does not look like a Twilio Content SID (HX + 32 characters)");
      return;
    }
    setSaving(stepKey);
    try {
      const { error } = await supabase
        .from("whatsapp_quick_reply_steps")
        .update({ content_sid: sid || null, updated_at: new Date().toISOString() })
        .eq("step_key", stepKey);
      if (error) throw error;
      toast.success(sid ? "Template linked — this question is live" : "Template unlinked");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquareReply className="w-4 h-4" />Quick-reply conversation
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Customers answer by tapping a button instead of typing or calling back. Each
              question needs its Twilio Content SID pasted in once — or run{" "}
              <code className="text-[11px]">npm run wa:templates -- create --confirm</code> to
              create them all from the flow definition.
            </p>
          </div>
          <Badge variant={configured === rows.length && rows.length > 0 ? "secondary" : "destructive"}>
            {configured}/{rows.length} questions live
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        )}
        {!loading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No quick-reply steps found — run the database migrations.
          </p>
        )}
        {rows.map(row => {
          const live = !!row.content_sid?.trim();
          const step = stepsByKey[row.step_key];
          const buttons = step?.buttons ?? [];
          return (
            <div key={row.step_key} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    {live
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                      : <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />}
                    {row.title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{row.question}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge variant="outline" className="text-[10px]">
                    {row.requires_approved_template
                      ? `Meta approval · ${step?.metaCategory ?? ""}`
                      : "Sent inside 24h window"}
                  </Badge>
                  {step && (
                    <code className="text-[10px] text-muted-foreground">{step.templateName}</code>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-1">
                {buttons.map(b => (
                  <Badge key={b.payload} variant="secondary" className="text-[10px] gap-1">
                    <Hand className="w-2.5 h-2.5" />{b.label}
                  </Badge>
                ))}
              </div>

              {isAdmin ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={drafts[row.step_key] ?? ""}
                    onChange={e => setDrafts(d => ({ ...d, [row.step_key]: e.target.value }))}
                    placeholder="HX… Twilio Content SID"
                    className="h-8 text-xs font-mono"
                  />
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    disabled={saving === row.step_key || (drafts[row.step_key] ?? "") === (row.content_sid ?? "")}
                    onClick={() => save(row.step_key)}
                  >
                    {saving === row.step_key ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                  </Button>
                </div>
              ) : (
                <p className="text-[11px] font-mono text-muted-foreground">
                  {row.content_sid || "Not configured"}
                </p>
              )}

              {!live && (
                <p className="text-[11px] text-warning">
                  Not configured — the engine skips this question and logs
                  “quick_reply_template_missing” instead of sending anything half-built.
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

export default QuickReplyFlowCard;
