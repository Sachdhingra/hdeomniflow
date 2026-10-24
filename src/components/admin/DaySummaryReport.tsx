import { AlertTriangle, CalendarCheck, CheckCircle2, ClipboardCheck, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatInr, type DayReport } from "../../../supabase/functions/_shared/day-summary";

const longDate = (date: string) =>
  new Date(`${date}T12:00:00+05:30`).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
  });

const Tile = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="rounded-lg border border-border bg-card px-3 py-2">
    <div className="text-[11px] text-muted-foreground">{label}</div>
    <div className="text-xl font-semibold tabular-nums leading-tight">{value}</div>
    {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
  </div>
);

const Section = ({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) => (
  <section>
    <h3 className="flex items-center gap-2 text-sm font-semibold mb-2">
      {icon}
      {title}
    </h3>
    {children}
  </section>
);

const List = ({ items }: { items: string[] }) => (
  <ul className="space-y-1.5 text-sm">
    {items.map((t, i) => (
      <li key={i} className="flex gap-2">
        <span className="text-muted-foreground select-none">•</span>
        <span>{t}</span>
      </li>
    ))}
  </ul>
);

// The whole day on one screen: headline, four numbers, then three short sections.
const DaySummaryReport = ({ report }: { report: DayReport }) => {
  const t = report.totals;
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-muted-foreground">{longDate(report.date)}</p>
        <p className="text-base font-medium mt-1 leading-snug">{report.headline}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Tile label="Reps in" value={`${t.repsPresent} / ${t.repsExpected}`} />
        <Tile label="New leads" value={String(t.newLeads)} />
        <Tile label="Deals won" value={String(t.wonCount)} hint={t.wonCount ? formatInr(t.wonValue) : undefined} />
        <Tile label="Follow-ups tomorrow" value={String(t.dueTomorrow)} />
      </div>

      <Section icon={<AlertTriangle className="w-4 h-4 text-amber-600" />} title="Needs special attention">
        {report.attention.length === 0 ? (
          <p className="text-sm flex items-center gap-2 text-muted-foreground">
            <ClipboardCheck className="w-4 h-4" /> No one stands out today.
          </p>
        ) : (
          <ul className="space-y-2">
            {report.attention.map(a => (
              <li key={a.repId} className="rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-amber-950">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{a.name}</span>
                  <Badge variant="outline" className="font-normal border-amber-500/50 text-amber-900 text-[11px]">
                    {a.reasons.length} {a.reasons.length === 1 ? "thing" : "things"} to look at
                  </Badge>
                </div>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {a.reasons.map((r, i) => (
                    <li key={i}>– {r}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />} title="What got done">
        <List items={report.done} />
      </Section>

      <Section icon={<CalendarCheck className="w-4 h-4 text-primary" />} title="Plan for tomorrow">
        <List items={report.tomorrow} />
        {report.focus.length > 0 && (
          <div className="mt-3 rounded-md bg-primary/5 border border-primary/15 px-3 py-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-primary mb-1">
              <Sparkles className="w-3.5 h-3.5" /> Suggested focus
            </div>
            <List items={report.focus} />
          </div>
        )}
      </Section>

      <p className="text-[11px] text-muted-foreground">
        Built from CRM activity, attendance and coach check-ins. It can't see phone calls or showroom time, so treat it as a prompt for a conversation.
      </p>
    </div>
  );
};

export default DaySummaryReport;
