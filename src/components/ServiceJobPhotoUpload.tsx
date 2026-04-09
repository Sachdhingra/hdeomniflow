import { useState, useRef, useCallback } from "react";
import { Camera, X, RefreshCw, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";

const MAX_FILES = 5;
const MAX_DIMENSION = 1200;
const TARGET_SIZE_KB = 500;
const UPLOAD_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;
const BUCKET = "field-agent-photos";

type UploadState = "idle" | "compressing" | "uploading" | "success" | "failed";

interface Props {
  jobId: string;
  onUploadComplete: (urls: string[]) => void;
  disabled?: boolean;
}

async function compressImage(file: File): Promise<File> {
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
            if (!blob) { resolve(file); return; }
            if (blob.size / 1024 <= TARGET_SIZE_KB || quality <= 0.1) {
              resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
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
    img.onerror = () => resolve(file);
    img.src = url;
  });
}

async function uploadWithRetry(file: File, path: string): Promise<string> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

    try {
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: "image/jpeg",
        cacheControl: "3600",
        upsert: true,
      });
      clearTimeout(timeout);
      if (error) throw new Error(error.message);

      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      console.log(`[PhotoUpload] Uploaded ${path} on attempt ${attempt}`);
      return data.publicUrl;
    } catch (err: any) {
      clearTimeout(timeout);
      console.warn(`[PhotoUpload] Attempt ${attempt}/${MAX_RETRIES} failed:`, err.message);
      if (attempt === MAX_RETRIES) throw err;
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }
  throw new Error("Upload failed after all retries");
}

const ServiceJobPhotoUpload = ({ jobId, onUploadComplete, disabled }: Props) => {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const remaining = MAX_FILES - files.length;
    if (remaining <= 0) return;
    const selected = Array.from(e.target.files || []).slice(0, remaining);
    if (!selected.length) return;

    for (const f of selected) {
      if (!f.type.startsWith("image/")) {
        setError(`"${f.name}" is not an image file`);
        return;
      }
    }

    setUploadState("compressing");
    setError(null);
    setProgress(0);

    try {
      const compressed: File[] = [];
      for (let i = 0; i < selected.length; i++) {
        const c = await compressImage(selected[i]);
        compressed.push(c);
        setProgress(Math.round(((i + 1) / selected.length) * 100));
        console.log(`[PhotoUpload] Compressed ${selected[i].name}: ${(selected[i].size / 1024).toFixed(0)}KB → ${(c.size / 1024).toFixed(0)}KB`);
      }

      const newPreviews = compressed.map(f => URL.createObjectURL(f));
      setFiles(prev => [...prev, ...compressed]);
      setPreviews(prev => [...prev, ...newPreviews]);
      setUploadState("idle");
    } catch {
      setError("Failed to compress images");
      setUploadState("idle");
    }

    if (inputRef.current) inputRef.current.value = "";
  }, [files.length]);

  const removeFile = (idx: number) => {
    URL.revokeObjectURL(previews[idx]);
    setFiles(prev => prev.filter((_, i) => i !== idx));
    setPreviews(prev => prev.filter((_, i) => i !== idx));
    if (uploadState === "success") {
      setUploadState("idle");
      setUploadedUrls([]);
    }
  };

  const handleUpload = async () => {
    if (!files.length) return;
    setUploadState("uploading");
    setProgress(0);
    setError(null);

    const urls: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const path = `jobs/${jobId}/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
        const url = await uploadWithRetry(files[i], path);
        urls.push(url);
        setProgress(Math.round(((i + 1) / files.length) * 100));
      }
      setUploadedUrls(urls);
      setUploadState("success");
      onUploadComplete(urls);
    } catch (err: any) {
      setError(`Upload failed: ${err.message}. Tap Retry.`);
      setUploadState("failed");
      if (urls.length) {
        setUploadedUrls(urls);
        onUploadComplete(urls);
      }
    }
  };

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
          disabled={disabled || uploadState === "uploading" || uploadState === "compressing" || files.length >= MAX_FILES}
        />
      </div>

      {uploadState === "compressing" && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Compressing images…</p>
          <Progress value={progress} className="h-2" />
        </div>
      )}

      {previews.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {previews.map((src, i) => (
            <div key={i} className="relative group">
              <img src={src} alt={`Photo ${i + 1}`} className="w-16 h-16 rounded-lg object-cover border border-border" />
              {uploadState !== "uploading" && (
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
              <span className="absolute bottom-0.5 left-0.5 text-[9px] bg-background/80 px-1 rounded">
                {(files[i]?.size / 1024).toFixed(0)}KB
              </span>
            </div>
          ))}
        </div>
      )}

      {files.length > 0 && uploadState !== "success" && (
        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={handleUpload}
          disabled={uploadState === "uploading" || uploadState === "compressing"}
        >
          {uploadState === "uploading" ? (
            <>⏳ Uploading… {progress}%</>
          ) : uploadState === "failed" ? (
            <><RefreshCw className="w-4 h-4" />Retry Upload</>
          ) : (
            <>📤 Upload {files.length} Photo(s)</>
          )}
        </Button>
      )}

      {uploadState === "uploading" && <Progress value={progress} className="h-2" />}

      {error && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="w-3.5 h-3.5" />{error}
        </p>
      )}
      {uploadState === "success" && (
        <p className="text-xs text-success font-medium flex items-center gap-1">
          <CheckCircle className="w-3.5 h-3.5" />✅ {uploadedUrls.length} photo(s) uploaded successfully
        </p>
      )}
    </div>
  );
};

export default ServiceJobPhotoUpload;
