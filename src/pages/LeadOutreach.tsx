import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Send, MessageSquare, Search, CheckCircle2, XCircle, Phone, Eye, Reply, AlertTriangle, UserRound } from "lucide-react";
import { toast } from "@/lib/toast";
import {
  WA_TEMPLATES, YES_NO_FOLLOW_UP_PREVIEW, inferInterest, firstName,
} from "@/lib/whatsappTemplates";

interface OutreachLead {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  category: string | null;
  status: string;
  value_in_rupees: number | null;
  budget_range: string | null;
  product_viewed: string | null;
  liked_product: string | null;
  stated_need: string | null;
  notes: string | null;
  next_follow_up_date: string | null;
  last_message_at: string | null;
  created_at: string;
}

type SendState = "idle" | "sending" | "sent" | "failed";
type Performance = { total: number; sent: number; reached: number; read: number; replied: number; failed: number };
type ActivityRow = { id: string; lead_id: string; message_type: string; message_body: string; status: string; sent_at: string; created_at: string; outreach_source: string | null };
type ReplyDetail = ActivityRow & { customer_name: string; customer_phone: string | null; salesperson_name: string };

const STATUSES = ["follow_up", "negotiation", "overdue"] as const;

const STATUS_LABEL: Record<string, string> = {
  follow_up: "Follow up",
  negotiation: "Negotiation",
  overdue: "Overdue",
};

