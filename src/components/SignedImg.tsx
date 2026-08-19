import { useCallback, useEffect, useRef, useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolvePhotoUrl } from "@/lib/photoUrls";

type Status = "loading" | "ready" | "error";

interface SignedImgProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src: string;
  /** Bucket to assume when the stored value is a bare storage path. */
  bucket?: string;
}

interface PhotoState {
  url: string | null;
  status: Status;
  /** Re-sign, bypassing any cached URL. */
  retry: () => void;
  /** Call when the browser fails to load the resolved URL (expired/stale signature). */
  onLoadError: () => void;
}

/** Resolve a stored photo value into a signed, renderable URL. */
export function usePhoto(src: string, bucket?: string): PhotoState {
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(src ? "loading" : "error");
  const [attempt, setAttempt] = useState(0);
  // A stale signature is worth exactly one silent re-sign; after that we give up
  // rather than loop on a URL the browser keeps rejecting.
  const retriedLoad = useRef(false);

  useEffect(() => {
    retriedLoad.current = false;
    setAttempt(0);
  }, [src, bucket]);

  useEffect(() => {
    let active = true;
    if (!src) {
      setUrl(null);
      setStatus("error");
      return;
    }
    setStatus("loading");
    resolvePhotoUrl(src, bucket, { force: attempt > 0 })
      .then((resolved) => {
        if (!active) return;
        setUrl(resolved);
        setStatus(resolved ? "ready" : "error");
      })
      .catch(() => {
        if (!active) return;
        setUrl(null);
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [src, bucket, attempt]);

  const retry = useCallback(() => {
    retriedLoad.current = false;
    setAttempt((a) => a + 1);
  }, []);

  const onLoadError = useCallback(() => {
    if (retriedLoad.current) {
      setStatus("error");
      return;
    }
    retriedLoad.current = true;
    setAttempt((a) => a + 1);
  }, []);

  return { url, status, retry, onLoadError };
}

/** @deprecated use {@link usePhoto} — this drops the loading/error distinction. */
export function useSignedPhoto(src: string, bucket?: string) {
  return usePhoto(src, bucket).url ?? "";
}

interface PlaceholderProps {
  status: Status;
  className?: string;
  title?: string;
  onRetry?: () => void;
}

/** Keeps the layout stable while loading, and makes a failure visible + retryable. */
const PhotoPlaceholder = ({ status, className, title, onRetry }: PlaceholderProps) => {
  if (status === "loading") {
    return <div className={cn("bg-muted animate-pulse", className)} aria-hidden="true" />;
  }
  return (
    <button
      type="button"
      title={title || "Photo unavailable — tap to retry"}
      aria-label="Photo unavailable, tap to retry"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onRetry?.();
      }}
      className={cn(
        "bg-muted flex items-center justify-center text-muted-foreground",
        className,
      )}
    >
      <ImageOff className="w-4 h-4 opacity-60" />
    </button>
  );
};

/** `<img>` for photos in private buckets — resolves a signed URL at render time. */
const SignedImg = ({ src, bucket, className, alt = "", onError, ...rest }: SignedImgProps) => {
  const { url, status, retry, onLoadError } = usePhoto(src, bucket);

  if (!src) return null;
  if (status !== "ready" || !url) {
    return <PhotoPlaceholder status={status} className={className} onRetry={retry} />;
  }

  return (
    <img
      src={url}
      alt={alt}
      className={className}
      onError={(e) => {
        onLoadError();
        onError?.(e);
      }}
      {...rest}
    />
  );
};

interface SignedPhotoLinkProps extends SignedImgProps {
  /** Stop the click from reaching a clickable parent (card, table row). */
  stopPropagation?: boolean;
}

/** Thumbnail that opens the full photo in a new tab, signed on both ends. */
export const SignedPhotoLink = ({
  src,
  bucket,
  className,
  alt = "",
  stopPropagation,
  onError,
  ...rest
}: SignedPhotoLinkProps) => {
  const { url, status, retry, onLoadError } = usePhoto(src, bucket);

  if (!src) return null;
  if (status !== "ready" || !url) {
    return <PhotoPlaceholder status={status} className={className} onRetry={retry} />;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
    >
      <img
        src={url}
        alt={alt}
        className={className}
        onError={(e) => {
          onLoadError();
          onError?.(e);
        }}
        {...rest}
      />
    </a>
  );
};

export default SignedImg;
