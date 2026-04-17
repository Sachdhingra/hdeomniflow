import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MapPin, ExternalLink } from "lucide-react";

interface Props {
  lat: number;
  lng: number;
  accuracy?: number | null;
  capturedAt?: string | null;
  trigger?: React.ReactNode;
}

const SiteVisitLocationDialog = ({ lat, lng, accuracy, capturedAt, trigger }: Props) => {
  const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
  const embedUrl = `https://www.google.com/maps?q=${lat},${lng}&hl=en&z=16&output=embed`;

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm" variant="outline" className="gap-1 h-7 text-xs">
            <MapPin className="w-3 h-3" />View Location
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Site Visit Location</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-sm space-y-1">
            <p><span className="text-muted-foreground">Coordinates:</span> {lat.toFixed(6)}°, {lng.toFixed(6)}°</p>
            {accuracy != null && <p><span className="text-muted-foreground">Accuracy:</span> ±{Math.round(accuracy)}m</p>}
            {capturedAt && <p><span className="text-muted-foreground">Captured:</span> {new Date(capturedAt).toLocaleString("en-IN")}</p>}
          </div>
          <div className="aspect-video w-full rounded-md overflow-hidden border border-border">
            <iframe
              src={embedUrl}
              width="100%"
              height="100%"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title="Site visit location map"
            />
          </div>
          <Button asChild variant="outline" className="w-full gap-1">
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4" /> Open in Google Maps
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SiteVisitLocationDialog;
