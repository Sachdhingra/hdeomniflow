import { useState, useRef, useCallback, useEffect } from "react";
import { Camera, X, RefreshCw, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const MAX_FILES = 5;
const MAX_WIDTH = 1280;
const TARGET_KB = 400;
const UPLOAD_TIMEOUT = 10_000;
const BUCKET = "field-agent-photos";

type UploadStatus = "compressing" | "uploading" | "success" | "failed";

interface PhotoEntry {
  id: string;
  blob: Blob;
  preview: string;
  status: UploadStatus;
  url?: string;
  error?: string;
}

interface Props {
  jobId: string;
  onUploadComplete: (urls: string[]) => void;
  disabled?: boolean;
}

/* ── helpers ── */

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function compress(file: File): Promise<Blob> {
  console.log(`[Photo] 🗜️ Compressing ${file.name} (${(file.size / 1024).toFixed(0)} KB)`);
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      let { width, height } = img;

      if (width > MAX_WIDTH) {
        height = Math.round(height * (MAX_WIDTH / width));
        width = MAX_WIDTH;
      }
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);

      let quality = 0.75;
      const attempt = () => {
        canvas.toBlob(
          (blob) => {
            if (!blob) { reject(new Error("Canvas toBlob failed")); return; }
            if (blob.size / 1024 <= TARGET_KB || quality <= 0.15) {
              console.log(`[Photo] ✅ Compressed → ${(blob.size / 1024).toFixed(0)} KB`);
              resolve(blob);
            } else {
              quality -= 0.1;
              attempt();
            }
          },
          "image/jpeg",
          quality,
        );
      };
      attempt();
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image load failed"));
    };
    img.src = url;
  });
}

