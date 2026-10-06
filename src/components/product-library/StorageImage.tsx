import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useResolvedUrl } from "@/hooks/useResolvedUrl";
import { BUCKET_IMAGES } from "@/lib/productLibrary";

interface Props {
  path?: string | null;
  alt?: string;
  className?: string;
  bucket?: string;
}

const StorageImage = ({ path, alt = "", className, bucket = BUCKET_IMAGES }: Props) => {
  const url = useResolvedUrl(bucket, path);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);

  // Missing, unsigned or dead link (e.g. an old inventory photo): show the placeholder.
  if (!path || !url || failed) {
    return (
      <div className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}>
        <ImageIcon className="w-8 h-8 opacity-40" />
      </div>
    );
  }

  return (
    <img src={url} alt={alt} loading="lazy" className={className} onError={() => setFailed(true)} />
  );
};

export default StorageImage;
