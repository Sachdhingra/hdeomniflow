import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ExternalLink } from "lucide-react";
import qrImage from "@/assets/google-review-qr.jpg";

interface Props {
  url: string;
  size?: number;
}

const GoogleReviewQRCode = ({ url, size = 220 }: Props) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex flex-col items-center gap-3">
        <button
          onClick={() => setOpen(true)}
          className="qr-glow rounded-2xl bg-white p-2 hover:scale-105 transition-transform"
          aria-label="Tap to enlarge QR code"
        >
          <img
            src={qrImage}
            alt="Discover more with us — Interio QR"
            width={size}
            height={size}
            style={{ width: size, height: size, objectFit: "contain" }}
            className="rounded-lg"
          />
        </button>
        <p className="text-sm font-semibold text-white drop-shadow text-center max-w-xs">
          🎉 You are eligible for a lucky draw — scan to enter!
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
              src={qrImage}
              alt="Discover more with us — Interio QR"
              className="w-full max-h-[70vh] object-contain"
            />
            <p className="text-center text-sm text-muted-foreground">
              Tap outside to close
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default GoogleReviewQRCode;
