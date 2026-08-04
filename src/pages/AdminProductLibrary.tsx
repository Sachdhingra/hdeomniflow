import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import StorageImage from "@/components/product-library/StorageImage";
import {
  plDb,
  uploadFile,
  money,
  BUCKET_IMAGES,
  BUCKET_BROCHURES,
  BUCKET_VIDEOS,
  PLCategory,
  PLCollection,
  PLProduct,
  PLVariant,
  PLImage,
  PLBrochure,
  PLVideo,
  PLSpec,
} from "@/lib/productLibrary";

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const emptyProduct = (): Partial<PLProduct> => ({
  sku: "",
  name: "",
  description: "",
  features: [],
  dimensions: "",
  warranty: "",
  mrp: 0,
  offer_price: null,
  gst_percent: 18,
  exchange_eligible: false,
  elite_card_eligible: false,
  is_active: true,
  category_id: null,
  collection_id: null,
});

const AdminProductLibrary = () => {
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<PLCategory[]>([]);
  const [collections, setCollections] = useState<PLCollection[]>([]);
  const [products, setProducts] = useState<PLProduct[]>([]);
  const [editing, setEditing] = useState<Partial<PLProduct> | null>(null);
  const [importData, setImportData] = useState<any | null>(null);
  const [importing, setImporting] = useState(false);

  const load = async () => {
    setLoading(true);
    const [cat, col, prod] = await Promise.all([
      plDb.from("pl_categories").select("*").order("sort_order"),
      plDb.from("pl_collections").select("*").order("sort_order"),
      plDb.from("pl_products").select("*").order("created_at", { ascending: false }),
    ]);
    setCategories(cat.data || []);
    setCollections(col.data || []);
    setProducts(prod.data || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleImportPdf = async (file: File) => {
    if (file.size > 40 * 1024 * 1024) {
      toast.error("PDF is too large (max 40 MB). Please split it into smaller files.");
      return;
    }
    setImporting(true);
    let uploadedPath: string | null = null;
    try {
      // Upload to storage first, then hand the extractor a short-lived signed URL.
      // Avoids sending a huge base64 body through the edge function.
      uploadedPath = await uploadFile(BUCKET_BROCHURES, file, "pdf-imports");
      const { data: signed, error: signErr } = await supabase.storage
        .from(BUCKET_BROCHURES)
        .createSignedUrl(uploadedPath, 900);
      if (signErr || !signed?.signedUrl) throw new Error("Could not prepare the PDF for extraction");

      const { data, error } = await plDb.functions.invoke("extract-product-catalog-pdf", {
        body: {
          pdf_url: signed.signedUrl,
          file_name: file.name,
          mime_type: file.type || "application/pdf",
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      if (!data?.products?.length) throw new Error("No products found in this PDF");
      setImportData(data);
      toast.success(`Extracted ${data.products.length} product(s) — review and save`);
    } catch (e: any) {
      const msg = String(e?.message || "");
      toast.error(
        msg.includes("Failed to send a request") || msg.includes("Failed to fetch")
          ? "Could not reach the extraction service. Please check your connection and try again."
          : msg || "Extraction failed",
      );
    } finally {
      if (uploadedPath) removeFile(BUCKET_BROCHURES, uploadedPath).catch(() => {});
      setImporting(false);
    }
  };


  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Product Library Admin</h1>
        <p className="text-sm text-muted-foreground">
          Manage categories, collections, products, media and specifications.
        </p>
      </div>

      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="collections">Collections</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="pt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setEditing(emptyProduct())}>
              <Plus className="w-4 h-4 mr-1" /> New Product
            </Button>
            <FilePicker
              accept="application/pdf"
              busy={importing}
              label="Import category from PDF"
              onPick={handleImportPdf}
            />
          </div>
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {products.map((p) => (
                <Card key={p.id}>
                  <CardContent className="p-3 flex gap-3">
                    <StorageImage
                      path={p.thumbnail_url || p.hero_image_url}
                      className="w-20 h-20 rounded object-cover shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.sku}</p>
                      <p className="text-sm font-semibold">{money(p.offer_price || p.mrp)}</p>
                      <div className="flex gap-1 mt-1">
                        <Badge variant={p.is_active ? "default" : "secondary"} className="text-xs">
                          {p.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Button size="icon" variant="ghost" onClick={() => setEditing(p)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={async () => {
                          if (!confirm(`Delete ${p.name}?`)) return;
                          await plDb.from("pl_products").delete().eq("id", p.id);
                          toast.success("Product deleted");
                          load();
                        }}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="categories" className="pt-4">
          <TaxonomyManager
            table="pl_categories"
            title="Categories"
            rows={categories}
            reload={load}
          />
        </TabsContent>

        <TabsContent value="collections" className="pt-4">
          <TaxonomyManager
            table="pl_collections"
            title="Collections"
            rows={collections}
            reload={load}
            categories={categories}
          />
        </TabsContent>
      </Tabs>

      {editing && (
        <ProductEditor
          product={editing}
          categories={categories}
          collections={collections}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {importData && (
        <CatalogImportDialog
          data={importData}
          categories={categories}
          existingProducts={products}
          onClose={() => setImportData(null)}
          onImported={() => {
            setImportData(null);
            load();
          }}
        />
      )}
    </div>
  );
};

/* -------------------- taxonomy (categories / collections) -------------------- */

const TaxonomyManager = ({
  table,
  title,
  rows,
  reload,
  categories,
}: {
  table: string;
  title: string;
  rows: any[];
  reload: () => void;
  categories?: PLCategory[];
}) => {
  const [draft, setDraft] = useState<any | null>(null);

  const save = async () => {
    const payload: any = {
      name: draft.name,
      slug: draft.slug || slugify(draft.name || ""),
      description: draft.description || null,
      sort_order: Number(draft.sort_order) || 0,
      is_active: draft.is_active ?? true,
    };
    if (categories) payload.category_id = draft.category_id || null;
    if (!payload.name) return toast.error("Name is required");
    if (categories && !payload.category_id) return toast.error("Pick a category");

    const res = draft.id
      ? await plDb.from(table).update(payload).eq("id", draft.id)
      : await plDb.from(table).insert(payload);
    if (res.error) return toast.error(res.error.message);
    toast.success("Saved");
    setDraft(null);
    reload();
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">{title}</CardTitle>
        <Button size="sm" onClick={() => setDraft({ is_active: true, sort_order: 0 })}>
          <Plus className="w-4 h-4 mr-1" /> Add
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded border p-2">
            <div>
              <p className="font-medium text-sm">{r.name}</p>
              <p className="text-xs text-muted-foreground">
                {r.slug}
                {categories && ` · ${categories.find((c) => c.id === r.category_id)?.name || "—"}`}
              </p>
            </div>
            <div className="flex gap-1">
              <Button size="icon" variant="ghost" onClick={() => setDraft(r)}>
                <Pencil className="w-4 h-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={async () => {
                  if (!confirm(`Delete ${r.name}?`)) return;
                  const { error } = await plDb.from(table).delete().eq("id", r.id);
                  if (error) return toast.error(error.message);
                  reload();
                }}
              >
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-muted-foreground">Nothing here yet.</p>}
      </CardContent>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit" : "New"} {title.slice(0, -1)}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              {categories && (
                <div>
                  <Label>Category</Label>
                  <Select
                    value={draft.category_id || ""}
                    onValueChange={(v) => setDraft({ ...draft, category_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label>Name</Label>
                <Input
                  value={draft.name || ""}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  value={draft.description || ""}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Active</Label>
                <Switch
                  checked={draft.is_active ?? true}
                  onCheckedChange={(v) => setDraft({ ...draft, is_active: v })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

/* -------------------- product editor -------------------- */

const ProductEditor = ({
  product,
  categories,
  collections,
  onClose,
  onSaved,
}: {
  product: Partial<PLProduct>;
  categories: PLCategory[];
  collections: PLCollection[];
  onClose: () => void;
  onSaved: () => void;
}) => {
  const [form, setForm] = useState<Partial<PLProduct>>(product);
  const [saving, setSaving] = useState(false);
  const [images, setImages] = useState<PLImage[]>([]);
  const [variants, setVariants] = useState<PLVariant[]>([]);
  const [brochures, setBrochures] = useState<PLBrochure[]>([]);
  const [videos, setVideos] = useState<PLVideo[]>([]);
  const [specs, setSpecs] = useState<PLSpec[]>([]);
  const [busy, setBusy] = useState(false);

  const productId = form.id;

  const loadChildren = async () => {
    if (!productId) return;
    const [img, vr, br, vd, sp] = await Promise.all([
      plDb.from("pl_product_images").select("*").eq("product_id", productId).order("sort_order"),
      plDb.from("pl_product_variants").select("*").eq("product_id", productId).order("sort_order"),
      plDb.from("pl_product_brochures").select("*").eq("product_id", productId).order("sort_order"),
      plDb.from("pl_product_videos").select("*").eq("product_id", productId).order("sort_order"),
      plDb
        .from("pl_product_specifications")
        .select("*")
        .eq("product_id", productId)
        .order("sort_order"),
    ]);
    setImages(img.data || []);
    setVariants(vr.data || []);
    setBrochures(br.data || []);
    setVideos(vd.data || []);
    setSpecs(sp.data || []);
  };

  useEffect(() => {
    loadChildren();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const saveProduct = async () => {
    if (!form.sku || !form.name) return toast.error("SKU and name are required");
    setSaving(true);
    const payload = {
      sku: form.sku,
      name: form.name,
      description: form.description || null,
      features: form.features || [],
      dimensions: form.dimensions || null,
      warranty: form.warranty || null,
      mrp: Number(form.mrp) || 0,
      offer_price: form.offer_price ? Number(form.offer_price) : null,
      gst_percent: Number(form.gst_percent) || 0,
      exchange_eligible: !!form.exchange_eligible,
      elite_card_eligible: !!form.elite_card_eligible,
      is_active: form.is_active ?? true,
      category_id: form.category_id || null,
      collection_id: form.collection_id || null,
      hero_image_url: form.hero_image_url || null,
      thumbnail_url: form.thumbnail_url || null,
    };
    const res = form.id
      ? await plDb.from("pl_products").update(payload).eq("id", form.id).select("*").single()
      : await plDb.from("pl_products").insert(payload).select("*").single();
    setSaving(false);
    if (res.error) return toast.error(res.error.message);
    setForm(res.data);
    toast.success("Product saved");
    if (!form.id) return; // keep editor open so media can be attached
    onSaved();
  };

  const requireSaved = () => {
    if (!productId) {
      toast.error("Save the product first, then add media");
      return false;
    }
    return true;
  };

  const handleUpload = async (
    file: File,
    bucket: string,
    onDone: (path: string) => Promise<void>,
  ) => {
    setBusy(true);
    try {
      const path = await uploadFile(bucket, file, productId || "misc");
      await onDone(path);
      toast.success("Uploaded");
    } catch (e: any) {
      toast.error(e.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form.id ? "Edit Product" : "New Product"}</DialogTitle>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <Label>SKU</Label>
            <Input value={form.sku || ""} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          </div>
          <div>
            <Label>Product Name</Label>
            <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label>Category</Label>
            <Select
              value={form.category_id || ""}
              onValueChange={(v) => setForm({ ...form, category_id: v, collection_id: null })}
            >
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Collection</Label>
            <Select
              value={form.collection_id || ""}
              onValueChange={(v) => setForm({ ...form, collection_id: v })}
            >
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {collections
                  .filter((c) => !form.category_id || c.category_id === form.category_id)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label>Description</Label>
            <Textarea
              rows={3}
              value={form.description || ""}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <Label>Features (one per line)</Label>
            <Textarea
              rows={3}
              value={(form.features || []).join("\n")}
              onChange={(e) =>
                setForm({ ...form, features: e.target.value.split("\n").filter(Boolean) })
              }
            />
          </div>
          <div>
            <Label>Dimensions</Label>
            <Input
              value={form.dimensions || ""}
              onChange={(e) => setForm({ ...form, dimensions: e.target.value })}
            />
          </div>
          <div>
            <Label>Warranty</Label>
            <Input
              value={form.warranty || ""}
              onChange={(e) => setForm({ ...form, warranty: e.target.value })}
            />
          </div>
          <div>
            <Label>MRP</Label>
            <Input
              type="number"
              value={form.mrp ?? 0}
              onChange={(e) => setForm({ ...form, mrp: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label>Offer Price</Label>
            <Input
              type="number"
              value={form.offer_price ?? ""}
              onChange={(e) =>
                setForm({ ...form, offer_price: e.target.value ? Number(e.target.value) : null })
              }
            />
          </div>
          <div>
            <Label>GST %</Label>
            <Input
              type="number"
              value={form.gst_percent ?? 18}
              onChange={(e) => setForm({ ...form, gst_percent: Number(e.target.value) })}
            />
          </div>
          <div className="flex flex-col gap-2 justify-end">
            <div className="flex items-center justify-between">
              <Label>Exchange eligible</Label>
              <Switch
                checked={!!form.exchange_eligible}
                onCheckedChange={(v) => setForm({ ...form, exchange_eligible: v })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>Elite card eligible</Label>
              <Switch
                checked={!!form.elite_card_eligible}
                onCheckedChange={(v) => setForm({ ...form, elite_card_eligible: v })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch
                checked={form.is_active ?? true}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={saveProduct} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Save product
          </Button>
        </div>

        {/* Media & details */}
        <Tabs defaultValue="media" className="pt-2">
          <TabsList className="flex-wrap">
            <TabsTrigger value="media">Images</TabsTrigger>
            <TabsTrigger value="files">Brochure / Video</TabsTrigger>
            <TabsTrigger value="variants">Variants</TabsTrigger>
            <TabsTrigger value="specs">Specifications</TabsTrigger>
          </TabsList>

          <TabsContent value="media" className="pt-3 space-y-3">
            <div className="flex flex-wrap gap-3 items-start">
              <MediaSlot
                label="Hero Image"
                path={form.hero_image_url}
                onPick={(f) =>
                  requireSaved() &&
                  handleUpload(f, BUCKET_IMAGES, async (path) => {
                    await plDb.from("pl_products").update({ hero_image_url: path }).eq("id", productId);
                    setForm((s) => ({ ...s, hero_image_url: path }));
                  })
                }
                busy={busy}
              />
              <MediaSlot
                label="Thumbnail"
                path={form.thumbnail_url}
                onPick={(f) =>
                  requireSaved() &&
                  handleUpload(f, BUCKET_IMAGES, async (path) => {
                    await plDb.from("pl_products").update({ thumbnail_url: path }).eq("id", productId);
                    setForm((s) => ({ ...s, thumbnail_url: path }));
                  })
                }
                busy={busy}
              />
            </div>

            <div>
              <Label>Gallery</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {images.map((img) => (
                  <div key={img.id} className="relative">
                    <StorageImage path={img.image_url} className="w-24 h-24 object-cover rounded border" />
                    <Button
                      size="icon"
                      variant="destructive"
                      className="absolute -top-2 -right-2 h-6 w-6"
                      onClick={async () => {
                        await plDb.from("pl_product_images").delete().eq("id", img.id);
                        loadChildren();
                      }}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
                <FilePicker
                  accept="image/*"
                  busy={busy}
                  onPick={(f) =>
                    requireSaved() &&
                    handleUpload(f, BUCKET_IMAGES, async (path) => {
                      await plDb.from("pl_product_images").insert({
                        product_id: productId,
                        image_url: path,
                        image_type: "gallery",
                        sort_order: images.length,
                      });
                      loadChildren();
                    })
                  }
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="files" className="pt-3 space-y-4">
            <div>
              <Label>Brochures (PDF)</Label>
              <div className="space-y-2 mt-2">
                {brochures.map((b) => (
                  <div key={b.id} className="flex items-center justify-between rounded border p-2 text-sm">
                    <span>{b.title}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={async () => {
                        await plDb.from("pl_product_brochures").delete().eq("id", b.id);
                        loadChildren();
                      }}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                ))}
                <FilePicker
                  accept="application/pdf"
                  busy={busy}
                  label="Upload PDF"
                  onPick={(f) =>
                    requireSaved() &&
                    handleUpload(f, BUCKET_BROCHURES, async (path) => {
                      await plDb.from("pl_product_brochures").insert({
                        product_id: productId,
                        title: f.name,
                        file_url: path,
                        file_size: f.size,
                        sort_order: brochures.length,
                      });
                      loadChildren();
                    })
                  }
                />
              </div>
            </div>

            <div>
              <Label>Videos (optional)</Label>
              <div className="space-y-2 mt-2">
                {videos.map((v) => (
                  <div key={v.id} className="flex items-center justify-between rounded border p-2 text-sm">
                    <span>{v.title || "Video"}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={async () => {
                        await plDb.from("pl_product_videos").delete().eq("id", v.id);
                        loadChildren();
                      }}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                ))}
                <FilePicker
                  accept="video/*"
                  busy={busy}
                  label="Upload video"
                  onPick={(f) =>
                    requireSaved() &&
                    handleUpload(f, BUCKET_VIDEOS, async (path) => {
                      await plDb.from("pl_product_videos").insert({
                        product_id: productId,
                        title: f.name,
                        video_url: path,
                        sort_order: videos.length,
                      });
                      loadChildren();
                    })
                  }
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="variants" className="pt-3">
            <ChildRows
              rows={variants}
              onDelete={async (id) => {
                await plDb.from("pl_product_variants").delete().eq("id", id);
                loadChildren();
              }}
              render={(v: PLVariant) => (
                <span>
                  {[v.colour, v.size, v.finish].filter(Boolean).join(" · ") || v.variant_sku}
                  {v.offer_price ? ` — ${money(v.offer_price)}` : ""}
                </span>
              )}
              fields={[
                { key: "colour", label: "Colour" },
                { key: "colour_hex", label: "Colour hex (#000000)" },
                { key: "size", label: "Size" },
                { key: "finish", label: "Finish" },
                { key: "variant_sku", label: "Variant SKU" },
                { key: "mrp", label: "MRP", type: "number" },
                { key: "offer_price", label: "Offer price", type: "number" },
              ]}
              onAdd={async (values) => {
                if (!requireSaved()) return;
                const { error } = await plDb.from("pl_product_variants").insert({
                  product_id: productId,
                  ...values,
                  mrp: values.mrp ? Number(values.mrp) : null,
                  offer_price: values.offer_price ? Number(values.offer_price) : null,
                  sort_order: variants.length,
                });
                if (error) return toast.error(error.message);
                loadChildren();
              }}
            />
          </TabsContent>

          <TabsContent value="specs" className="pt-3">
            <ChildRows
              rows={specs}
              onDelete={async (id) => {
                await plDb.from("pl_product_specifications").delete().eq("id", id);
                loadChildren();
              }}
              render={(s: PLSpec) => (
                <span>
                  <b>{s.label}:</b> {s.value}
                </span>
              )}
              fields={[
                { key: "spec_group", label: "Group (optional)" },
                { key: "label", label: "Label" },
                { key: "value", label: "Value" },
              ]}
              onAdd={async (values) => {
                if (!requireSaved()) return;
                if (!values.label || !values.value) return toast.error("Label and value required");
                const { error } = await plDb.from("pl_product_specifications").insert({
                  product_id: productId,
                  ...values,
                  sort_order: specs.length,
                });
                if (error) return toast.error(error.message);
                loadChildren();
              }}
            />
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* -------------------- PDF catalog import -------------------- */

const CatalogImportDialog = ({
  data,
  categories,
  existingProducts,
  onClose,
  onImported,
}: {
  data: any;
  categories: PLCategory[];
  existingProducts: PLProduct[];
  onClose: () => void;
  onImported: () => void;
}) => {
  const matchedCategory = categories.find(
    (c) =>
      c.slug === slugify(data.category_name || "") ||
      c.name.toLowerCase() === (data.category_name || "").toLowerCase(),
  );
  const [categoryChoice, setCategoryChoice] = useState<string>(
    matchedCategory ? matchedCategory.id : "__new__",
  );
  const [categoryName, setCategoryName] = useState(data.category_name || "");
  const [categoryDescription, setCategoryDescription] = useState(data.category_description || "");
  const [rows, setRows] = useState<any[]>(() => {
    const usedSkus = new Set(existingProducts.map((p) => p.sku.toUpperCase()));
    return (data.products || []).map((p: any) => {
      let sku = (p.sku || "").trim().toUpperCase() || slugify(p.name || "product").toUpperCase().replace(/-/g, "");
      let unique = sku;
      let i = 1;
      while (usedSkus.has(unique)) unique = `${sku}-${i++}`;
      usedSkus.add(unique);
      return { ...p, sku: unique, include: true };
    });
  });
  const [saving, setSaving] = useState(false);

  const updateRow = (idx: number, patch: any) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const includedCount = rows.filter((r) => r.include).length;

  const save = async () => {
    const included = rows.filter((r) => r.include);
    if (!included.length) return toast.error("Select at least one product");
    if (included.some((r) => !r.sku?.trim() || !r.name?.trim()))
      return toast.error("Every selected product needs a SKU and name");
    if (categoryChoice === "__new__" && !categoryName.trim())
      return toast.error("Category name is required");

    setSaving(true);
    try {
      let categoryId = categoryChoice;
      if (categoryChoice === "__new__") {
        const { data: cat, error: catErr } = await plDb
          .from("pl_categories")
          .insert({
            name: categoryName.trim(),
            slug: slugify(categoryName),
            description: categoryDescription || null,
          })
          .select("id")
          .single();
        if (catErr) throw catErr;
        categoryId = cat.id;
      }

      for (const p of included) {
        const { data: prod, error: prodErr } = await plDb
          .from("pl_products")
          .insert({
            sku: p.sku.trim(),
            category_id: categoryId,
            name: p.name.trim(),
            description: p.description || null,
            features: p.features || [],
            dimensions: p.dimensions || null,
            warranty: p.warranty || null,
            mrp: Number(p.mrp) || 0,
            offer_price: p.offer_price ? Number(p.offer_price) : null,
            gst_percent: p.gst_percent != null ? Number(p.gst_percent) : 18,
          })
          .select("id")
          .single();
        if (prodErr) throw prodErr;

        const specRows = (p.specifications || [])
          .filter((s: any) => s.label && s.value)
          .map((s: any, i: number) => ({
            product_id: prod.id,
            spec_group: s.spec_group || null,
            label: s.label,
            value: s.value,
            sort_order: i,
          }));
        if (specRows.length) {
          const { error } = await plDb.from("pl_product_specifications").insert(specRows);
          if (error) throw error;
        }

        const variantRows = (p.variants || []).map((v: any, i: number) => ({
          product_id: prod.id,
          colour: v.colour || null,
          size: v.size || null,
          finish: v.finish || null,
          mrp: v.mrp ? Number(v.mrp) : null,
          offer_price: v.offer_price ? Number(v.offer_price) : null,
          sort_order: i,
        }));
        if (variantRows.length) {
          const { error } = await plDb.from("pl_product_variants").insert(variantRows);
          if (error) throw error;
        }
      }

      toast.success(`Created ${included.length} product(s)`);
      onImported();
    } catch (e: any) {
      toast.error(e.message || "Import failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import from PDF — review before saving</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Category</Label>
            <Select value={categoryChoice} onValueChange={setCategoryChoice}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__new__">+ Create new category</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {categoryChoice === "__new__" && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label>New category name</Label>
                <Input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} />
              </div>
              <div>
                <Label>Category description</Label>
                <Input
                  value={categoryDescription}
                  onChange={(e) => setCategoryDescription(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>
              {includedCount} of {rows.length} product(s) selected
            </Label>
            <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
              {rows.map((p, idx) => (
                <div key={idx} className="rounded border p-3 space-y-2">
                  <div className="flex items-start gap-3">
                    <Switch
                      checked={p.include}
                      onCheckedChange={(v) => updateRow(idx, { include: v })}
                      className="mt-2"
                    />
                    <div className="flex-1 grid sm:grid-cols-2 gap-2">
                      <Input
                        placeholder="SKU"
                        value={p.sku || ""}
                        onChange={(e) => updateRow(idx, { sku: e.target.value.toUpperCase() })}
                      />
                      <Input
                        placeholder="Name"
                        value={p.name || ""}
                        onChange={(e) => updateRow(idx, { name: e.target.value })}
                      />
                      <Input
                        type="number"
                        placeholder="MRP"
                        value={p.mrp ?? ""}
                        onChange={(e) =>
                          updateRow(idx, { mrp: e.target.value ? Number(e.target.value) : null })
                        }
                      />
                      <Input
                        type="number"
                        placeholder="Offer price"
                        value={p.offer_price ?? ""}
                        onChange={(e) =>
                          updateRow(idx, {
                            offer_price: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground pl-10">
                    {p.dimensions ? `${p.dimensions} · ` : ""}
                    {(p.specifications?.length || 0)} spec(s) · {(p.variants?.length || 0)} variant(s)
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !includedCount}>
            {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Create category & {includedCount} product(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const FilePicker = ({
  accept,
  onPick,
  busy,
  label = "Add",
}: {
  accept: string;
  onPick: (file: File) => void;
  busy: boolean;
  label?: string;
}) => (
  <label className="inline-flex items-center gap-2 cursor-pointer rounded border border-dashed px-3 py-2 text-sm hover:bg-muted">
    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
    {label}
    <input
      type="file"
      accept={accept}
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onPick(f);
        e.target.value = "";
      }}
    />
  </label>
);

const MediaSlot = ({
  label,
  path,
  onPick,
  busy,
}: {
  label: string;
  path?: string | null;
  onPick: (f: File) => void;
  busy: boolean;
}) => (
  <div className="space-y-1">
    <Label>{label}</Label>
    <StorageImage path={path} className="w-28 h-28 object-cover rounded border" />
    <FilePicker accept="image/*" onPick={onPick} busy={busy} label="Upload" />
  </div>
);

const ChildRows = ({
  rows,
  fields,
  onAdd,
  onDelete,
  render,
}: {
  rows: any[];
  fields: { key: string; label: string; type?: string }[];
  onAdd: (values: any) => void;
  onDelete: (id: string) => void;
  render: (row: any) => React.ReactNode;
}) => {
  const [values, setValues] = useState<any>({});
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded border p-2 text-sm">
            {render(r)}
            <Button size="icon" variant="ghost" onClick={() => onDelete(r.id)}>
              <Trash2 className="w-4 h-4 text-destructive" />
            </Button>
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
      </div>
      <div className="grid sm:grid-cols-3 gap-2">
        {fields.map((f) => (
          <Input
            key={f.key}
            type={f.type || "text"}
            placeholder={f.label}
            value={values[f.key] || ""}
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
          />
        ))}
      </div>
      <Button
        size="sm"
        onClick={() => {
          onAdd(values);
          setValues({});
        }}
      >
        <Plus className="w-4 h-4 mr-1" /> Add
      </Button>
    </div>
  );
};

export default AdminProductLibrary;
