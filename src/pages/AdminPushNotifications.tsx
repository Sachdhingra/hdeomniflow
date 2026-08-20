import { useEffect, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/lib/toast";
import { BellRing, Image as ImageIcon, Loader2, MessageSquareText, Send, Smartphone, Tag, Upload, Users, X } from "lucide-react";
import { formatDate } from "@/lib/dateFormat";

type CampaignType = "text" | "banner" | "offer" | "reengagement";
type Audience = "customers" | "staff";

interface Campaign {
  id: string;
  campaign_type: CampaignType;
  audience: Audience | null;
  title: string;
  message: string;
  image_url: string | null;
  link_url: string | null;
  offer_code: string | null;
  offer_expires_at: string | null;
  status: "pending" | "sending" | "sent" | "failed";
  recipients_targeted: number;
  recipients_sent: number;
  created_at: string;
  sent_at: string | null;
}

interface AutomationSetting {
  key: string;
  label: string;
  description: string | null;
  enabled: boolean;
}

const TYPE_META: Record<CampaignType, { label: string; icon: React.ReactNode; hint: string }> = {
  text: {
    label: "Text",
    icon: <MessageSquareText className="w-4 h-4" />,
    hint: "Plain title + message notification.",
  },
  banner: {
    label: "Banner",
    icon: <ImageIcon className="w-4 h-4" />,
    hint: "Rich notification with a large banner image.",
  },
  offer: {
    label: "Offer",
    icon: <Tag className="w-4 h-4" />,
    hint: "Promotional offer with optional code, expiry and image.",
  },
  reengagement: {
    label: "Turn notifications on",
    icon: <BellRing className="w-4 h-4" />,
    hint:
      "Nudges every device still subscribed — including customers who turned Offers & Promotions off — to switch notifications back on. Anyone whose browser permission is revoked can't be pushed at all; they get the in-app prompt the next time they open the Insider app.",
  },
};

const emptyForm = {
  audience: "customers" as Audience,
  campaign_type: "text" as CampaignType,
  title: "",
  message: "",
  image_url: "",
  link_url: "",
  offer_code: "",
  offer_expires_at: "",
};

// Prefilled so re-engaging existing app users is a one-click action.
const REENGAGEMENT_DRAFT = {
  title: "Turn your notifications back on",
  message:
    "You're missing points expiry reminders, member-only offers and service updates. Open HD Insider and tap \u201cTurn on notifications\u201d to start getting them again.",
};

const STATUS_CLS: Record<Campaign["status"], string> = {
  pending: "bg-muted text-muted-foreground",
  sending: "bg-yellow-500/10 text-yellow-600",
  sent: "bg-emerald-500/10 text-emerald-600",
  failed: "bg-destructive/10 text-destructive",
};

const AdminPushNotifications = () => {
  const [form, setForm] = useState({ ...emptyForm });
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reach, setReach] = useState<number | null>(null);
  const [staffReach, setStaffReach] = useState<number | null>(null);
  const [needsOptIn, setNeedsOptIn] = useState<number | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [settings, setSettings] = useState<AutomationSetting[]>([]);
  const [installed, setInstalled] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [reachRes, campRes, setRes, installedRes] = await Promise.all([
      supabase.functions.invoke("broadcast-push", { body: { action: "status" } }),
      supabase
        .from("push_campaigns" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("push_automation_settings" as any)
        .select("key, label, description, enabled")
        .order("key"),
      supabase.from("app_users").select("id", { count: "exact", head: true }),
    ]);
    if (reachRes.error) {
      console.error("Could not load OneSignal device count:", reachRes.error);
      setReach(0);
      setStaffReach(0);
      setNeedsOptIn(null);
    } else {
      const status = reachRes.data as
        | { reachable?: number; staff_reachable?: number; needs_opt_in?: number }
        | null;
      setReach(status?.reachable ?? 0);
      setStaffReach(status?.staff_reachable ?? 0);
      setNeedsOptIn(status?.needs_opt_in ?? 0);
    }
    setInstalled(installedRes.count ?? 0);
    if (campRes.error) toast.error(campRes.error.message);
    setCampaigns((campRes.data as unknown as Campaign[]) ?? []);
    if (setRes.error) toast.error(setRes.error.message);
    setSettings((setRes.data as unknown as AutomationSetting[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const path = `push/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const { error: upErr } = await supabase.storage.from("scheme-banners").upload(path, file, {
      cacheControl: "31536000",
      upsert: false,
    });
    setUploading(false);
    e.target.value = "";
    if (upErr) return toast.error(upErr.message);
    const { data: pub } = supabase.storage.from("scheme-banners").getPublicUrl(path);
    setForm((f) => ({ ...f, image_url: pub.publicUrl }));
    toast.success("Image uploaded");
  };

  const validate = (): string | null => {
    if (!form.title.trim()) return "Title is required";
    if (!form.message.trim()) return "Message is required";
    if (form.campaign_type === "banner" && !form.image_url) return "Banner pushes need an image";
    if (form.audience === "staff" && form.campaign_type === "reengagement") {
      return "The re-engagement nudge is for Insider customers";
    }
    return null;
  };

  // Switches the composer to the prefilled nudge so it's a single confirm.
  const startReengagement = () => {
    setForm({
      ...emptyForm,
      audience: "customers",
      campaign_type: "reengagement",
      ...REENGAGEMENT_DRAFT,
    });
  };

  const openConfirm = () => {
    const err = validate();
    if (err) return toast.error(err);
    setConfirmOpen(true);
  };

  const send = async () => {
    setConfirmOpen(false);
    setSending(true);
    const { data, error } = await supabase.functions.invoke("broadcast-push", {
      body: {
        audience: form.audience,
        campaign_type: form.campaign_type,
        title: form.title.trim(),
        message: form.message.trim(),
        image_url: form.image_url || undefined,
        link_url: form.link_url.trim() || undefined,
        offer_code: form.campaign_type === "offer" ? form.offer_code.trim() || undefined : undefined,
        offer_expires_at:
          form.campaign_type === "offer" && form.offer_expires_at
            ? new Date(form.offer_expires_at).toISOString()
            : undefined,
      },
    });
    setSending(false);
    if (error) {
      let message = error.message;
      if (error instanceof FunctionsHttpError) {
        try {
          const payload = await error.context.json() as { error?: string };
          message = payload.error || message;
        } catch {
          // Keep the SDK message if the function did not return JSON.
        }
      }
      return toast.error(message);
    }
    const res = data as { targeted?: number; sent?: number; error?: string };
    if (res?.error) {
      toast.error(`Send failed: ${res.error}`);
    } else {
      const noun = form.audience === "staff" ? "staff devices" : "customers";
      toast.success(`Push sent to ${res?.sent ?? 0} of ${res?.targeted ?? 0} ${noun}`);
      setForm({ ...emptyForm });
    }
    load();
  };

  const toggleAutomation = async (s: AutomationSetting) => {
    // Optimistic flip
    setSettings((prev) => prev.map((x) => (x.key === s.key ? { ...x, enabled: !s.enabled } : x)));
    const { error } = await supabase
      .from("push_automation_settings" as any)
      .update({ enabled: !s.enabled, updated_at: new Date().toISOString() })
      .eq("key", s.key);
    if (error) {
      setSettings((prev) => prev.map((x) => (x.key === s.key ? { ...x, enabled: s.enabled } : x)));
      return toast.error(error.message);
    }
    toast.success(`${s.label} ${!s.enabled ? "enabled" : "disabled"}`);
  };

  const isReengagement = form.campaign_type === "reengagement";
  const showImage = form.campaign_type === "banner" || form.campaign_type === "offer";
  const isOffer = form.campaign_type === "offer";
  const audienceReach = form.audience === "staff" ? staffReach : reach;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BellRing className="w-6 h-6" /> Push Notifications
          </h1>
          <p className="text-sm text-muted-foreground">
            Broadcast push notifications to the Insider app and the OmniFlow staff app, and manage
            automated reminders.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Badge variant="secondary" className="flex items-center gap-1.5 text-sm px-3 py-1.5">
              <Users className="w-4 h-4" />
              {reach === null ? "—" : reach} Insider device{reach === 1 ? "" : "s"}
            </Badge>
            <Badge variant="secondary" className="flex items-center gap-1.5 text-sm px-3 py-1.5">
              <Smartphone className="w-4 h-4" />
              {staffReach === null ? "—" : staffReach} staff device{staffReach === 1 ? "" : "s"}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            {installed === null ? "—" : installed} app account{installed === 1 ? "" : "s"} linked
          </span>
        </div>
      </div>

      {reach === 0 && (installed ?? 0) > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          All {installed} linked app account{installed === 1 ? " is" : "s are"} opted in to
          notifications by default, but no device has saved its push token yet. Broadcasts will be
          sent to every device subscribed in the push provider until tokens start syncing.
        </div>
      )}

      {/* ── Re-engagement ───────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellRing className="w-5 h-5" /> Get existing app users switched on
          </CardTitle>
          <CardDescription>
            Customers who installed the Insider app before notifications were on by default may
            never have been asked for permission. Two things reach them: this push, which lands on
            every device still holding a subscription, and the in-app banner the Insider app shows
            on open to anyone whose notifications are off — including the ones no push can reach.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm text-muted-foreground">
            {needsOptIn === null
              ? "Opt-in status is still syncing from the app."
              : needsOptIn === 0
                ? "Every linked app account has notifications granted."
                : `${needsOptIn} app account${needsOptIn === 1 ? " has" : "s have"} notifications off or not yet granted.`}
          </p>
          <Button variant="outline" onClick={startReengagement} disabled={sending}>
            <BellRing className="w-4 h-4" /> Compose the nudge
          </Button>
        </CardContent>
      </Card>


      {/* ── Compose ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Send a broadcast</CardTitle>
          <CardDescription>
            {form.audience === "staff"
              ? "Goes to every OmniFlow staff device registered for push."
              : isReengagement
                ? "Goes to every Insider device still subscribed, whatever their Offers & Promotions setting — the point is to win back the ones who are off."
                : "Promotional — goes to every app customer who hasn\u2019t turned off Offers & Promotions."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Audience</Label>
            <div className="flex gap-2 mt-1.5 flex-wrap">
              <Button
                type="button"
                variant={form.audience === "customers" ? "default" : "outline"}
                size="sm"
                onClick={() => setForm((f) => ({ ...f, audience: "customers" }))}
              >
                <Users className="w-4 h-4" /> Insider customers
              </Button>
              <Button
                type="button"
                variant={form.audience === "staff" ? "default" : "outline"}
                size="sm"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    audience: "staff",
                    // The nudge is customer-only; fall back to a plain message.
                    campaign_type: f.campaign_type === "reengagement" ? "text" : f.campaign_type,
                  }))
                }
              >
                <Smartphone className="w-4 h-4" /> OmniFlow staff
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {form.audience === "staff"
                ? `${staffReach ?? "—"} staff device${staffReach === 1 ? "" : "s"} registered.`
                : `${reach ?? "—"} customer device${reach === 1 ? "" : "s"} reachable.`}
            </p>
          </div>

          <div>
            <Label>Notification type</Label>
            <div className="flex gap-2 mt-1.5 flex-wrap">
              {(Object.keys(TYPE_META) as CampaignType[])
                .filter((t) => t !== "reengagement" || form.audience === "customers")
                .map((t) => (
                <Button
                  key={t}
                  type="button"
                  variant={form.campaign_type === t ? "default" : "outline"}
                  size="sm"
                  onClick={() => setForm((f) => ({ ...f, campaign_type: t }))}
                >
                  {TYPE_META[t].icon} {TYPE_META[t].label}
                </Button>
                ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{TYPE_META[form.campaign_type].hint}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label>Title</Label>
              <Input
                value={form.title}
                maxLength={80}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder={isOffer ? "Flat 20% off this weekend!" : "Big news from Home Decor"}
              />
            </div>
            <div className="md:col-span-2">
              <Label>Message</Label>
              <Textarea
                value={form.message}
                maxLength={300}
                rows={3}
                onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                placeholder="Write the notification body…"
              />
              <p className="text-xs text-muted-foreground mt-1">{form.message.length}/300</p>
            </div>

            {showImage && (
              <div className="md:col-span-2">
                <Label>
                  Image {form.campaign_type === "banner" ? "(required)" : "(optional)"}
                </Label>
                {form.image_url && (
                  <div className="my-2 relative aspect-[2/1] w-full max-w-md overflow-hidden rounded-md bg-muted">
                    <img src={form.image_url} alt="" className="w-full h-full object-cover" />
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      className="absolute top-2 right-2 h-7 w-7"
                      onClick={() => setForm((f) => ({ ...f, image_url: "" }))}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                )}
                <Input type="file" accept="image/*" onChange={onFile} disabled={uploading} />
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Upload className="w-3 h-3" /> Recommended 1024×512 (2:1). JPG/PNG/WEBP.
                </p>
              </div>
            )}

            <div className={isOffer ? "" : "md:col-span-2"}>
              <Label>Click-through link (optional)</Label>
              <Input
                value={form.link_url}
                onChange={(e) => setForm((f) => ({ ...f, link_url: e.target.value }))}
                placeholder="https://…"
              />
            </div>

            {isOffer && (
              <>
                <div>
                  <Label>Offer code (optional)</Label>
                  <Input
                    value={form.offer_code}
                    onChange={(e) => setForm((f) => ({ ...f, offer_code: e.target.value }))}
                    placeholder="DIWALI20"
                  />
                </div>
                <div>
                  <Label>Offer valid till (optional)</Label>
                  <Input
                    type="datetime-local"
                    value={form.offer_expires_at}
                    onChange={(e) => setForm((f) => ({ ...f, offer_expires_at: e.target.value }))}
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex justify-end">
            <Button onClick={openConfirm} disabled={sending || uploading}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {form.audience === "staff" ? "Send to all staff" : "Send to all customers"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Auto reminders ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Automated reminders</CardTitle>
          <CardDescription>
            Sent automatically by the daily loyalty job. Account alerts (points, card, birthday,
            anniversary) are always delivered regardless of the customer&rsquo;s Offers &amp;
            Promotions setting; the we-miss-you reminder is promotional and respects it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : settings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No automation settings found. Run the latest database migration.
            </p>
          ) : (
            <div className="divide-y">
              {settings.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{s.label}</p>
                    {s.description && (
                      <p className="text-xs text-muted-foreground">{s.description}</p>
                    )}
                  </div>
                  <Switch checked={s.enabled} onCheckedChange={() => toggleAutomation(s)} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── History ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Recent broadcasts</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No broadcasts sent yet.</p>
          ) : (
            <div className="space-y-3">
              {campaigns.map((c) => (
                <div key={c.id} className="border rounded-lg p-3 flex gap-3">
                  {c.image_url && (
                    <div className="w-20 h-12 shrink-0 rounded overflow-hidden bg-muted hidden sm:block">
                      <img src={c.image_url} alt="" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">{c.title}</span>
                      <Badge variant="outline" className="text-xs capitalize">
                        {TYPE_META[c.campaign_type]?.label ?? c.campaign_type}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {c.audience === "staff" ? "Staff" : "Customers"}
                      </Badge>
                      <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${STATUS_CLS[c.status]}`}>
                        {c.status}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{c.message}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDate(c.sent_at ?? c.created_at)} · sent to {c.recipients_sent}/{c.recipients_targeted}
                      {c.offer_code ? ` · code ${c.offer_code}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Confirm dialog ──────────────────────────────────────── */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Send this push to all {form.audience === "staff" ? "staff" : "customers"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{form.title}&rdquo; will be delivered to {audienceReach ?? "all"} push-enabled
              device{audienceReach === 1 ? "" : "s"} immediately. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={send}>Send now</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdminPushNotifications;
