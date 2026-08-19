import { useEffect, useState } from "react";
import { resolvePhotoUrl, type PrivatePhotoBucket } from "@/lib/photoUrls";

interface SignedImgProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src: string;
  bucket?: PrivatePhotoBucket;
}

/** <img> for photos stored in private buckets — resolves a signed URL at render time. */
export function useSignedPhoto(src: string, bucket?: PrivatePhotoBucket) {
  const [url, setUrl] = useState<string>("");

  useEffect(() => {
    let active = true;
    if (!src) {
      setUrl("");
      return;
    }
    resolvePhotoUrl(src, bucket)
      .then((u) => { if (active) setUrl(u); })
      .catch(() => { if (active) setUrl(src); });
    return () => { active = false; };
  }, [src, bucket]);

  return url;
}

const SignedImg = ({ src, bucket, ...rest }: SignedImgProps) => {
  const resolved = useSignedPhoto(src, bucket);
  if (!resolved) return null;
  return <img src={resolved} {...rest} />;
};

export default SignedImg;
