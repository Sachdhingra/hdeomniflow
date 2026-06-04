import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Trash2, Upload } from "lucide-react";

interface Banner {
  id: string;
  title: string;
  image_url: string;
  active: boolean;
  sort_order: number;
}

const AdminSchemeBanners = () => {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState("");

  const load = async () => {
    const { data } = await supabase
      .from("scheme_banners")
      .select("*")
      .order("sort_order", { ascending: true });
    setBanners((data as Banner[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const { error: upErr } = await supabase.storage.from("scheme-banners").upload(path, file);
    if (upErr) {
      toast.error(upErr.message);
      setUploading(false);
      return;
    }
    const { data: pub } = supabase.storage.from("scheme-banners").getPublicUrl(path);
    const { error: insErr } = await supabase.from("scheme_banners").insert({
      title: title || file.name,
      image_url: pub.publicUrl,
      active: true,
      sort_order: banners.length,
    });
    setUploading(false);
    e.target.value = "";
    if (insErr) return toast.error(insErr.message);
    setTitle("");
    toast.success("Banner uploaded");
    load();
  };

  const toggle = async (b: Banner) => {
    await supabase.from("scheme_banners").update({ active: !b.active }).eq("id", b.id);
    load();
  };

  const remove = async (b: Banner) => {
    if (!confirm("Delete this banner?")) return;
    await supabase.from("scheme_banners").delete().eq("id", b.id);
    load();
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">Kiosk Scheme Banners</h1>
        <p className="text-sm text-muted-foreground">
          Shown as a full-screen screensaver when the kiosk is idle.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Add new banner</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <Label htmlFor="banner-title">Title (optional)</Label>
            <Input id="banner-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Diwali Sale" />
          </div>
          <div>
            <Label htmlFor="banner-file">Image</Label>
            <Input id="banner-file" type="file" accept="image/*" onChange={onFile} disabled={uploading} />
          </div>
          {uploading && (
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <Loader2 className="w-4 h-4 animate-spin" /> Uploading…
            </span>
          )}
          <p className="text-xs text-muted-foreground w-full flex items-center gap-1">
            <Upload className="w-3 h-3" /> Recommended: landscape, 1920×1080 or larger
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Current banners</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : banners.length === 0 ? (
            <p className="text-sm text-muted-foreground">No banners yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {banners.map((b) => (
                <div key={b.id} className="border rounded-lg overflow-hidden bg-card">
                  <div className="aspect-video bg-muted">
                    <img src={b.image_url} alt={b.title} className="w-full h-full object-cover" />
                  </div>
                  <div className="p-3 space-y-2">
                    <div className="font-medium truncate">{b.title || "Untitled"}</div>
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-sm">
                        <Switch checked={b.active} onCheckedChange={() => toggle(b)} />
                        {b.active ? "Active" : "Hidden"}
                      </label>
                      <Button size="sm" variant="ghost" onClick={() => remove(b)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
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