async function upload(blob: Blob, path: string): Promise<string> {
  console.log(`[Photo] 📡 Uploading ${path} (${(blob.size / 1024).toFixed(0)} KB)`);

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Upload timed out (10 s)")), UPLOAD_TIMEOUT);

    supabase.storage
      .from(BUCKET)
      .upload(path, blob, { contentType: "image/jpeg", cacheControl: "3600", upsert: true })
      .then(({ error }) => {
        clearTimeout(timer);
        if (error) { reject(new Error(error.message)); return; }
        const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
        console.log(`[Photo] ✅ Uploaded → ${data.publicUrl}`);
        resolve(data.publicUrl);
      })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

/* ── component ── */

const ServiceJobPhotoUpload = ({ jobId, onUploadComplete, disabled }: Props) => {
  const [entries, setEntries] = useState<PhotoEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Notify parent whenever successful URLs change
  const successUrls = entries.filter((e) => e.status === "success").map((e) => e.url!);
  const urlsKey = successUrls.join(",");
  const lastNotified = useRef("");

  useEffect(() => {
    if (urlsKey && urlsKey !== lastNotified.current) {
      lastNotified.current = urlsKey;
      onUploadComplete(successUrls);
    }
  }, [urlsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const processAndUpload = useCallback(
    async (id: string, file: File) => {
      // 1. Compress
      let blob: Blob;
      try {
        blob = await compress(file);
      } catch (err: any) {
        console.error(`[Photo] ❌ Compression failed: ${err.message}`);
        setEntries((p) => p.map((e) => (e.id === id ? { ...e, status: "failed" as const, error: "Compression failed" } : e)));
        return;
      }

      const preview = URL.createObjectURL(blob);
      setEntries((p) =>
        p.map((e) => (e.id === id ? { ...e, blob, preview, status: "uploading" as const } : e)),
      );

      // 2. Upload
      const path = `jobs/${jobId}/${id}.jpg`;
      try {
        const url = await upload(blob, path);
        setEntries((p) => p.map((e) => (e.id === id ? { ...e, status: "success" as const, url } : e)));
      } catch (err: any) {
        console.error(`[Photo] ❌ Upload failed: ${err.message}`);
        setEntries((p) => p.map((e) => (e.id === id ? { ...e, status: "failed" as const, error: err.message } : e)));
      }
    },
    [jobId],
  );

  const handleFiles = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const remaining = MAX_FILES - entries.length;
      if (remaining <= 0) return;
      const files = Array.from(e.target.files || [])
        .filter((f) => f.type.startsWith("image/"))
        .slice(0, remaining);
      if (!files.length) return;

      for (const file of files) {
        const id = uid();
        console.log(`[Photo] 📸 Captured: ${file.name}`);
        const placeholder: PhotoEntry = {
          id,
          blob: file,
          preview: "",
          status: "compressing",
        };
        setEntries((prev) => [...prev, placeholder]);
        processAndUpload(id, file);
      }
      if (inputRef.current) inputRef.current.value = "";
    },
    [entries.length, processAndUpload],
  );

  const retry = useCallback(
    (entry: PhotoEntry) => {
      console.log(`[Photo] 🔄 Retrying ${entry.id}`);
      setEntries((p) => p.map((e) => (e.id === entry.id ? { ...e, status: "uploading" as const, error: undefined } : e)));
      const path = `jobs/${jobId}/${entry.id}.jpg`;
      upload(entry.blob, path)
        .then((url) => setEntries((p) => p.map((e) => (e.id === entry.id ? { ...e, status: "success" as const, url } : e))))
        .catch((err) => setEntries((p) => p.map((e) => (e.id === entry.id ? { ...e, status: "failed" as const, error: err.message } : e))));
    },
    [jobId],
  );

  const remove = useCallback((id: string) => {
    setEntries((prev) => {
      const e = prev.find((x) => x.id === id);
      if (e?.preview) URL.revokeObjectURL(e.preview);
      return prev.filter((x) => x.id !== id);
    });
  }, []);

  const busy = entries.some((e) => e.status === "compressing" || e.status === "uploading");
  const hasFailed = entries.some((e) => e.status === "failed");

  return (
    <div className="space-y-3">
      {/* capture area */}
      <div className="border-2 border-dashed border-border rounded-lg p-4 text-center">
        <Camera className="w-7 h-7 mx-auto text-muted-foreground mb-1" />
        <p className="text-sm text-muted-foreground mb-2">
          Tap to capture or select photos (max {MAX_FILES})
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          className="w-full text-sm"
          onChange={handleFiles}
          disabled={disabled || busy || entries.length >= MAX_FILES}
        />
      </div>

      {/* thumbnails */}
      {entries.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {entries.map((entry) => (
            <div key={entry.id} className="relative group">
              {entry.preview ? (
                <img
                  src={entry.preview}
                  alt="Photo"
                  className={`w-16 h-16 rounded-lg object-cover border ${
                    entry.status === "success"
                      ? "border-green-500"
                      : entry.status === "failed"
                        ? "border-destructive"
                        : "border-border"
                  }`}
                />
              ) : (
                <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center border border-border">
                  <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                </div>
              )}

              {/* overlay icons */}
              <div className="absolute inset-0 flex items-center justify-center">
                {(entry.status === "compressing" || entry.status === "uploading") && (
                  <div className="bg-background/80 rounded-full p-1">
                    <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                  </div>
                )}
                {entry.status === "success" && (
                  <div className="bg-green-500/80 rounded-full p-0.5">
                    <CheckCircle className="w-4 h-4 text-white" />
                  </div>
                )}
                {entry.status === "failed" && (
                  <button type="button" onClick={() => retry(entry)} className="bg-destructive/80 rounded-full p-0.5" title="Tap to retry">
                    <RefreshCw className="w-4 h-4 text-white" />
                  </button>
                )}
              </div>

              {/* remove button */}
              {!busy && (
                <button
                  type="button"
                  onClick={() => remove(entry.id)}
                  className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs"
                >
                  <X className="w-3 h-3" />
                </button>
              )}

              <span className="absolute bottom-0.5 left-0.5 text-[9px] bg-background/80 px-1 rounded">
                {entry.status === "compressing" ? "…" : `${(entry.blob.size / 1024).toFixed(0)}KB`}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* status messages */}
      {busy && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          {entries.some((e) => e.status === "compressing") ? "Compressing…" : "Uploading…"}
        </p>
      )}
      {hasFailed && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="w-3.5 h-3.5" />Some uploads failed — tap ↻ to retry.
        </p>
      )}
      {successUrls.length > 0 && !busy && !hasFailed && (
        <p className="text-xs text-green-600 font-medium flex items-center gap-1">
          <CheckCircle className="w-3.5 h-3.5" />{successUrls.length} photo(s) uploaded
        </p>
      )}
    </div>
  );
};

export default ServiceJobPhotoUpload;
