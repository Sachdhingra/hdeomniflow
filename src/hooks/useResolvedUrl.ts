import { useEffect, useState } from "react";
import { resolveUrl } from "@/lib/productLibrary";

/** Resolves a storage path (or external URL) into a displayable URL. */
export function useResolvedUrl(bucket: string, value?: string | null) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setUrl(null);
    if (!value) return;
    resolveUrl(bucket, value).then((u) => {
      if (active) setUrl(u);
    });
    return () => {
      active = false;
    };
  }, [bucket, value]);

  return url;
}
