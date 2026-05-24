import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import qrImage from "@/assets/google-review-qr.jpg";

interface Props {
  url: string;
  size?: number;
}

const GoogleReviewQRCode = ({ url, size = 280 }: Props) => {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="qr-glow rounded-2xl bg-white p-3">
        <img
          src={qrImage}
          alt="Google review QR code"
          width={size}
          height={size}
          style={{ width: size, height: size, objectFit: "contain" }}
          className="rounded-lg"
        />
      </div>
      <p className="text-base font-semibold text-white drop-shadow">Scan to leave a Google review</p>
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
