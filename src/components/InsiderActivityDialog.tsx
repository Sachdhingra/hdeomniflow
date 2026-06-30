import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Smartphone, Coins, Gift, Wrench } from "lucide-react";
import { formatDate } from "@/lib/dateFormat";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customerId: string | null;
  customerName?: string;
}

interface EliteSummary {
  app_activated: boolean | null;
  card_tier: string | null;
  card_number: string | null;
  current_points: number | null;
  lifetime_points: number | null;
  card_enrollment_date: string | null;
  referral_code: string | null;
}
interface PointTx { id: string; points: number; transaction_type: string; is_expired: boolean; expires_at: string | null; created_at: string; notes: string | null; }
interface Redemption { id: string; points_requested: number; rupee_value: number; status: string; requested_at: string; notes: string | null; }
interface ServiceReq { id: string; product_description: string; issue_description: string; status: string; contact_phone: string; created_at: string; }
interface AppUser { onesignal_player_id: string | null; push_enabled: boolean; created_at: string; }

const STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  approved: "bg-success/15 text-success border-success/30",
  rejected: "bg-destructive/15 text-destructive border-destructive/30",
  open: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  in_progress: "bg-primary/15 text-primary border-primary/30",
  closed: "bg-muted text-muted-foreground border-border",
  completed: "bg-success/15 text-success border-success/30",
};

