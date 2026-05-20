import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";

interface Props {
  url: string;
  size?: number;
}

const GoogleReviewQRCode = ({ url, size = 300 }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !url) return;
    QRCode.toCanvas(canvasRef.current, url, {
      width: size,
      margin: 2,
      color: { dark: "#000000", light: "#FFFFFF" },
      errorCorrectionLevel: "H",
    }).catch(() => {});
  }, [url, size]);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="qr-glow rounded-2xl bg-white p-3">
        <canvas ref={canvasRef} width={size} height={size} className="rounded-lg" />
      </div>
      <p className="text-base font-semibold text-white drop-shadow">Scan to review us ⭐</p>
      <Button
        size="lg"
        variant="secondary"
        onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
        className="gap-2"
      >
        Open Review Link <ExternalLink className="w-4 h-4" />
      </Button>
    </div>
  );
};

export default GoogleReviewQRCode;
