import { useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Globe, ImagePlus, Link2, Loader2, Trash2 } from "lucide-react";
import { useQuote, type QuoteLine } from "@/contexts/QuoteContext";
import { findWebsiteImage } from "@/lib/websiteCatalog";
import { lookupInventoryPhoto } from "@/lib/inventoryPhotos";
import { toast } from "@/lib/toast";
import StorageImage from "./StorageImage";

const MAX_SIDE = 600;

/** Downscale a picked photo to a small JPEG data URL so it fits in the quote (and its Excel). */
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Could not read image"));
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(src);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(src);
      reject(new Error("Not a supported image"));
    };
    img.src = src;
  });
}

/**
 * Quote line photo: the website photo is used automatically when the website lists the
 * product; otherwise (or to override it) staff upload a photo or paste an image link.
 */
const QuoteLineImage = ({ line }: { line: QuoteLine }) => {
  const { updateItem } = useQuote();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const setManual = (image_url: string | null) => {
    // Also "manual" when removed, so the automatic lookup doesn't put a photo back.
    updateItem(line.id, { image_url, image_source: "manual" });
    setOpen(false);
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      setManual(await compressImage(file));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not use that photo");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const applyLink = () => {
    const url = link.trim();
    if (!/^https:\/\//i.test(url)) {
      toast.error("Paste an https:// image link");
      return;
    }
    setManual(url);
    setLink("");
  };

  const applyWebsitePhoto = async () => {
    setBusy(true);
    try {
      const r = await findWebsiteImage({ codes: [line.sku], name: line.product_name });
      if (r.status === "found") {
        updateItem(line.id, { image_url: r.url, image_source: "website" });
      } else {
        const inventory = await lookupInventoryPhoto([line.sku]);
        if (!inventory) {
          toast.error(
            r.status === "unavailable"
              ? "Couldn't reach the website, and there's no inventory photo. Upload a photo instead."
              : "No website or inventory photo for this product. Upload a photo instead.",
          );
          return;
        }
        updateItem(line.id, { image_url: inventory, image_source: "inventory" });
        toast.success(
          r.status === "unavailable" ? "Website unreachable: using the inventory photo" : "Not on the website: using the inventory photo",
        );
      }
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const label =
    line.image_source === "website"
      ? "Website"
      : line.image_source === "inventory"
        ? "Inventory"
        : line.image_source === "manual"
          ? "Manual"
          : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative w-16 h-16 shrink-0 rounded overflow-hidden border"
          title="Change reference image"
        >
          <StorageImage path={line.image_url} alt={line.product_name} className="w-16 h-16 object-cover" />
          {label && (
            <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[9px] leading-4 text-center">
              {label}
            </span>
          )}
          {!line.image_url && (
            <span className="absolute bottom-0 inset-x-0 bg-primary text-primary-foreground text-[9px] leading-4 text-center">
              Add photo
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2" align="start">
        <p className="text-xs text-muted-foreground">
          Reference image for the quote. Picked automatically: the website photo first, then the
          inventory photo. Upload or paste a link to use your own.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ImagePlus className="w-4 h-4 mr-2" />}
          Upload photo
        </Button>
        <div className="flex gap-1">
          <Input
            placeholder="https://… image link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyLink()}
            className="h-8 text-xs"
          />
          <Button size="sm" variant="outline" className="h-8" onClick={applyLink} disabled={!link.trim()}>
            <Link2 className="w-4 h-4" />
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          disabled={busy}
          onClick={applyWebsitePhoto}
        >
          <Globe className="w-4 h-4 mr-2" /> Use website / inventory photo
        </Button>
        {line.image_url && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-destructive"
            onClick={() => setManual(null)}
          >
            <Trash2 className="w-4 h-4 mr-2" /> Remove photo
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default QuoteLineImage;
