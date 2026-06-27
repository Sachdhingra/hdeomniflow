import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Trash2, Pencil, Plus, Upload, X } from "lucide-react";
import { formatDate } from "@/lib/dateFormat";

interface Banner {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
  sort_order: number;
  active: boolean;
  start_date: string | null;
  end_date: string | null;
}

const empty = {
  id: "",
  title: "",
  image_url: "",
  link_url: "",
  sort_order: 0,
  active: true,
  start_date: "",
  end_date: "",
};

const AdminLoginBanners = () => {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<typeof empty | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("login_banners")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setBanners((data as Banner[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editing) return;
    setUploading(true);
    const path = `login/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const { error: upErr } = await supabase.storage.from("scheme-banners").upload(path, file, {
      cacheControl: "31536000",
      upsert: false,
    });
    setUploading(false);
    e.target.value = "";
    if (upErr) return toast.error(upErr.message);
    const { data: pub } = supabase.storage.from("scheme-banners").getPublicUrl(path);
    setEditing({ ...editing, image_url: pub.publicUrl });
    toast.success("Image uploaded");
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.image_url) return toast.error("Please upload an image");
    setSaving(true);
    const payload = {
      title: editing.title,
      image_url: editing.image_url,
      link_url: editing.link_url || null,
      sort_order: Number(editing.sort_order) || 0,
      active: editing.active,
      start_date: editing.start_date ? new Date(editing.start_date).toISOString() : null,
      end_date: editing.end_date ? new Date(editing.end_date).toISOString() : null,
    };
    const { error } = editing.id
      ? await supabase.from("login_banners").update(payload).eq("id", editing.id)
      : await supabase.from("login_banners").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editing.id ? "Banner updated" : "Banner created");
    setEditing(null);
    load();
  };

  const toggle = async (b: Banner) => {
    const { error } = await supabase
      .from("login_banners")
      .update({ active: !b.active })
      .eq("id", b.id);
    if (error) return toast.error(error.message);
    load();
  };

  const remove = async (b: Banner) => {
    if (!confirm("Delete this banner?")) return;
    const { error } = await supabase.from("login_banners").delete().eq("id", b.id);
    if (error) return toast.error(error.message);
    load();
  };

  const edit = (b: Banner) =>
    setEditing({
      id: b.id,
      title: b.title ?? "",
      image_url: b.image_url,
      link_url: b.link_url ?? "",
      sort_order: b.sort_order,
      active: b.active,
      start_date: b.start_date ? b.start_date.slice(0, 16) : "",
      end_date: b.end_date ? b.end_date.slice(0, 16) : "",
    });

  const status = (b: Banner) => {
    if (!b.active) return { label: "Hidden", cls: "bg-muted text-muted-foreground" };
    const now = Date.now();
    if (b.start_date && new Date(b.start_date).getTime() > now)
      return { label: "Scheduled", cls: "bg-yellow-500/10 text-yellow-600" };
    if (b.end_date && new Date(b.end_date).getTime() < now)
      return { label: "Expired", cls: "bg-destructive/10 text-destructive" };
    return { label: "Live", cls: "bg-emerald-500/10 text-emerald-600" };
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Login Screen Banners</h1>
          <p className="text-sm text-muted-foreground">
            Promotional banners shown above the OmniFlow login form. Rotate every 5s.
          </p>
        </div>
        <Button onClick={() => setEditing({ ...empty })}>
          <Plus className="w-4 h-4" /> New banner
        </Button>
      </div>

      {editing && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{editing.id ? "Edit banner" : "New banner"}</CardTitle>
            <Button variant="ghost" size="icon" onClick={() => setEditing(null)}>
              <X className="w-4 h-4" />
            </Button>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label>Image</Label>
              {editing.image_url && (
                <div className="my-2 aspect-[21/6] w-full max-h-[200px] overflow-hidden rounded-md bg-muted">
                  <img src={editing.image_url} alt="" className="w-full h-full object-cover" />
                </div>
              )}
              <Input type="file" accept="image/*" onChange={onFile} disabled={uploading} />
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <Upload className="w-3 h-3" /> Recommended 1600×500 (3:1). JPG/PNG/WEBP.
              </p>
            </div>
            <div>
              <Label>Title</Label>
              <Input
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                placeholder="Diwali Campaign"
              />
            </div>
            <div>
              <Label>Click-through link (optional)</Label>
              <Input
                value={editing.link_url}
                onChange={(e) => setEditing({ ...editing, link_url: e.target.value })}
                placeholder="https://…"
              />
            </div>
            <div>
              <Label>Start date (optional)</Label>
              <Input
                type="datetime-local"
                value={editing.start_date}
                onChange={(e) => setEditing({ ...editing, start_date: e.target.value })}
              />
            </div>
            <div>
              <Label>End date (optional)</Label>
              <Input
                type="datetime-local"
                value={editing.end_date}
                onChange={(e) => setEditing({ ...editing, end_date: e.target.value })}
              />
            </div>
            <div>
              <Label>Sort order</Label>
              <Input
                type="number"
                value={editing.sort_order}
                onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })}
              />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch
                checked={editing.active}
                onCheckedChange={(v) => setEditing({ ...editing, active: v })}
              />
              <span className="text-sm">{editing.active ? "Active" : "Hidden"}</span>
            </div>
            <div className="md:col-span-2 flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving || uploading}>
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Banners</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : banners.length === 0 ? (
            <p className="text-sm text-muted-foreground">No banners yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {banners.map((b) => {
                const s = status(b);
                return (
                  <div key={b.id} className="border rounded-lg overflow-hidden bg-card">
                    <div className="aspect-[21/6] bg-muted">
                      <img src={b.image_url} alt={b.title} className="w-full h-full object-cover" />
                    </div>
                    <div className="p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium truncate">{b.title || "Untitled"}</div>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${s.cls}`}>
                          {s.label}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(b.start_date)} → {formatDate(b.end_date)}
                      </div>
                      {b.link_url && (
                        <div className="text-xs truncate text-primary">{b.link_url}</div>
                      )}
                      <div className="flex items-center justify-between pt-1">
                        <label className="flex items-center gap-2 text-sm">
                          <Switch checked={b.active} onCheckedChange={() => toggle(b)} />
                          {b.active ? "Active" : "Hidden"}
                        </label>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => edit(b)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => remove(b)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminLoginBanners;
