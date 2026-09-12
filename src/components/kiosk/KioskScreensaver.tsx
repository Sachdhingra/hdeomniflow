import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { mediaTypeOf } from "@/lib/kioskMedia";

interface Banner {
  id: string;
  image_url: string;
  title: string;
  media_type: string | null;
}

interface Props {
  idleSeconds?: number;
  rotateSeconds?: number;
  /** Safety net for a video that never fires `ended` (stalled network, blocked autoplay). */
  videoMaxSeconds?: number;
}

/**
 * Full-screen rotating screensaver of admin-uploaded scheme banners.
 *
 * Images hold for `rotateSeconds`; videos play through and hand over on
 * `ended`, so a promo clip is never cut off mid-sentence. A single video loops
 * forever. Subscribes to realtime changes so add/delete/toggle in admin
 * reflects instantly.
 */
const KioskScreensaver = ({
  idleSeconds = 45,
  rotateSeconds = 6,
  videoMaxSeconds = 120,
}: Props) => {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [active, setActive] = useState(false);
  const [idx, setIdx] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const fetchBanners = async () => {
    const { data } = await supabase
      .from("scheme_banners")
      .select("id,image_url,title,media_type")
      .eq("active", true)
      .order("sort_order", { ascending: true });
    setBanners((data as Banner[]) ?? []);
  };

  // Initial load + realtime subscription
  useEffect(() => {
    fetchBanners();
    const channel = supabase
      .channel("scheme-banners-kiosk")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scheme_banners" },
        () => fetchBanners(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Idle detection
  useEffect(() => {
    let last = Date.now();
    const bump = () => {
      last = Date.now();
      if (active) setActive(false);
    };
    const events = ["pointerdown", "keydown", "touchstart", "mousemove"];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const check = setInterval(() => {
      if (!active && Date.now() - last > idleSeconds * 1000 && banners.length > 0) {
        setActive(true);
        setIdx(0);
      }
    }, 2000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(check);
    };
  }, [active, idleSeconds, banners.length]);

  const current = banners[idx];
  const isVideo = current ? mediaTypeOf(current) === "video" : false;
  const single = banners.length <= 1;

  const next = useCallback(() => {
    setIdx((i) => (banners.length === 0 ? 0 : (i + 1) % banners.length));
  }, [banners.length]);

  // Rotation. Images tick on a timer; a video runs to its own `ended`, with a
  // long timer only as a fallback so a stalled clip can't freeze the loop.
  useEffect(() => {
    if (!active || single) return;
    const hold = (isVideo ? videoMaxSeconds : rotateSeconds) * 1000;
    const t = setTimeout(next, hold);
    return () => clearTimeout(t);
  }, [active, single, isVideo, idx, rotateSeconds, videoMaxSeconds, next]);

  // Restart playback whenever the shown video changes — reusing one <video>
  // across sources otherwise leaves the previous clip's last frame up.
  useEffect(() => {
    const el = videoRef.current;
    if (!active || !isVideo || !el) return;
    el.currentTime = 0;
    // Muted autoplay is allowed everywhere, but a rejected promise must not
    // stall the rotation — the fallback timer above still moves things along.
    void el.play().catch(() => {});
  }, [active, isVideo, idx]);

  // Clamp index if banners shrink while active
  useEffect(() => {
    if (banners.length === 0) { setActive(false); return; }
    if (idx >= banners.length) setIdx(0);
  }, [banners.length, idx]);

  if (!active || !current) return null;
  return (
    <div
      className="fixed inset-0 z-[80] bg-black flex items-center justify-center cursor-pointer"
      onClick={() => setActive(false)}
    >
      {isVideo ? (
        <video
          ref={videoRef}
          key={current.id}
          src={current.image_url}
          className="w-full h-full object-contain animate-fade-in"
          autoPlay
          muted
          playsInline
          // One clip on its own has nothing to hand over to, so it repeats.
          loop={single}
          preload="auto"
          aria-label={current.title || "Scheme video"}
          onEnded={() => { if (!single) next(); }}
          // A missing or undecodable file would otherwise park the screensaver
          // on a black rectangle until someone touches the screen. The warning
          // is the only trace left, since the kiosk runs unattended.
          onError={(e) => {
            console.warn(
              `[kiosk] skipping "${current.title || current.id}": video error ${e.currentTarget.error?.code ?? "unknown"}`,
            );
            if (!single) next();
          }}
        />
      ) : (
        <img
          src={current.image_url}
          alt={current.title || "Scheme banner"}
          className="w-full h-full object-contain animate-fade-in"
        />
      )}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/80 text-sm bg-black/40 rounded-full px-4 py-2 backdrop-blur">
        Touch anywhere to continue
      </div>
    </div>
  );
};

export default KioskScreensaver;
