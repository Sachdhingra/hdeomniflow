import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

interface Banner {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
}

const ROTATE_MS = 5000;

/**
 * Full-width promotional banner carousel shown above the login form.
 * - Auto-rotates every 5s
 * - Clickable when link_url is set
 * - "Skip Banner" hides it for the session
 * - Only pulls banners that are active AND inside their start/end window (enforced by RLS)
 */
const LoginBannerCarousel = () => {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [idx, setIdx] = useState(0);
  const [skipped, setSkipped] = useState(
    () => typeof window !== "undefined" && sessionStorage.getItem("login_banner_skip") === "1",
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("login_banners")
        .select("id,title,image_url,link_url")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
      if (!cancelled) setBanners((data as Banner[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (banners.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % banners.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [banners.length]);

  if (skipped || banners.length === 0) return null;
  const b = banners[idx];

  const inner = (
    <img
      src={b.image_url}
      alt={b.title || "Promotional banner"}
      loading="eager"
      decoding="async"
      className="w-full h-full object-cover animate-fade-in"
    />
  );

  return (
    <div className="login-banner-container relative overflow-hidden bg-muted m-0 p-0">
      <div className="w-full aspect-[16/6] sm:aspect-[16/9] md:aspect-[21/9] max-h-[260px]">
        {b.link_url ? (
          <a href={b.link_url} target="_blank" rel="noopener noreferrer" className="block w-full h-full">
            {inner}
          </a>
        ) : (
          inner
        )}
      </div>

      {banners.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous banner"
            onClick={() => setIdx((i) => (i - 1 + banners.length) % banners.length)}
            className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-full p-1.5"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Next banner"
            onClick={() => setIdx((i) => (i + 1) % banners.length)}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-full p-1.5"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
            {banners.map((_, i) => (
              <button
                key={i}
                aria-label={`Go to banner ${i + 1}`}
                onClick={() => setIdx(i)}
                className={`w-1.5 h-1.5 rounded-full transition-all ${
                  i === idx ? "bg-white w-4" : "bg-white/50"
                }`}
              />
            ))}
          </div>
        </>
      )}

      <button
        type="button"
        onClick={() => {
          sessionStorage.setItem("login_banner_skip", "1");
          setSkipped(true);
        }}
        className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white text-xs rounded-full pl-2 pr-2.5 py-1 flex items-center gap-1"
      >
        <X className="w-3 h-3" /> Skip Banner
      </button>
    </div>
  );
};

export default LoginBannerCarousel;
