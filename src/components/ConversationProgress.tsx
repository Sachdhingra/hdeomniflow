import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Phone, AlertTriangle, TrendingUp, MessageSquare, Sparkles } from "lucide-react";

interface Message {
  id: string;
  message_type: string;
  message_kind?: string | null;
  sentiment?: string | null;
  intent?: string | null;
  concern?: string | null;
  variant?: string | null;
  sequence_number?: number | null;
  sent_at: string;
  message_body: string;
}

interface Props {
  messages: Message[];
  unansweredCount: number;
  needsPersonalCall: boolean;
  deadLead: boolean;
  lastInboundSentiment: string | null;
  lastInboundConcern: string | null;
  lastRecommendedKind: string | null;
}

const KIND_LABEL: Record<string, string> = {
  curiosity: "Curiosity question",
  objection_price: "Price objection handler",
  objection_general: "Objection handler",
  objection_comparison: "Comparison reply",
  concern_delivery: "Delivery answer",
  concern_quality: "Quality answer",
  concern_customization: "Customization answer",
  no_response_d2: "Re-engagement (48h)",
  no_response_d3: "Re-engagement (72h)",
  no_response_d7: "Empathy (7d silence)",
  relationship: "Relationship builder",
  ready_nudge: "Decision nudge",
  cold_reengage: "Cold re-engagement",
  stage_default: "Stage default",
};

const SENTIMENT_COLOR: Record<string, string> = {
  positive: "bg-success/15 text-success border-success/30",
  negative: "bg-destructive/15 text-destructive border-destructive/30",
  neutral: "bg-muted text-muted-foreground border-border",
};

export const ConversationProgress = ({
  messages, unansweredCount, needsPersonalCall, deadLead,
  lastInboundSentiment, lastInboundConcern, lastRecommendedKind,
}: Props) => {
  const sequenced = [...messages]
    .filter(m => m.sequence_number != null)
    .sort((a, b) => (a.sequence_number ?? 0) - (b.sequence_number ?? 0));

  return (
    <div className="space-y-3">
      <h4 className="font-semibold text-sm flex items-center gap-1.5">
        <TrendingUp className="w-4 h-4" />Conversation Progress
      </h4>

      {/* Status banners */}
      {deadLead && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-2.5 flex items-center gap-2 text-xs">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            <span><b>Dead lead</b> · 5+ unanswered messages — paused from automation</span>
          </CardContent>
        </Card>
      )}
      {!deadLead && needsPersonalCall && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="p-2.5 flex items-center gap-2 text-xs">
            <Phone className="w-4 h-4 text-warning" />
            <span><b>Needs personal call</b> · {unansweredCount} unanswered messages — try phone, not WhatsApp</span>
          </CardContent>
        </Card>
      )}

      {/* Snapshot */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-muted rounded p-2">
          <p className="text-[10px] text-muted-foreground">Last sentiment</p>
          {lastInboundSentiment ? (
            <Badge variant="outline" className={`mt-0.5 text-[10px] ${SENTIMENT_COLOR[lastInboundSentiment] ?? ""}`}>
              {lastInboundSentiment}
            </Badge>
          ) : <p className="text-muted-foreground">—</p>}
        </div>
        <div className="bg-muted rounded p-2">
          <p className="text-[10px] text-muted-foreground">Last concern</p>
          <p className="font-medium capitalize">{lastInboundConcern || "—"}</p>
        </div>
        <div className="bg-muted rounded p-2">
          <p className="text-[10px] text-muted-foreground">Unanswered</p>
          <p className="font-medium">{unansweredCount}</p>
        </div>
      </div>

      {/* Recommended next */}
      {lastRecommendedKind && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-2.5 text-xs flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-primary mt-0.5" />
            <div>
              <p className="text-[10px] uppercase text-muted-foreground">Last automated message kind</p>
              <p className="font-medium">{KIND_LABEL[lastRecommendedKind] ?? lastRecommendedKind}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sequence timeline */}
      {sequenced.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase text-muted-foreground flex items-center gap-1">
            <MessageSquare className="w-3 h-3" />Message sequence
          </p>
          <ol className="space-y-1">
            {sequenced.map(m => (
              <li key={m.id} className="text-xs flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[10px] font-bold shrink-0">
                  {m.sequence_number}
                </span>
                <Badge variant="outline" className="text-[9px] capitalize">{m.message_type}</Badge>
                {m.message_kind && (
                  <span className="text-muted-foreground truncate">{KIND_LABEL[m.message_kind] ?? m.message_kind}</span>
                )}
                {m.sentiment && (
                  <Badge variant="outline" className={`text-[9px] ${SENTIMENT_COLOR[m.sentiment] ?? ""}`}>
                    {m.sentiment}
                  </Badge>
                )}
                {m.variant && (
                  <Badge variant="secondary" className="text-[9px]">var {m.variant}</Badge>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
};

export default ConversationProgress;
