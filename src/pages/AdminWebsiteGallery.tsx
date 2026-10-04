import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/toast";
import { Check, Globe, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import SignedImg from "@/components/SignedImg";
import { compressImage } from "@/components/ImageCompressor";
import { parseStorageUrl, resolvePhotoUrl } from "@/lib/photoUrls";

/**
 * Website Gallery: picks delivery proof photos to show on the public website
 * ("Recently delivered in Dehradun" on hdefurniture.netlify.app).
 *
 * Proof photos stay private in job-photos. Publishing copies one into the
 * private website-gallery bucket with a caption and category only, so nothing
 * about the customer goes public. The website reads expiring signed copies
 * through the website-gallery edge function.
 */

const BUCKET = "website-gallery";
const MAX_SIZE_KB = 350;
const MAX_DIMENSION = 1600;
const DISPLAYABLE = ["image/jpeg", "image/png", "image/webp"];
const RECENT_JOBS = 40;

const CATEGORY_LABELS: Record<string, string> = {
  sofa: "Sofa", coffee_table: "Coffee table", almirah: "Almirah", dining: "Dining set",
  mattress: "Mattress", bed: "Bed", kitchen: "Modular kitchen", chair: "Chair",
  office_table: "Office table", others: "Furniture",
};

const defaultCaption = (category: string | null) =>
  `${CATEGORY_LABELS[category ?? ""] ?? "Furniture"} delivered in Dehradun`;

interface Job {
  id: string;
  category: string | null;
  photos: string[] | null;
  date_to_attend: string | null;
  completed_at: string | null;
  created_at: string;
}

interface GalleryPhoto {
  id: string;
  image_url: string;
  storage_path: string;
  caption: string;
  category: string | null;
  source_photo: string | null;
  active: boolean;
  created_at: string;
}

const realPhotos = (photos: string[] | null) =>
  (photos ?? []).filter((p) => typeof p === "string" && p.trim() !== "");

async function uploadToGallery(file: Blob, name: string): Promise<{ path: string; url: string }> {
  const asFile = file instanceof File ? file : new File([file], name, { type: file.type || "image/jpeg" });
  const upload = await compressImage(asFile, MAX_SIZE_KB, MAX_DIMENSION);
  // compressImage hands back the original when the browser can't decode it (iPhone HEIC).
  if (!DISPLAYABLE.includes(upload.type)) throw new Error("This photo format can't be shown on the website. Use a JPG or PNG.");
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, upload, {
    cacheControl: "31536000",
    contentType: upload.type,
    upsert: false,
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return { path, url: path };
}

const AdminWebsiteGallery = () => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [gallery, setGallery] = useState<GalleryPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Caption drafts keyed by "<jobId>|<photo>".
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [uploadCaption, setUploadCaption] = useState("");
  const [uploadCategory, setUploadCategory] = useState("sofa");

  const load = useCallback(async () => {
    setLoading(true);
    const [jobsRes, galleryRes] = await Promise.all([
      supabase
        .from("service_jobs")
        .select("id, category, photos, date_to_attend, completed_at, created_at")
        .in("type", ["delivery", "self_delivery"])
        .is("deleted_at", null)
        .not("photos", "is", null)
        .order("created_at", { ascending: false })
        .limit(RECENT_JOBS),
      supabase
        .from("website_gallery")
        .select("id, image_url, storage_path, caption, category, source_photo, active, created_at")
        .order("created_at", { ascending: false }),
    ]);
    setLoading(false);
    const error = jobsRes.error || galleryRes.error;
    if (error) {
      setLoadError(error.message);
      return;
    }
    setLoadError(null);
    setJobs(((jobsRes.data as Job[]) ?? []).filter((j) => realPhotos(j.photos).length > 0));
    setGallery((galleryRes.data as GalleryPhoto[]) ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const published = useMemo(
    () => new Set(gallery.map((g) => g.source_photo).filter(Boolean) as string[]),
    [gallery],
  );

  const insertRow = async (
    row: Omit<TablesInsert<"website_gallery">, "storage_path" | "created_by">,
    path: string,
  ) => {
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("website_gallery")
      .insert({ ...row, storage_path: path, created_by: auth.user?.id ?? null });
    if (error) {
      // Don't leave the public copy behind when the row didn't save.
      await supabase.storage.from(BUCKET).remove([path]);
      throw new Error(`Could not save: ${error.message}`);
    }
  };

  const publish = async (job: Job, photo: string) => {
    const key = `${job.id}|${photo}`;
    const caption = (captions[key] ?? defaultCaption(job.category)).trim();
    if (!caption) return toast.error("Add a short caption first");
    setBusyKey(key);
    try {
      const signed = await resolvePhotoUrl(photo, "job-photos", { force: true });
      if (!signed) throw new Error("Could not open this photo");
      const res = await fetch(signed);
      if (!res.ok) throw new Error("Could not download this photo");
      const { path, url } = await uploadToGallery(await res.blob(), "delivery.jpg");
      await insertRow({
        image_url: url,
        caption,
        category: job.category,
        source_job_id: job.id,
        source_photo: photo,
        delivered_on: (job.completed_at || job.date_to_attend || job.created_at)?.slice(0, 10) ?? null,
        active: true,
      }, path);
      toast.success("Published on the website");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not publish");
    } finally {
      setBusyKey(null);
    }
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const caption = (uploadCaption || defaultCaption(uploadCategory)).trim();
    setBusyKey("upload");
    try {
      const { path, url } = await uploadToGallery(file, file.name);
      await insertRow({ image_url: url, caption, category: uploadCategory, active: true }, path);
      setUploadCaption("");
      toast.success("Published on the website");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload");
    } finally {
      setBusyKey(null);
    }
  };

  const toggle = async (g: GalleryPhoto) => {
    setBusyKey(g.id);
    const { error } = await supabase.from("website_gallery").update({ active: !g.active }).eq("id", g.id);
    setBusyKey(null);
    if (error) return toast.error(`Could not update: ${error.message}`);
    setGallery((prev) => prev.map((x) => (x.id === g.id ? { ...x, active: !g.active } : x)));
  };

  const remove = async (g: GalleryPhoto) => {
    if (!confirm("Remove this photo from the website? The delivery proof photo is kept.")) return;
    setBusyKey(g.id);
    const { error } = await supabase.from("website_gallery").delete().eq("id", g.id);
    if (error) {
      setBusyKey(null);
      return toast.error(`Could not remove: ${error.message}`);
    }
    const path = g.storage_path || parseStorageUrl(g.image_url)?.path;
    if (path) {
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove([path]);
      if (rmErr) console.warn(`[website-gallery] left ${path} in storage: ${rmErr.message}`);
    }
    setBusyKey(null);
    setGallery((prev) => prev.filter((x) => x.id !== g.id));
    toast.success("Removed from the website");
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Globe className="w-6 h-6" /> Website Gallery</h1>
          <p className="text-sm text-muted-foreground">
            Pick delivery photos to show under "Recently delivered in Dehradun" on the website.
            Only the photo and caption go public. Skip photos showing faces, house numbers or invoices.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {loadError && <p className="text-sm text-destructive">Could not load: {loadError}</p>}

      <Card>
        <CardHeader><CardTitle className="text-base">On the website ({gallery.filter((g) => g.active).length} showing)</CardTitle></CardHeader>
        <CardContent>
          {gallery.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing published yet. The website hides the section until you publish a photo.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {gallery.map((g) => (
                <div key={g.id} className={`rounded-lg border overflow-hidden ${g.active ? "" : "opacity-50"}`}>
                  <SignedImg src={g.storage_path || g.image_url} bucket={BUCKET} alt={g.caption} className="w-full aspect-[4/3] object-cover" />
                  <div className="p-2 space-y-2">
                    <p className="text-xs line-clamp-2">{g.caption}</p>
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-1 text-xs">
                        <Switch checked={g.active} onCheckedChange={() => toggle(g)} disabled={busyKey === g.id} /> Show
                      </label>
                      <Button variant="ghost" size="icon" onClick={() => remove(g)} disabled={busyKey === g.id} aria-label="Remove">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent delivery photos</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          {loading && <Loader2 className="w-5 h-5 animate-spin" />}
          {!loading && jobs.length === 0 && <p className="text-sm text-muted-foreground">No delivery photos yet.</p>}
          {jobs.map((job) => (
            <div key={job.id} className="space-y-2">
              <p className="text-sm font-medium">
                {CATEGORY_LABELS[job.category ?? ""] ?? "Delivery"} ·{" "}
                {new Date(job.completed_at || job.date_to_attend || job.created_at).toLocaleDateString("en-IN")}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {realPhotos(job.photos).map((photo) => {
                  const key = `${job.id}|${photo}`;
                  const done = published.has(photo);
                  return (
                    <div key={key} className="rounded-lg border overflow-hidden">
                      <SignedImg src={photo} bucket="job-photos" className="w-full aspect-[4/3] object-cover" />
                      <div className="p-2 space-y-2">
                        {done ? (
                          <p className="text-xs text-green-700 flex items-center gap-1"><Check className="w-3 h-3" /> On the website</p>
                        ) : (
                          <>
                            <Input
                              className="h-8 text-xs"
                              value={captions[key] ?? defaultCaption(job.category)}
                              onChange={(e) => setCaptions((c) => ({ ...c, [key]: e.target.value }))}
                              maxLength={80}
                            />
                            <Button size="sm" className="w-full" onClick={() => publish(job, photo)} disabled={busyKey !== null}>
                              {busyKey === key ? <Loader2 className="w-4 h-4 animate-spin" /> : "Publish"}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Upload another photo</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
          <div className="space-y-1">
            <Label>Caption</Label>
            <Input value={uploadCaption} placeholder={defaultCaption(uploadCategory)} onChange={(e) => setUploadCaption(e.target.value)} maxLength={80} />
          </div>
          <div className="space-y-1">
            <Label>Category</Label>
            <select
              className="h-10 w-full rounded-md border bg-background px-2 text-sm"
              value={uploadCategory}
              onChange={(e) => setUploadCategory(e.target.value)}
            >
              {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <Button asChild disabled={busyKey !== null}>
            <label className="cursor-pointer">
              {busyKey === "upload" ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Upload className="w-4 h-4 mr-1" />}
              Choose photo
              <input type="file" accept="image/*" className="hidden" onChange={onUpload} disabled={busyKey !== null} />
            </label>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminWebsiteGallery;
