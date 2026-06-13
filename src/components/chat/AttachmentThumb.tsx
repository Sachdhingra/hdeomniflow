import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  FileText,
  FileSpreadsheet,
  FileImage,
  FileType,
  File as FileIcon,
  Download,
  Loader2,
} from "lucide-react";

export interface ChatFile {
  path: string;
  name: string;
  size: number;
  type: string;
}

const IMAGE_EXT = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];

const formatBytes = (b: number) => {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
};

const getExt = (name: string) =>
  (name.split(".").pop() || "").toLowerCase();

const iconForExt = (ext: string) => {
  if (["xlsx", "xls", "csv"].includes(ext))
    return { Icon: FileSpreadsheet, color: "text-emerald-600", bg: "bg-emerald-50" };
  if (["doc", "docx"].includes(ext))
    return { Icon: FileType, color: "text-blue-600", bg: "bg-blue-50" };
  if (ext === "pdf")
    return { Icon: FileText, color: "text-red-600", bg: "bg-red-50" };
  if (["ppt", "pptx"].includes(ext))
    return { Icon: FileText, color: "text-orange-600", bg: "bg-orange-50" };
  if (IMAGE_EXT.includes(ext))
    return { Icon: FileImage, color: "text-violet-600", bg: "bg-violet-50" };
  return { Icon: FileIcon, color: "text-muted-foreground", bg: "bg-muted" };
};

interface Props {
  file: ChatFile;
  onOpen: (f: ChatFile) => void;
}

const AttachmentThumb = ({ file, onOpen }: Props) => {
  const ext = getExt(file.name);
  const isImage = IMAGE_EXT.includes(ext) || (file.type || "").startsWith("image/");
  const [thumb, setThumb] = useState<string | null>(null);
  const [loading, setLoading] = useState(isImage);

  useEffect(() => {
    let cancelled = false;
    if (!isImage) return;
    (async () => {
      const { data } = await supabase.storage
        .from("chat-attachments")
        .createSignedUrl(file.path, 60 * 10);
      if (!cancelled) {
        setThumb(data?.signedUrl ?? null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file.path, isImage]);

  if (isImage) {
    return (
      <button
        type="button"
        onClick={() => onOpen(file)}
        className="group relative block overflow-hidden rounded-lg border border-border bg-muted max-w-[220px]"
        aria-label={`Open ${file.name}`}
      >
        {loading ? (
          <div className="flex h-40 w-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : thumb ? (
          <img
            src={thumb}
            alt={file.name}
            className="h-40 w-auto max-w-[220px] object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-40 w-40 items-center justify-center">
            <FileImage className="h-8 w-8 text-muted-foreground" />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-[10px] text-white">
          <span className="truncate">{file.name}</span>
          <span className="shrink-0 opacity-80">{formatBytes(file.size)}</span>
        </div>
      </button>
    );
  }

  const { Icon, color, bg } = iconForExt(ext);
  return (
    <button
      type="button"
      onClick={() => onOpen(file)}
      className="flex max-w-full items-center gap-2.5 rounded-md border border-border bg-card px-2.5 py-2 text-left transition-colors hover:bg-muted"
    >
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded ${bg}`}>
        <Icon className={`h-5 w-5 ${color}`} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-medium">{file.name}</div>
        <div className="text-[10px] uppercase text-muted-foreground">
          {ext || "file"} · {formatBytes(file.size)}
        </div>
      </div>
      <Download className="ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </button>
  );
};

export default AttachmentThumb;
