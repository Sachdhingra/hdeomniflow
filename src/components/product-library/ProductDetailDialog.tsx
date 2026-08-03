import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShoppingCart, FileDown, Share2, Check } from "lucide-react";
import { toast } from "sonner";
import StorageImage from "./StorageImage";
import {
  plDb,
  money,
  effectivePrice,
  resolveUrl,
  BUCKET_BROCHURES,
  BUCKET_VIDEOS,
  PLProduct,
  PLVariant,
  PLImage,
  PLBrochure,
  PLVideo,
  PLSpec,
} from "@/lib/productLibrary";
import { useQuote } from "@/contexts/QuoteContext";

interface Props {
  product: PLProduct | null;
  onClose: () => void;
}

const ProductDetailDialog = ({ product, onClose }: Props) => {
  const { addItem, setOpen } = useQuote();
  const [images, setImages] = useState<PLImage[]>([]);
  const [variants, setVariants] = useState<PLVariant[]>([]);
  const [brochures, setBrochures] = useState<PLBrochure[]>([]);
  const [videos, setVideos] = useState<PLVideo[]>([]);
  const [specs, setSpecs] = useState<PLSpec[]>([]);
  const [activeImage, setActiveImage] = useState<string | null>(null);
  const [activeVariant, setActiveVariant] = useState<PLVariant | null>(null);

  useEffect(() => {
    if (!product) return;
    setActiveImage(product.hero_image_url);
    setActiveVariant(null);
    (async () => {
      const [img, vr, br, vd, sp] = await Promise.all([
        plDb.from("pl_product_images").select("*").eq("product_id", product.id).order("sort_order"),
        plDb.from("pl_product_variants").select("*").eq("product_id", product.id).order("sort_order"),
        plDb.from("pl_product_brochures").select("*").eq("product_id", product.id).order("sort_order"),
        plDb.from("pl_product_videos").select("*").eq("product_id", product.id).order("sort_order"),
        plDb
          .from("pl_product_specifications")
          .select("*")
          .eq("product_id", product.id)
          .order("sort_order"),
      ]);
      setImages(img.data || []);
      setVariants(vr.data || []);
      setBrochures(br.data || []);
      setVideos(vd.data || []);
      setSpecs(sp.data || []);
    })();
  }, [product]);

  if (!product) return null;

  const price = activeVariant
    ? effectivePrice({
        mrp: activeVariant.mrp ?? product.mrp,
        offer_price: activeVariant.offer_price ?? product.offer_price,
      })
    : effectivePrice(product);
  const mrp = activeVariant?.mrp ?? product.mrp;

  const gallery = [
    ...(product.hero_image_url ? [{ id: "hero", image_url: product.hero_image_url }] : []),
    ...images.filter((i) => i.image_type !== "thumbnail"),
  ];

  const handleAddToQuote = () => {
    addItem({
      product_id: product.id,
      variant_id: activeVariant?.id ?? null,
      image_url: activeVariant?.image_url || product.hero_image_url || product.thumbnail_url,
      product_name: activeVariant?.colour
        ? `${product.name} — ${activeVariant.colour}`
        : product.name,
      sku: activeVariant?.variant_sku || product.sku,
      description: product.description,
      quantity: 1,
      unit_price: price,
      gst_percent: Number(product.gst_percent || 0),
    });
    toast.success("Added to quote");
    setOpen(true);
  };

  const openBrochure = async () => {
    const b = brochures[0];
    if (!b) return toast.error("No brochure uploaded");
    const url = await resolveUrl(BUCKET_BROCHURES, b.file_url);
    if (url) window.open(url, "_blank");
  };

  const shareProduct = async () => {
    const text = `${product.name} (${product.sku})\n${money(price)}\n${product.description || ""}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: product.name, text });
        return;
      } catch {
        /* cancelled */
      }
    }
    await navigator.clipboard.writeText(text);
    toast.success("Product details copied");
  };

  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-8">{product.name}</DialogTitle>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Media */}
          <div className="space-y-3">
            <StorageImage
              path={activeImage}
              alt={product.name}
              className="w-full aspect-square object-cover rounded-xl border"
            />
            <div className="flex gap-2 overflow-x-auto pb-1">
              {gallery.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setActiveImage(g.image_url)}
                  className={`shrink-0 rounded-lg border-2 ${
                    activeImage === g.image_url ? "border-primary" : "border-transparent"
                  }`}
                >
                  <StorageImage path={g.image_url} className="w-16 h-16 object-cover rounded-md" />
                </button>
              ))}
            </div>
            {videos.length > 0 && (
              <VideoPlayer path={videos[0].video_url} title={videos[0].title} />
            )}
          </div>

          {/* Info */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{product.sku}</Badge>
              {product.elite_card_eligible && <Badge className="bg-amber-500">Elite Card</Badge>}
              {product.exchange_eligible && <Badge variant="secondary">Exchange</Badge>}
              {!product.is_active && <Badge variant="destructive">Inactive</Badge>}
            </div>

            <div className="flex items-end gap-3">
              <span className="text-3xl font-bold">{money(price)}</span>
              {mrp > price && (
                <span className="text-lg line-through text-muted-foreground">{money(mrp)}</span>
              )}
              <span className="text-xs text-muted-foreground">+{product.gst_percent}% GST</span>
            </div>

            {product.description && (
              <p className="text-sm text-muted-foreground whitespace-pre-line">
                {product.description}
              </p>
            )}

            {variants.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Available colours / variants</p>
                <div className="flex flex-wrap gap-2">
                  {variants.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => {
                        setActiveVariant(activeVariant?.id === v.id ? null : v);
                        if (v.image_url) setActiveImage(v.image_url);
                      }}
                      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
                        activeVariant?.id === v.id ? "border-primary bg-primary/10" : ""
                      }`}
                    >
                      {v.colour_hex && (
                        <span
                          className="w-3.5 h-3.5 rounded-full border"
                          style={{ backgroundColor: v.colour_hex }}
                        />
                      )}
                      {[v.colour, v.size, v.finish].filter(Boolean).join(" · ") || v.variant_sku}
                      {activeVariant?.id === v.id && <Check className="w-3 h-3" />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button className="flex-1 min-w-[160px]" onClick={handleAddToQuote}>
                <ShoppingCart className="w-4 h-4 mr-1" /> Add to Quote
              </Button>
              <Button variant="outline" onClick={openBrochure}>
                <FileDown className="w-4 h-4 mr-1" /> Brochure
              </Button>
              <Button variant="outline" onClick={shareProduct}>
                <Share2 className="w-4 h-4 mr-1" /> Share
              </Button>
            </div>

            <Separator />

            <Tabs defaultValue="features">
              <TabsList className="w-full">
                <TabsTrigger value="features" className="flex-1">
                  Features
                </TabsTrigger>
                <TabsTrigger value="dimensions" className="flex-1">
                  Dimensions
                </TabsTrigger>
                <TabsTrigger value="specs" className="flex-1">
                  Specifications
                </TabsTrigger>
              </TabsList>
              <TabsContent value="features" className="pt-3">
                {product.features?.length ? (
                  <ul className="list-disc pl-5 text-sm space-y-1">
                    {product.features.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No features listed.</p>
                )}
              </TabsContent>
              <TabsContent value="dimensions" className="pt-3 text-sm space-y-2">
                <p>{product.dimensions || "Not specified"}</p>
                {product.warranty && (
                  <p className="text-muted-foreground">Warranty: {product.warranty}</p>
                )}
              </TabsContent>
              <TabsContent value="specs" className="pt-3">
                {specs.length ? (
                  <div className="divide-y text-sm">
                    {specs.map((s) => (
                      <div key={s.id} className="flex justify-between gap-4 py-1.5">
                        <span className="text-muted-foreground">{s.label}</span>
                        <span className="text-right font-medium">{s.value}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No specifications added.</p>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const VideoPlayer = ({ path, title }: { path: string; title: string | null }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    resolveUrl(BUCKET_VIDEOS, path).then(setUrl);
  }, [path]);
  if (!url) return null;
  return (
    <video src={url} controls className="w-full rounded-xl border" aria-label={title || "Product video"} />
  );
};

export default ProductDetailDialog;
