import { useState, useRef, useCallback, useEffect } from "react";
import { Camera, X, RefreshCw, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const MAX_FILES = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const BUCKET = "field-agent-photos";
const MAX_RETRIES = 3;

const IS_MOBILE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
  navigator.userAgent
);
const UPLOAD_TIMEOUT = IS_MOBILE ? 60_000 : 30_000;
const TARGET_KB = IS_MOBILE ? 150 : 200;
const MAX_DIMENSION = IS_MOBILE ? 800 : 1280;

type UploadStatus = "compressing" | "uploading" | "success" | "failed";

interface PhotoEntry {
  id: string;
  file: File;
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

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getNetworkInfo() {
  const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
  return conn ? { type: conn.effectiveType, downlink: conn.downlink } : { type: "unknown", downlink: null };
}

function logMobileDetails(file: File, label: string) {
  const net = getNetworkInfo();
  console.log(`[Photo] 📱 ${label}:`, {
    name: file.name,
    type: file.type || "(empty)",
    size: `${(file.size / 1024).toFixed(0)}KB`,
    isMobile: IS_MOBILE,
    network: net.type,
    userAgent: navigator.userAgent.slice(0, 80),
  });
}

/** Convert any image to a JPEG blob via canvas. Handles HEIC/HEIF/WebP/PNG. */
async function toJpegBlob(file: File, maxDim: number, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // For HEIC/HEIF: createImageBitmap may work on Safari 17+, canvas fallback otherwise
    const useObjectUrl = () => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        renderToBlob(img, maxDim, quality, resolve, reject);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Cannot decode image: ${file.type || file.name}`));
      };
      img.src = url;
    };

    // Try createImageBitmap first (handles more formats on modern browsers)
    if (typeof createImageBitmap === "function") {
      createImageBitmap(file)
        .then((bmp) => renderToBlob(bmp, maxDim, quality, resolve, reject))
        .catch(() => {
          console.log("[Photo] createImageBitmap failed, falling back to Image()");
          useObjectUrl();
        });
    } else {
      useObjectUrl();
    }
  });
}

function renderToBlob(
  source: HTMLImageElement | ImageBitmap,
  maxDim: number,
  quality: number,
  resolve: (b: Blob) => void,
  reject: (e: Error) => void
) {
  let w = source.width;
  let h = source.height;
  if (w > maxDim || h > maxDim) {
    const r = Math.min(maxDim / w, maxDim / h);
    w = Math.round(w * r);
    h = Math.round(h * r);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) { reject(new Error("Canvas context unavailable")); return; }
  ctx.drawImage(source, 0, 0, w, h);
  canvas.toBlob(
    (blob) => {
      if (!blob) { reject(new Error("toBlob returned null")); return; }
      resolve(blob);
    },
    "image/jpeg",
    quality
  );
}

/** Iteratively compress until under targetKB */
async function compressForUpload(file: File): Promise<Blob> {
  console.log(`[Photo] 🗜️ Compressing ${file.name} (${(file.size / 1024).toFixed(0)}KB) → target ${TARGET_KB}KB`);

  let quality = 0.7;
  let dim = MAX_DIMENSION;
  const MIN_QUALITY = 0.25;
  const MIN_DIM = 480;

  for (let pass = 0; pass < 8; pass++) {
    try {
      const blob = await toJpegBlob(file, dim, quality);
      const kb = blob.size / 1024;
      console.log(`[Photo] Pass ${pass}: ${kb.toFixed(0)}KB (dim=${dim}, q=${quality.toFixed(2)})`);
      if (kb <= TARGET_KB || (quality <= MIN_QUALITY && dim <= MIN_DIM)) {
        console.log(`[Photo] ✅ Final: ${kb.toFixed(0)}KB`);
        return blob;
      }
      if (quality > MIN_QUALITY) {
        quality = Math.max(MIN_QUALITY, quality - 0.1);
      } else if (dim > MIN_DIM) {
        dim = Math.max(MIN_DIM, Math.round(dim * 0.8));
        quality = 0.5;
      }
    } catch (err) {
      console.error(`[Photo] Compression pass ${pass} failed:`, err);
      // Return original as blob if all compression fails
      return file;
    }
  }
  // Last resort: just return whatever we can get
  try {
    return await toJpegBlob(file, MIN_DIM, MIN_QUALITY);
  } catch {
    console.warn("[Photo] ⚠️ All compression failed, uploading original");
    return file;
  }
}

function getErrorMessage(err: any): string {
  const msg = err?.message?.toLowerCase() || "";
  if (msg.includes("not found") || msg.includes("bucket")) return "Storage bucket not configured. Contact admin.";
  if (msg.includes("policy") || msg.includes("permission") || msg.includes("denied")) return "Upload permission denied. Contact admin.";
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("abort")) return "Upload timeout. Check internet and retry.";
  if (msg.includes("too large") || msg.includes("payload")) return "File too large after compression.";
  if (msg.includes("not authenticated") || msg.includes("jwt")) return "Session expired. Please login again.";
  if (msg.includes("cannot decode") || msg.includes("heic")) return "Photo format not supported. Try taking a JPEG photo.";
  return err?.message || "Upload failed. Tap ↻ to retry.";
}

async function uploadWithRetry(blob: Blob, path: string): Promise<string> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[Photo] 📡 Upload ${attempt}/${MAX_RETRIES}: ${path} (${(blob.size / 1024).toFixed(0)}KB)`);
    const start = Date.now();
    try {
      const result = await Promise.race([
        supabase.storage.from(BUCKET).upload(path, blob, {
          contentType: "image/jpeg",
          cacheControl: "3600",
          upsert: true,
        }),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error(`Upload timed out (${UPLOAD_TIMEOUT / 1000}s)`)), UPLOAD_TIMEOUT)
        ),
      ]);
      const { error } = result as { error: any };
      if (error) {
        console.error(`[Photo] ❌ Error: ${error.message}`);
        if (attempt === MAX_RETRIES) throw new Error(error.message);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      const elapsed = Date.now() - start;
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      console.log(`[Photo] ✅ Uploaded in ${elapsed}ms → ${data.publicUrl}`);
      return data.publicUrl;
    } catch (err: any) {
      console.error(`[Photo] ❌ Attempt ${attempt}: ${err.message}`);
      if (attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw new Error("Upload failed after all retries");
}

const ServiceJobPhotoUpload = ({ jobId, onUploadComplete, disabled }: Props) => {
  const [entries, setEntries] = useState<PhotoEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

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
      logMobileDetails(file, "Processing");

      if (file.size > MAX_FILE_SIZE) {
        setEntries((p) => p.map((e) =>
          e.id === id ? { ...e, status: "failed" as const, error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 10MB.` } : e
        ));
        return;
      }

      // Compression
      let blob: Blob;
      try {
        blob = await compressForUpload(file);
      } catch (err: any) {
        console.error("[Photo] Compression error:", err);
        // Fallback: use original file
        blob = file;
      }

      const preview = URL.createObjectURL(blob);
      setEntries((p) => p.map((e) =>
        e.id === id ? { ...e, blob, preview, status: "uploading" as const } : e
      ));

      const path = `jobs/${jobId}/${id}.jpg`;
      try {
        const url = await uploadWithRetry(blob, path);
        setEntries((p) => p.map((e) =>
          e.id === id ? { ...e, status: "success" as const, url } : e
        ));
      } catch (err: any) {
        setEntries((p) => p.map((e) =>
          e.id === id ? { ...e, status: "failed" as const, error: getErrorMessage(err) } : e
        ));
      }
    },
    [jobId],
  );

  const handleFiles = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const remaining = MAX_FILES - entries.length;
      if (remaining <= 0) return;
      const files = Array.from(e.target.files || [])
        .filter((f) => f.type.startsWith("image/") || /\.(heic|heif|jpg|jpeg|png|webp)$/i.test(f.name))
        .slice(0, remaining);
      if (!files.length) return;

      for (const file of files) {
        const id = uid();
        console.log(`[Photo] 📸 Captured: ${file.name} (${(file.size / 1024).toFixed(0)}KB, type=${file.type || "unknown"})`);
        const placeholder: PhotoEntry = { id, file, blob: file, preview: "", status: "compressing" };
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
      setEntries((p) => p.map((e) =>
        e.id === entry.id ? { ...e, status: "uploading" as const, error: undefined } : e
      ));
      const path = `jobs/${jobId}/${entry.id}.jpg`;
      uploadWithRetry(entry.blob, path)
        .then((url) => setEntries((p) => p.map((e) =>
          e.id === entry.id ? { ...e, status: "success" as const, url } : e
        )))
        .catch((err) => setEntries((p) => p.map((e) =>
          e.id === entry.id ? { ...e, status: "failed" as const, error: getErrorMessage(err) } : e
        )));
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

      {busy && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          {entries.some((e) => e.status === "compressing") ? "Compressing…" : "Uploading…"}
        </p>
      )}
      {hasFailed && (
        <div className="space-y-1">
          {entries.filter((e) => e.status === "failed").map((e) => (
            <p key={e.id} className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {e.error || "Upload failed"} — tap ↻ to retry
            </p>
          ))}
        </div>
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
