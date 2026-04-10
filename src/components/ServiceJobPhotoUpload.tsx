import { useState, useRef, useCallback } from "react";
import { Camera, X, RefreshCw, CheckCircle, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const MAX_FILES = 5;
const MAX_DIMENSION = 1200;
const TARGET_SIZE_KB = 400;
const UPLOAD_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;
const BUCKET = "field-agent-photos";

type FileEntry = {
  id: string;
  file: File;
  preview: string;
  status: "compressing" | "uploading" | "success" | "failed";
  url?: string;
  error?: string;
  retryCount: number;
};

interface Props {
  jobId: string;
  onUploadComplete: (urls: string[]) => void;
  disabled?: boolean;
}

function generateId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function compressImage(file: File): Promise<File> {
  console.log(`[PhotoUpload] 🗜️ Compressing: ${file.name} (${(file.size / 1024).toFixed(0)}KB)`);
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      let { width, height } = img;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);

      let quality = 0.7;
      const tryCompress = () => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              console.warn("[PhotoUpload] ⚠️ Blob creation failed, using original");
              resolve(file);
              return;
            }
            if (blob.size / 1024 <= TARGET_SIZE_KB || quality <= 0.1) {
              const compressed = new File(
                [blob],
                file.name.replace(/\.[^.]+$/, ".jpg"),
                { type: "image/jpeg" }
              );
              console.log(`[PhotoUpload] ✅ Compression complete: ${(file.size / 1024).toFixed(0)}KB → ${(compressed.size / 1024).toFixed(0)}KB`);
              resolve(compressed);
            } else {
              quality -= 0.1;
              tryCompress();
            }
          },
          "image/jpeg",
          quality
        );
      };
      tryCompress();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      console.warn("[PhotoUpload] ⚠️ Image load failed, using original");
      resolve(file);
    };
    img.src = url;
  });
}

