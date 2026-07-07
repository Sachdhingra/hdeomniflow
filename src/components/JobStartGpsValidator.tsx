import { useEffect, useState } from "react";
import { AlertTriangle, MapPin, Loader2 } from "lucide-react";
import { getPositionWithRetry } from "@/hooks/useGeolocation";

interface JobStartGpsValidatorProps {
  onValidationComplete: (valid: boolean, position: { lat: number; lng: number } | null) => void;
  jobId: string;
}

export function JobStartGpsValidator({ onValidationComplete, jobId }: JobStartGpsValidatorProps) {
  const [status, setStatus] = useState<"checking" | "success" | "error">("checking");
  const [message, setMessage] = useState("Validating GPS location...");

  useEffect(() => {
    let cancelled = false;

    const validate = async () => {
      const position = await getPositionWithRetry(3);

      if (cancelled) return;

      if (position) {
        setStatus("success");
        setMessage("GPS location confirmed!");
        setTimeout(() => {
          onValidationComplete(true, { lat: position.lat, lng: position.lng });
        }, 500);
      } else {
        setStatus("error");
        setMessage("GPS unavailable. Enable GPS and try again.");
        setTimeout(() => {
          onValidationComplete(false, null);
        }, 2000);
      }
    };

    validate();
    return () => {
      cancelled = true;
    };
  }, [jobId, onValidationComplete]);

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="max-w-sm w-full bg-card border border-border rounded-2xl shadow-xl p-6 text-center space-y-4">
        <div
          className={`mx-auto w-14 h-14 rounded-full flex items-center justify-center ${
            status === "checking"
              ? "bg-blue-500/10"
              : status === "success"
                ? "bg-green-500/10"
                : "bg-destructive/10"
          }`}
        >
          {status === "checking" && <Loader2 className="w-7 h-7 text-blue-500 animate-spin" />}
          {status === "success" && <MapPin className="w-7 h-7 text-green-500" />}
          {status === "error" && <AlertTriangle className="w-7 h-7 text-destructive" />}
        </div>

        <h2 className="text-xl font-bold">GPS Location Check</h2>
        <p className="text-sm text-muted-foreground">{message}</p>

        {status === "error" && (
          <div className="text-xs text-destructive pt-2 border-t border-border">
            Your GPS location must be verified before starting a job.
          </div>
        )}
      </div>
    </div>
  );
}