const InsiderActivityDialog = ({ open, onOpenChange, customerId, customerName }: Props) => {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<EliteSummary | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [points, setPoints] = useState<PointTx[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [services, setServices] = useState<ServiceReq[]>([]);

  useEffect(() => {
    if (!open || !customerId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [s, au, pts, rds, svc] = await Promise.all([
        supabase.from("elite_customers" as any)
          .select("app_activated, card_tier, card_number, current_points, lifetime_points, card_enrollment_date, referral_code")
          .eq("id", customerId).maybeSingle(),
        supabase.from("app_users" as any)
          .select("onesignal_player_id, push_enabled, created_at")
          .eq("customer_id", customerId).maybeSingle(),
        supabase.from("card_points" as any)
          .select("id, points, transaction_type, is_expired, expires_at, created_at, notes")
          .eq("customer_id", customerId).order("created_at", { ascending: false }).limit(50),
        supabase.from("redemption_requests" as any)
          .select("id, points_requested, rupee_value, status, requested_at, notes")
          .eq("customer_id", customerId).order("requested_at", { ascending: false }).limit(50),
        supabase.from("app_service_requests" as any)
          .select("id, product_description, issue_description, status, contact_phone, created_at")
          .eq("customer_id", customerId).order("created_at", { ascending: false }).limit(50),
      ]);
      if (cancelled) return;
      setSummary((s.data as any) || null);
      setAppUser((au.data as any) || null);
      setPoints(((pts.data as any) || []) as PointTx[]);
      setRedemptions(((rds.data as any) || []) as Redemption[]);
      setServices(((svc.data as any) || []) as ServiceReq[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, customerId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-primary" /> Insider Activity
          </DialogTitle>
          <DialogDescription>
            Read-only view of {customerName || "this customer"}'s activity inside the Home Decor Insider app.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryStat label="App Status" value={
                summary?.app_activated || appUser
                  ? <Badge className="bg-success/15 text-success border-success/30 border" variant="outline">Activated</Badge>
                  : <Badge variant="outline" className="bg-muted text-muted-foreground border-border">Not activated</Badge>
              } />
              <SummaryStat label="Tier" value={
                <span className="capitalize font-semibold">{summary?.card_tier || "—"}</span>
              } />
              <SummaryStat label="Current Points" value={
                <span className="text-2xl font-bold text-primary">{summary?.current_points ?? 0}</span>
              } />
              <SummaryStat label="Lifetime Points" value={
                <span className="text-2xl font-bold">{summary?.lifetime_points ?? 0}</span>
              } />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
              <div><span className="font-medium text-foreground">Card #:</span> {summary?.card_number || "—"}</div>
              <div><span className="font-medium text-foreground">Enrolled:</span> {summary?.card_enrollment_date ? formatDate(summary.card_enrollment_date) : "—"}</div>
              <div><span className="font-medium text-foreground">Referral:</span> {summary?.referral_code || "—"}</div>
              <div><span className="font-medium text-foreground">App since:</span> {appUser ? formatDate(appUser.created_at) : "—"}</div>
              <div><span className="font-medium text-foreground">Push:</span> {appUser ? (appUser.push_enabled ? "On" : "Off") : "—"}</div>
            </div>

            {/* Points history */}
            <Section icon={<Coins className="w-4 h-4 text-amber-500" />} title="Points History" count={points.length}>
              {points.length === 0 ? <Empty msg="No points activity yet" /> : (
                <ul className="divide-y divide-border">
                  {points.map(p => (
                    <li key={p.id} className="py-2 flex items-center justify-between text-sm">
                      <div>
                        <span className={`font-semibold ${p.points >= 0 ? "text-success" : "text-destructive"}`}>
                          {p.points >= 0 ? "+" : ""}{p.points}
                        </span>
                        <span className="ml-2 text-xs capitalize text-muted-foreground">{p.transaction_type}</span>
                        {p.is_expired && <Badge variant="outline" className="ml-2 text-xs">Expired</Badge>}
                        {p.notes && <div className="text-xs text-muted-foreground mt-0.5">{p.notes}</div>}
                      </div>
                      <div className="text-xs text-muted-foreground text-right">
                        <div>{formatDate(p.created_at)}</div>
                        {p.expires_at && <div className="opacity-70">exp {formatDate(p.expires_at)}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {/* Redemptions */}
            <Section icon={<Gift className="w-4 h-4 text-primary" />} title="Redemption Requests" count={redemptions.length}>
              {redemptions.length === 0 ? <Empty msg="No redemption requests" /> : (
                <ul className="divide-y divide-border">
                  {redemptions.map(r => (
                    <li key={r.id} className="py-2 flex items-center justify-between text-sm">
                      <div>
                        <span className="font-semibold">{r.points_requested} pts</span>
                        <span className="text-xs text-muted-foreground"> → ₹{Number(r.rupee_value).toLocaleString("en-IN")}</span>
                        {r.notes && <div className="text-xs text-muted-foreground mt-0.5">{r.notes}</div>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={STATUS_TONE[r.status] || ""}>{r.status}</Badge>
                        <span className="text-xs text-muted-foreground">{formatDate(r.requested_at)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {/* Service requests */}
            <Section icon={<Wrench className="w-4 h-4 text-amber-600" />} title="App Service Requests" count={services.length}>
              {services.length === 0 ? <Empty msg="No service requests" /> : (
                <ul className="divide-y divide-border">
                  {services.map(s => (
                    <li key={s.id} className="py-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{s.product_description}</span>
                        <Badge variant="outline" className={STATUS_TONE[s.status] || ""}>{s.status}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">{s.issue_description}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        📞 {s.contact_phone} · {formatDate(s.created_at)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

const SummaryStat = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <Card>
    <CardContent className="p-3">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <div>{value}</div>
    </CardContent>
  </Card>
);

const Section = ({ icon, title, count, children }: { icon: React.ReactNode; title: string; count: number; children: React.ReactNode }) => (
  <div className="border border-border rounded-lg">
    <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
      <div className="flex items-center gap-2 font-medium text-sm">{icon} {title}</div>
      <span className="text-xs text-muted-foreground">{count}</span>
    </div>
    <div className="px-3">{children}</div>
  </div>
);

const Empty = ({ msg }: { msg: string }) => (
  <div className="py-4 text-center text-xs text-muted-foreground">{msg}</div>
);

export default InsiderActivityDialog;