async function uploadFile(file: File, path: string, attempt: number): Promise<string> {
  console.log(`[PhotoUpload] 📡 Upload started: attempt ${attempt}/${MAX_RETRIES}, path=${path}, size=${(file.size / 1024).toFixed(0)}KB`);

  if (!file || file.size === 0) {
    throw new Error("Invalid file object - empty or null");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.warn(`[PhotoUpload] ⏱️ Upload timed out after ${UPLOAD_TIMEOUT_MS / 1000}s`);
    controller.abort();
  }, UPLOAD_TIMEOUT_MS);

  try {
    const arrayBuffer = await file.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: "image/jpeg" });
    console.log(`[PhotoUpload] 📦 File buffer ready: ${(blob.size / 1024).toFixed(0)}KB`);

    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
      contentType: "image/jpeg",
      cacheControl: "3600",
      upsert: true,
    });

    clearTimeout(timeoutId);

    if (error) {
      console.error(`[PhotoUpload] ❌ Supabase error:`, error.message);
      throw new Error(error.message);
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    console.log(`[PhotoUpload] ✅ Upload success: ${data.publicUrl}`);
    return data.publicUrl;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error(`Upload timed out after ${UPLOAD_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }
}

async function uploadWithRetry(file: File, path: string): Promise<string> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await uploadFile(file, path, attempt);
    } catch (err: any) {
      console.warn(`[PhotoUpload] ❌ Attempt ${attempt} failed: ${err.message}`);
      if (attempt === MAX_RETRIES) throw err;
      const backoff = 1000 * Math.pow(2, attempt - 1);
      console.log(`[PhotoUpload] ⏳ Retrying in ${backoff}ms...`);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw new Error("Upload failed after all retries");
}

const ServiceJobPhotoUpload = ({ jobId, onUploadComplete, disabled }: Props) => {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevUrlsRef = useRef<string>("");

  const uploadEntry = useCallback(
    async (id: string, compressedFile: File) => {
      const path = `jobs/${jobId}/${id}.jpg`;
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, status: "uploading" as const, error: undefined } : e))
      );
      try {
        const url = await uploadWithRetry(compressedFile, path);
        setEntries((prev) =>
          prev.map((e) => (e.id === id ? { ...e, status: "success" as const, url } : e))
        );
      } catch (err: any) {
        console.error(`[PhotoUpload] 💥 Upload failed for ${id}: ${err.message}`);
        setEntries((prev) =>
          prev.map((e) =>
            e.id === id
              ? { ...e, status: "failed" as const, error: err.message, retryCount: e.retryCount + 1 }
              : e
          )
        );
      }
    },
    [jobId]
  );

  const handleFiles = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const remaining = MAX_FILES - entries.length;
      if (remaining <= 0) return;
      const selected = Array.from(e.target.files || []).slice(0, remaining);
      if (!selected.length) return;

      for (const f of selected) {
        if (!f.type.startsWith("image/")) {
          console.warn(`[PhotoUpload] ⚠️ Non-image rejected: ${f.name}`);
          return;
        }
      }

      for (const rawFile of selected) {
        const id = generateId();
        const placeholder: FileEntry = {
          id,
          file: rawFile,
          preview: "",
          status: "compressing",
          retryCount: 0,
        };
        setEntries((prev) => [...prev, placeholder]);

        // Compress then auto-upload
        (async () => {
          try {
            const compressed = await compressImage(rawFile);
            const preview = URL.createObjectURL(compressed);
            setEntries((prev) =>
              prev.map((entry) =>
                entry.id === id ? { ...entry, file: compressed, preview, status: "uploading" as const } : entry
              )
            );
            await uploadEntry(id, compressed);
          } catch (err) {
            setEntries((prev) =>
              prev.map((entry) =>
                entry.id === id ? { ...entry, status: "failed" as const, error: "Compression failed" } : entry
              )
            );
          }
        })();
      }

      if (inputRef.current) inputRef.current.value = "";
    },
    [entries.length, uploadEntry]
  );

  const retryEntry = useCallback(
    (entry: FileEntry) => {
      uploadEntry(entry.id, entry.file);
    },
    [uploadEntry]
  );

  const removeEntry = useCallback((id: string) => {
    setEntries((prev) => {
      const e = prev.find((x) => x.id === id);
      if (e?.preview) URL.revokeObjectURL(e.preview);
      return prev.filter((x) => x.id !== id);
    });
  }, []);

  // Notify parent when successful URLs change
  const successUrls = entries.filter((e) => e.status === "success").map((e) => e.url!);
  const urlsKey = successUrls.join(",");
  if (urlsKey !== prevUrlsRef.current && successUrls.length > 0) {
    prevUrlsRef.current = urlsKey;
    setTimeout(() => onUploadComplete(successUrls), 0);
  }

  const hasUploading = entries.some((e) => e.status === "uploading" || e.status === "compressing");
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
          disabled={disabled || hasUploading || entries.length >= MAX_FILES}
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
                  <Camera className="w-5 h-5 text-muted-foreground animate-pulse" />
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
                  <button
                    type="button"
                    onClick={() => retryEntry(entry)}
                    className="bg-destructive/80 rounded-full p-0.5"
                    title="Tap to retry"
                  >
                    <RefreshCw className="w-4 h-4 text-white" />
                  </button>
                )}
              </div>

              {entry.status !== "uploading" && entry.status !== "compressing" && (
                <button
                  type="button"
                  onClick={() => removeEntry(entry.id)}
                  className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs"
                >
                  <X className="w-3 h-3" />
                </button>
              )}

              <span className="absolute bottom-0.5 left-0.5 text-[9px] bg-background/80 px-1 rounded">
                {entry.status === "compressing" ? "…" : `${(entry.file.size / 1024).toFixed(0)}KB`}
              </span>
            </div>
          ))}
        </div>
      )}

      {hasUploading && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />Uploading…
        </p>
      )}

      {hasFailed && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="w-3.5 h-3.5" />Some uploads failed. Tap ↻ to retry.
        </p>
      )}

      {successUrls.length > 0 && !hasUploading && !hasFailed && (
        <p className="text-xs text-green-600 font-medium flex items-center gap-1">
          <CheckCircle className="w-3.5 h-3.5" />{successUrls.length} photo(s) uploaded
        </p>
      )}
    </div>
  );
};

export default ServiceJobPhotoUpload;
