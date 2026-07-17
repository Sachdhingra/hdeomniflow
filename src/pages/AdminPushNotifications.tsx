import { useEffect, useState } from "react";
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
import { toast } from "sonner";
import { BellRing, Image as ImageIcon, Loader2, MessageSquareText, Send, Tag, Upload, Users, X } from "lucide-react";
import { formatDate } from "@/lib/dateFormat";

type CampaignType = "text" | "banner" | "offer";

interface Campaign {
  id: string;
  campaign_type: CampaignType;
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
};

const emptyForm = {
  campaign_type: "text" as CampaignType,
  title: "",
  message: "",
  image_url: "",
  link_url: "",
  offer_code: "",
  offer_expires_at: "",
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
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [settings, setSettings] = useState<AutomationSetting[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [reachRes, campRes, setRes] = await Promise.all([
      supabase
        .from("app_users")
        .select("id", { count: "exact", head: true })
        .eq("push_enabled", true)
        .not("onesignal_player_id", "is", null),
      supabase
        .from("push_campaigns" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("push_automation_settings" as any)
        .select("key, label, description, enabled")
        .order("key"),
    ]);
    if (reachRes.error) toast.error(reachRes.error.message);
    setReach(reachRes.count ?? 0);
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
    return null;
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
    if (error) return toast.error(error.message);
    const res = data as { targeted?: number; sent?: number; error?: string };
    if (res?.error) {
      toast.error(`Send failed: ${res.error}`);
    } else {
      toast.success(`Push sent to ${res?.sent ?? 0} of ${res?.targeted ?? 0} customers`);
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

  const showImage = form.campaign_type !== "text";
  const isOffer = form.campaign_type === "offer";

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BellRing className="w-6 h-6" /> Push Notifications
          </h1>
          <p className="text-sm text-muted-foreground">
            Broadcast push notifications to Insider app customers and manage automated reminders.
          </p>
        </div>
        <Badge variant="secondary" className="flex items-center gap-1.5 text-sm px-3 py-1.5">
          <Users className="w-4 h-4" />
          {reach === null ? "—" : reach} reachable device{reach === 1 ? "" : "s"}
        </Badge>
      </div>

      {/* ── Compose ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Send a broadcast</CardTitle>
          <CardDescription>
            Goes to every app customer with push notifications enabled.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Notification type</Label>
            <div className="flex gap-2 mt-1.5 flex-wrap">
              {(Object.keys(TYPE_META) as CampaignType[]).map((t) => (
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
              Send to all customers
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Auto reminders ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Automated reminders</CardTitle>
          <CardDescription>
            Sent automatically by the daily loyalty job. Toggle any reminder on or off.
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
                        {c.campaign_type}
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
            <AlertDialogTitle>Send this push to all customers?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{form.title}&rdquo; will be delivered to {reach ?? "all"} push-enabled
              device{reach === 1 ? "" : "s"} immediately. This cannot be undone.
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
