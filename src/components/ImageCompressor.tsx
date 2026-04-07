import { useState, useRef } from "react";
import { Camera, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";

const MAX_SIZE_KB = 300;
const MAX_FILES = 5;
const MAX_DIMENSION = 1280;

async function compressImage(file: File, maxSizeKB: number): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      let { width, height } = img;

      // Scale down to max dimension
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);

      // Progressive quality reduction
      let quality = 0.7;
      const tryCompress = () => {
        canvas.toBlob(
          (blob) => {
            if (!blob) { resolve(file); return; }
            if (blob.size / 1024 <= maxSizeKB || quality <= 0.2) {
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

interface Props {
  onFilesReady: (files: File[]) => void;
  selectedFiles: File[];
  onRemoveFile?: (index: number) => void;
}

const ImageCompressor = ({ onFilesReady, selectedFiles, onRemoveFile }: Props) => {
  const [compressing, setCompressing] = useState(false);
  const [progress, setProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const remaining = MAX_FILES - selectedFiles.length;
    if (remaining <= 0) return;
    const rawFiles = Array.from(e.target.files || []).slice(0, remaining);
    if (rawFiles.length === 0) return;

    setCompressing(true);
    setProgress(0);
    const compressed: File[] = [];
    for (let i = 0; i < rawFiles.length; i++) {
      const c = await compressImage(rawFiles[i], MAX_SIZE_KB);
      compressed.push(c);
      setProgress(Math.round(((i + 1) / rawFiles.length) * 100));
    }
    setCompressing(false);
    onFilesReady(compressed);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-2">
      <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
        <Camera className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">Tap to capture or upload (max {MAX_FILES})</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          className="mt-2 w-full text-sm"
          onChange={handleChange}
          disabled={compressing || selectedFiles.length >= MAX_FILES}
        />
      </div>
      {compressing && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Compressing images...</p>
          <Progress value={progress} className="h-2" />
        </div>
      )}
      {selectedFiles.length > 0 && !compressing && (
        <div className="flex gap-2 flex-wrap">
          {selectedFiles.map((f, i) => (
            <div key={i} className="text-xs bg-muted px-2 py-1 rounded flex items-center gap-1">
              {f.name} ({(f.size / 1024).toFixed(0)} KB)
              {onRemoveFile && (
                <button type="button" onClick={() => onRemoveFile(i)} className="ml-1 text-destructive hover:text-destructive/80">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export { compressImage };
export default ImageCompressor;
