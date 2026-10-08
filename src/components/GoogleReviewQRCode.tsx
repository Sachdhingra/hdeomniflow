import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ExternalLink } from "lucide-react";
import QRCode from "qrcode";
import fallbackQr from "@/assets/google-review-qr.jpg";

interface Props {
  url: string;
  size?: number;
  caption?: string;
}

/**
 * QR code for the Google review link. Generated from the live
 * `google_review_url` setting so a change in Admin → Settings takes effect on
 * the kiosk immediately; the printed asset is only a fallback for the case
 * where generation fails.
 */
const GoogleReviewQRCode = ({ url, size = 220, caption }: Props) => {
  const [open, setOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!url) {
      setDataUrl(null);
      return;
    }
    QRCode.toDataURL(url, { width: 640, margin: 1, errorCorrectionLevel: "M" })
      .then((png) => {
        if (!cancelled) setDataUrl(png);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const src = dataUrl ?? fallbackQr;

  return (
    <>
      <div className="flex flex-col items-center gap-3">
        <button
          onClick={() => setOpen(true)}
          className="qr-glow rounded-2xl bg-white p-2 hover:scale-105 transition-transform"
          aria-label="Tap to enlarge the Google review QR code"
        >
          <img
            src={src}
            alt="Scan to leave a Google review"
            width={size}
            height={size}
            style={{ width: size, height: size, objectFit: "contain" }}
            className="rounded-lg"
          />
        </button>
        <p className="text-sm font-semibold text-white drop-shadow text-center max-w-xs">
          {caption ?? "⭐ Scan to leave us a Google review"}
        </p>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
          className="gap-2"
        >
          Open Link <ExternalLink className="w-4 h-4" />
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[90vw] sm:max-w-md p-4 bg-white">
          <div className="flex flex-col items-center gap-3">
            <img
              src={src}
              alt="Scan to leave a Google review"
              className="w-full max-h-[70vh] object-contain"
            />
            <p className="text-center text-sm text-muted-foreground">Tap outside to close</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default GoogleReviewQRCode;
