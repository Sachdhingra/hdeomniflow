import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Banner {
  id: string;
  image_url: string;
  title: string;
}

interface Props {
  idleSeconds?: number;
  rotateSeconds?: number;
}

/**
 * Full-screen rotating screensaver of admin-uploaded scheme banners.
 * Appears after `idleSeconds` of no interaction; dismissed by any touch/click.
 */
const KioskScreensaver = ({ idleSeconds = 45, rotateSeconds = 6 }: Props) => {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [active, setActive] = useState(false);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    supabase
      .from("scheme_banners")
      .select("id,image_url,title")
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .then(({ data }) => setBanners((data as Banner[]) ?? []));
  }, []);

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

  useEffect(() => {
    if (!active || banners.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % banners.length), rotateSeconds * 1000);
    return () => clearInterval(t);
  }, [active, banners.length, rotateSeconds]);

  if (!active || banners.length === 0) return null;
  const b = banners[idx];
  return (
    <div
      className="fixed inset-0 z-[80] bg-black flex items-center justify-center cursor-pointer"
      onClick={() => setActive(false)}
    >
      <img
        src={b.image_url}
        alt={b.title || "Scheme banner"}
        className="w-full h-full object-contain animate-fade-in"
      />
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/80 text-sm bg-black/40 rounded-full px-4 py-2 backdrop-blur">
        Touch anywhere to continue
      </div>
    </div>
  );
};

export default KioskScreensaver;