const LeadOutreach = () => {
  const { user, allProfiles } = useAuth();
  const [leads, setLeads] = useState<OutreachLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<Record<string, { state: SendState; error?: string }>>({});
  const [period, setPeriod] = useState("7");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [performance, setPerformance] = useState<Performance>({ total: 0, sent: 0, reached: 0, read: 0, replied: 0, failed: 0 });
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [replyDetails, setReplyDetails] = useState<ReplyDetail[]>([]);
  const [repliesOpen, setRepliesOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("leads")
      .select(
        "id,customer_name,customer_phone,category,status,value_in_rupees,budget_range,product_viewed,liked_product,stated_need,notes,next_follow_up_date,last_message_at,created_at",
      )
      .is("deleted_at", null)
      .in("status", STATUSES)
      .order("next_follow_up_date", { ascending: true, nullsFirst: false });
    if (error) toast.error(error.message);
    setLeads((data as any) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const loadPerformance = async () => {
      const since = new Date(Date.now() - Number(period) * 86400000).toISOString();
      const { data } = await supabase.from("lead_messages")
        .select("id,lead_id,message_type,message_body,status,sent_at,created_at,outreach_source,response_received")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500);
      const allRows = (data ?? []) as Array<ActivityRow & { response_received?: boolean }>;
      const rows = sourceFilter === "all" ? allRows : allRows.filter(r => r.outreach_source === sourceFilter || r.message_type === "inbound");
      const outbound = rows.filter(r => r.message_type === "outbound");
      const inbound = rows.filter(r => r.message_type === "inbound");
      const outboundLeadIds = new Set(outbound.map(r => r.lead_id));
      const repliedLeadIds = new Set(inbound.filter(r => outboundLeadIds.has(r.lead_id)).map(r => r.lead_id));
      setPerformance({
        total: outbound.length,
        sent: outbound.filter(r => ["sent", "delivered", "read"].includes(r.status)).length,
        reached: outbound.filter(r => ["delivered", "read"].includes(r.status)).length,
        read: outbound.filter(r => r.status === "read").length,
        replied: repliedLeadIds.size,
        failed: outbound.filter(r => r.status === "failed").length,
      });
      setActivity(rows.filter(r => r.message_type === "inbound" || r.status === "failed").slice(0, 12));
      if (user?.role === "admin" && inbound.length > 0) {
        const leadIds = Array.from(new Set(inbound.map(row => row.lead_id)));
        const { data: replyLeads } = await supabase
          .from("leads")
          .select("id,customer_name,customer_phone,assigned_to")
          .in("id", leadIds);
        const leadMap = new Map((replyLeads ?? []).map(lead => [lead.id, lead]));
        const profileMap = new Map(allProfiles.map(profile => [profile.id, profile.name]));
        setReplyDetails(inbound.map(row => {
          const lead = leadMap.get(row.lead_id);
          return {
            ...row,
            customer_name: lead?.customer_name || "Unnamed customer",
            customer_phone: lead?.customer_phone || null,
            salesperson_name: lead?.assigned_to ? profileMap.get(lead.assigned_to) || "Unassigned" : "Unassigned",
          };
        }));
      } else {
        setReplyDetails([]);
      }
    };
    loadPerformance();
  }, [period, sourceFilter, sending, user?.role, allProfiles]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    leads.forEach(l => l.category && s.add(l.category));
    return Array.from(s).sort();
  }, [leads]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter(l => {
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (categoryFilter !== "all" && l.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        (l.customer_name || "").toLowerCase().includes(q) ||
        (l.customer_phone || "").includes(q) ||
        inferInterest(l).toLowerCase().includes(q)
      );
    });
  }, [leads, search, categoryFilter, statusFilter]);

  const contactable = useMemo(
    () => filtered.filter(l => (l.customer_phone || "").replace(/\D/g, "").length >= 10),
    [filtered],
  );

  const selectedLeads = useMemo(
    () => contactable.filter(l => selected[l.id]),
    [contactable, selected],
  );

  const allSelected = contactable.length > 0 && selectedLeads.length === contactable.length;

  const toggleAll = () => {
    if (allSelected) {
      setSelected({});
    } else {
      const next: Record<string, boolean> = {};
      contactable.forEach(l => { next[l.id] = true; });
      setSelected(next);
    }
  };

  const wantsSummary = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach(l => {
      const key = inferInterest(l).toLowerCase();
      map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [filtered]);

  const sendAll = async () => {
    if (!user || selectedLeads.length === 0) return;
    setSending(true);
    let ok = 0;
    let fail = 0;
    for (const lead of selectedLeads) {
      setResults(r => ({ ...r, [lead.id]: { state: "sending" } }));
      const name = firstName(lead.customer_name);
      const interest = inferInterest(lead);
      try {
        const since = new Date(Date.now() - 24 * 3600000).toISOString();
        const { count: recentCount } = await supabase.from("lead_messages")
          .select("id", { count: "exact", head: true })
          .eq("lead_id", lead.id)
          .eq("message_kind", "follow_up_yes_no")
          .gte("created_at", since);
        if ((recentCount ?? 0) > 0) throw new Error("Already contacted with this follow-up in the last 24 hours");
        const { data, error } = await supabase.functions.invoke("send-whatsapp", {
          body: {
            phone: lead.customer_phone,
            content_sid: WA_TEMPLATES.followUpYesNo,
            content_variables: { "1": name, "2": interest },
            lead_id: lead.id,
            user_id: user.id,
            user_name: user.name,
            template_name: "hde_followup_yes_no_v1",
            outreach_source: "manual",
            message_kind: "follow_up_yes_no",
          },
        });
        if (error) throw error;
        if (!data?.success) throw new Error(data?.error || "Send failed");
        ok++;
        setResults(r => ({ ...r, [lead.id]: { state: "sent" } }));
      } catch (e: any) {
        fail++;
        setResults(r => ({ ...r, [lead.id]: { state: "failed", error: e?.message || "Failed" } }));
      }
      await new Promise(res => setTimeout(res, 350));
    }
    setSending(false);
    setConfirmOpen(false);
    if (ok) toast.success(`${ok} WhatsApp follow-up${ok > 1 ? "s" : ""} sent`);
    if (fail) toast.error(`${fail} could not be delivered — see the list`);
    load();
  };

  if (user?.role !== "admin" && user?.role !== "sales") {
    return <p className="text-sm text-muted-foreground p-4">Not available for your role.</p>;
  }

  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MessageSquare className="w-6 h-6" /> Follow-up Outreach
        </h1>
        <p className="text-sm text-muted-foreground">
          Every customer still deciding, what they asked for, and a one-tap WhatsApp nudge.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {STATUSES.map(s => (
          <Card key={s}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{STATUS_LABEL[s]}</p>
              <p className="text-2xl font-bold">{leads.filter(l => l.status === s).length}</p>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Selected to message</p>
            <p className="text-2xl font-bold">{selectedLeads.length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-semibold">WhatsApp performance</h2>
        <div className="flex gap-2">
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All sends</SelectItem><SelectItem value="automatic">Automatic</SelectItem><SelectItem value="manual">Manual</SelectItem></SelectContent>
          </Select>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="7">Last 7 days</SelectItem><SelectItem value="30">Last 30 days</SelectItem></SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {([
          ["Sent", performance.sent, Send], ["Reached", performance.reached, CheckCircle2],
          ["Read", performance.read, Eye], ["Replied", performance.replied, Reply],
          ["Failed", performance.failed, AlertTriangle],
          ["Reply rate", performance.reached ? `${Math.round(performance.replied / performance.reached * 100)}%` : "0%", MessageSquare],
        ] as const).map(([label, value, Icon]) => (
          label === "Replied" && user.role === "admin" ? (
            <Button
              key={label}
              variant="outline"
              className="h-auto justify-start p-3 text-left"
              onClick={() => setRepliesOpen(true)}
            >
              <span>
                <span className="flex items-center gap-1 text-[11px] font-normal text-muted-foreground"><Icon className="w-3 h-3" />{label}</span>
                <span className="block text-xl font-bold">{value}</span>
                <span className="block text-[10px] font-normal text-primary">View replies</span>
              </span>
            </Button>
          ) : (
            <Card key={String(label)}><CardContent className="p-3">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Icon className="w-3 h-3" />{label as string}</div>
              <p className="text-xl font-bold">{value as any}</p>
            </CardContent></Card>
          )
        ))}
      </div>

      {activity.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Replies and delivery issues</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {activity.map(row => (
              <div
                key={row.id}
                className={`flex gap-2 border-b last:border-0 pb-2 text-sm ${row.message_type === "inbound" && user.role === "admin" ? "cursor-pointer rounded-sm hover:bg-muted/60" : ""}`}
                onClick={() => row.message_type === "inbound" && user.role === "admin" && setRepliesOpen(true)}
                role={row.message_type === "inbound" && user.role === "admin" ? "button" : undefined}
                tabIndex={row.message_type === "inbound" && user.role === "admin" ? 0 : undefined}
                onKeyDown={event => {
                  if (row.message_type === "inbound" && user.role === "admin" && (event.key === "Enter" || event.key === " ")) setRepliesOpen(true);
                }}
              >
                {row.message_type === "inbound" ? <Reply className="w-4 h-4 text-success shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />}
                <div className="min-w-0"><p className="line-clamp-2">{row.message_body}</p><p className="text-xs text-muted-foreground">{new Date(row.sent_at).toLocaleString()} · {row.outreach_source || "manual"}</p></div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">What they are asking for</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {wantsSummary.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing pending right now.</p>
          )}
          {wantsSummary.map(([label, count]) => (
            <Badge key={label} variant="secondary" className="text-xs">
              {label} · {count}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search name, number or product"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="md:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {STATUSES.map(s => (
              <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="md:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map(c => (
              <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
          Select all {contactable.length} with a valid number
        </label>
        <Button
          disabled={selectedLeads.length === 0 || sending}
          onClick={() => setConfirmOpen(true)}
        >
          <Send className="w-4 h-4 mr-2" />
          Send WhatsApp to {selectedLeads.length}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <ScrollArea className="h-[60vh] rounded-md border">
          <div className="divide-y">
            {filtered.map(lead => {
              const phoneOk = (lead.customer_phone || "").replace(/\D/g, "").length >= 10;
              const res = results[lead.id];
              return (
                <div key={lead.id} className="flex items-start gap-3 p-3">
                  <Checkbox
                    className="mt-1"
                    disabled={!phoneOk}
                    checked={!!selected[lead.id]}
                    onCheckedChange={v =>
                      setSelected(s => ({ ...s, [lead.id]: !!v }))
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium truncate">
                        {lead.customer_name || "Unnamed"}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {STATUS_LABEL[lead.status] || lead.status}
                      </Badge>
                      {lead.budget_range && (
                        <Badge variant="secondary" className="text-[10px]">
                          {lead.budget_range}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Wants: <span className="text-foreground">{inferInterest(lead)}</span>
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Phone className="w-3 h-3" />
                      {lead.customer_phone || "no number"}
                      {lead.next_follow_up_date && ` · due ${lead.next_follow_up_date}`}
                    </p>
                    {res?.state === "failed" && (
                      <p className="text-xs text-destructive mt-1">{res.error}</p>
                    )}
                  </div>
                  <div className="pt-1">
                    {res?.state === "sending" && <Loader2 className="w-4 h-4 animate-spin" />}
                    {res?.state === "sent" && <CheckCircle2 className="w-4 h-4 text-green-600" />}
                    {res?.state === "failed" && <XCircle className="w-4 h-4 text-destructive" />}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <p className="p-6 text-sm text-muted-foreground text-center">
                No customers match these filters.
              </p>
            )}
          </div>
        </ScrollArea>
      )}

      <Dialog open={confirmOpen} onOpenChange={o => !sending && setConfirmOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send WhatsApp follow-up</DialogTitle>
            <DialogDescription>
              This goes out to {selectedLeads.length} customer
              {selectedLeads.length > 1 ? "s" : ""}. Each message uses their own name and the
              item they asked about.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-muted p-3 text-sm whitespace-pre-wrap">
            {YES_NO_FOLLOW_UP_PREVIEW
              .replace("{{1}}", firstName(selectedLeads[0]?.customer_name) || "Name")
              .replace("{{2}}", selectedLeads[0] ? inferInterest(selectedLeads[0]) : "their item")}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={sending} onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button disabled={sending} onClick={sendAll}>
              {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
              Send now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={repliesOpen} onOpenChange={setRepliesOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Customer replies</DialogTitle>
            <DialogDescription>
              Exact WhatsApp replies received during the selected {period}-day period.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[65vh] pr-3">
            <div className="space-y-3">
              {replyDetails.map(reply => (
                <div key={reply.id} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{reply.customer_name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {reply.customer_phone && (
                          <a href={`tel:${reply.customer_phone}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                            <Phone className="h-3 w-3" />{reply.customer_phone}
                          </a>
                        )}
                        <span className="inline-flex items-center gap-1"><UserRound className="h-3 w-3" />{reply.salesperson_name}</span>
                      </div>
                    </div>
                    <Badge variant="secondary">Reply</Badge>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm">{reply.message_body}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{new Date(reply.sent_at || reply.created_at).toLocaleString()}</p>
                </div>
              ))}
              {replyDetails.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">No replies in this period.</p>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LeadOutreach;
