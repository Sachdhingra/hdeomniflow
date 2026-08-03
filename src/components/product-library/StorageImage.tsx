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

  if (!path || !url) {
    return (
      <div className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}>
        <ImageIcon className="w-8 h-8 opacity-40" />
      </div>
    );
  }

  return <img src={url} alt={alt} loading="lazy" className={className} />;
};

export default StorageImage;
