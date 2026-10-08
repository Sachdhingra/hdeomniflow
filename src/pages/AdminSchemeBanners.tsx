import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/toast";
import {
  AlertCircle, ChevronLeft, ChevronRight, ImageOff, Loader2, RefreshCw, Trash2, Upload, Video,
} from "lucide-react";
import { compressImage } from "@/components/ImageCompressor";
import { parseStorageUrl } from "@/lib/photoUrls";
import { moveBanner, nextSortOrder, orderUpdates } from "@/lib/bannerOrder";
import {
  KIOSK_MEDIA_ACCEPT, MAX_VIDEO_MB, detectUploadType, mediaTypeOf,
} from "@/lib/kioskMedia";

const BUCKET = "scheme-banners";
/** Kiosk screens are 1080p — anything larger is bandwidth the kiosk pays for on every idle loop. */
const MAX_DIMENSION = 1920;
const MAX_SIZE_KB = 600;
/** Guard the canvas compressor against files big enough to kill the tab. */
const MAX_UPLOAD_MB = 25;
const DISPLAYABLE = ["image/jpeg", "image/png", "image/webp", "image/gif"];

interface Banner {
  id: string;
  title: string;
  image_url: string;
  media_type: string | null;
  active: boolean;
  sort_order: number;
}

const AdminSchemeBanners = () => {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The label of the step in flight, or null when idle.
  const [busy, setBusy] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  // id -> why this phone could not preview it. A failed admin preview does not
  // mean the stored clip is invalid or that the kiosk cannot play it.
  const [broken, setBroken] = useState<Map<string, string>>(new Map());
  const [title, setTitle] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("scheme_banners")
      .select("id,title,image_url,media_type,active,sort_order")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    setLoading(false);
    if (error) {
      // Without this the page showed an empty "No banners yet" for an RLS
      // denial, a dropped connection and an expired session alike.
      setLoadError(error.message);
      return;
    }
    setLoadError(null);
    setBroken(new Map());
    setBanners((data as Banner[]) ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    // Cleared up front so the same file can be picked again after a failure.
    input.value = "";

    const kind = detectUploadType(file);
    if (!kind) {
      return toast.error("Please choose a JPG, PNG, WEBP or GIF image, or an MP4 or WEBM video.");
    }
    const sizeLimitMb = kind === "video" ? MAX_VIDEO_MB : MAX_UPLOAD_MB;
    if (file.size > sizeLimitMb * 1024 * 1024) {
      return toast.error(
        `That ${kind} is ${(file.size / 1024 / 1024).toFixed(1)} MB — please use one under ${sizeLimitMb} MB.`,
      );
    }

    setBusy("Uploading…");
    try {
      // Videos go up as-is: the canvas compressor only understands images, and
      // re-encoding video in the browser is not worth the wait on this page.
      const upload = kind === "video"
        ? file
        : await compressImage(file, MAX_SIZE_KB, MAX_DIMENSION);
      // compressImage hands the original file back when the browser cannot
      // decode it — an iPhone HEIC, mostly. Those upload happily and then show
      // as a blank screen on the kiosk, so stop them here.
      if (kind === "image" && !DISPLAYABLE.includes(upload.type)) {
        return toast.error("That image format can't be shown on the kiosk. Please upload a JPG or PNG.");
      }

      const path = `${Date.now()}-${upload.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, upload, {
        cacheControl: "31536000",
        contentType: upload.type || (kind === "video" ? "video/mp4" : "image/jpeg"),
        upsert: false,
      });
      if (upErr) return toast.error(`Upload failed: ${upErr.message}`);

      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const { data: auth } = await supabase.auth.getUser();
      const { error: insErr } = await supabase.from("scheme_banners").insert({
        title: title.trim() || file.name,
        image_url: pub.publicUrl,
        media_type: kind,
        active: true,
        sort_order: nextSortOrder(banners),
        created_by: auth.user?.id ?? null,
      });
      if (insErr) {
        // Don't leave the uploaded file orphaned in the bucket.
        await supabase.storage.from(BUCKET).remove([path]);
        return toast.error(`Could not save banner: ${insErr.message}`);
      }

      setTitle("");
      toast.success(kind === "video" ? "Video uploaded" : "Banner uploaded");
      load();
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (b: Banner) => {
    setBusyId(b.id);
    const { error } = await supabase
      .from("scheme_banners")
      .update({ active: !b.active })
      .eq("id", b.id);
    setBusyId(null);
    if (error) return toast.error(`Could not update "${b.title || "banner"}": ${error.message}`);
    setBanners((prev) => prev.map((x) => (x.id === b.id ? { ...x, active: !b.active } : x)));
  };

  const remove = async (b: Banner) => {
    if (!confirm(`Delete "${b.title || "this banner"}"? This cannot be undone.`)) return;
    setBusyId(b.id);
    const { error } = await supabase.from("scheme_banners").delete().eq("id", b.id);
    if (error) {
      setBusyId(null);
      return toast.error(`Could not delete banner: ${error.message}`);
    }

    // The row is gone either way, so a failed cleanup is wasted storage rather
    // than a failed delete — log it instead of failing the action.
    const stored = parseStorageUrl(b.image_url);
    if (stored?.bucket === BUCKET) {
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove([stored.path]);
      if (rmErr) console.warn(`[kiosk-banners] left ${stored.path} in storage: ${rmErr.message}`);
    }

    setBusyId(null);
    setBanners((prev) => prev.filter((x) => x.id !== b.id));
    toast.success("Banner deleted");
  };

  const move = async (index: number, direction: -1 | 1) => {
    const next = moveBanner(banners, index, direction);
    if (next === banners) return;
    const updates = orderUpdates(next);
    if (updates.length === 0) return;

    const previous = banners;
    setBanners(next.map((b, i) => ({ ...b, sort_order: i })));
    setReordering(true);
    for (const u of updates) {
      const { error } = await supabase
        .from("scheme_banners")
        .update({ sort_order: u.sort_order })
        .eq("id", u.id);
      if (error) {
        setBanners(previous);
        setReordering(false);
        return toast.error(`Could not reorder banners: ${error.message}`);
      }
    }
    setReordering(false);
  };

  const markBroken = (id: string, reason: string) =>
    setBroken((prev) => new Map(prev).set(id, reason));

  /**
   * A <video> reports one undifferentiated error for "404", "empty file" and
   * "codec this browser can't decode", and guessing wrong sends someone
   * hunting through storage for a file that is sitting right there. Ask the
   * URL what actually happened.
   */
  const diagnoseVideo = async (b: Banner) => {
    markBroken(b.id, "Checking…");
    let res: Response;
    try {
      res = await fetch(b.image_url, { method: "HEAD" });
    } catch {
      return markBroken(b.id, "Could not reach storage — check the connection");
    }
    if (!res.ok) return markBroken(b.id, "File missing from storage — upload it again");
    if (Number(res.headers.get("content-length") ?? 0) === 0) {
      return markBroken(b.id, "Uploaded file is empty — upload it again");
    }
    markBroken(b.id, "Video uploaded successfully. Preview is not available on this phone; the kiosk will play the stored file.");
  };

  const activeCount = banners.filter((b) => b.active).length;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Kiosk Scheme Banners</h1>
          <p className="text-sm text-muted-foreground">
            Shown as a full-screen screensaver when the feedback kiosk sits idle, in the order below.
            Videos play right through before the next item; a single video loops on its own.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Add new banner or video</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <Label htmlFor="banner-title">Title (optional)</Label>
            <Input
              id="banner-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Diwali Sale"
            />
          </div>
          <div>
            <Label htmlFor="banner-file">Image or video</Label>
            <Input
              id="banner-file"
              type="file"
              accept={KIOSK_MEDIA_ACCEPT}
              onChange={onFile}
              disabled={!!busy}
            />
          </div>
          {busy && (
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <Loader2 className="w-4 h-4 animate-spin" /> {busy}
            </span>
          )}
          <p className="text-xs text-muted-foreground w-full flex items-center gap-1">
            <Upload className="w-3 h-3" /> JPG or PNG images (landscape) are resized to{" "}
            {MAX_DIMENSION}px wide so the kiosk loads them quickly. Standard MP4 videos, including
            Gemini-generated 1280 × 720 clips, upload directly. Keep videos under {MAX_VIDEO_MB} MB.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Current banners
            {!loading && !loadError && banners.length > 0 && (
              <span className="text-sm font-normal text-muted-foreground">
                {activeCount} of {banners.length} showing on the kiosk
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : loadError ? (
            <div className="flex flex-col items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <p className="text-sm font-medium flex items-center gap-2 text-destructive">
                <AlertCircle className="w-4 h-4" /> Could not load banners
              </p>
              <p className="text-sm text-muted-foreground">{loadError}</p>
              <Button size="sm" variant="outline" onClick={load}>
                <RefreshCw className="w-4 h-4 mr-1" /> Try again
              </Button>
            </div>
          ) : banners.length === 0 ? (
            <p className="text-sm text-muted-foreground">No banners yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {banners.map((b, i) => (
                <div key={b.id} className="border rounded-lg overflow-hidden bg-card">
                  <div className="aspect-video bg-muted">
                    {broken.has(b.id) ? (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-3 text-center text-muted-foreground">
                        <ImageOff className="w-6 h-6" />
                        <span className="text-xs">{broken.get(b.id)}</span>
                      </div>
                    ) : mediaTypeOf(b) === "video" ? (
                      // Muted and controllable so an admin can check the clip
                      // without a wall of tiles all playing at once.
                      <video
                        src={b.image_url}
                        className="w-full h-full object-cover bg-black"
                        muted
                        playsInline
                        controls
                        preload="metadata"
                        onError={() => diagnoseVideo(b)}
                      />
                    ) : (
                      <img
                        src={b.image_url}
                        alt={b.title}
                        className="w-full h-full object-cover"
                        onError={() => markBroken(b.id, "Image missing from storage")}
                      />
                    )}
                  </div>
                  <div className="p-3 space-y-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium truncate">{b.title || "Untitled"}</span>
                      {mediaTypeOf(b) === "video" && (
                        <span className="shrink-0 flex items-center gap-1 text-xs rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                          <Video className="w-3 h-3" /> Video
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-sm">
                        <Switch
                          checked={b.active}
                          disabled={busyId === b.id}
                          onCheckedChange={() => toggle(b)}
                        />
                        {b.active ? "Active" : "Hidden"}
                      </label>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Move "${b.title || "banner"}" earlier`}
                          disabled={i === 0 || reordering}
                          onClick={() => move(i, -1)}
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Move "${b.title || "banner"}" later`}
                          disabled={i === banners.length - 1 || reordering}
                          onClick={() => move(i, 1)}
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Delete "${b.title || "banner"}"`}
                          disabled={busyId === b.id}
                          onClick={() => remove(b)}
                        >
                          {busyId === b.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4 text-destructive" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminSchemeBanners;
