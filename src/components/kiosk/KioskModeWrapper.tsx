import React, { useEffect, useRef, useState, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, Unlock } from "lucide-react";

interface KioskModeWrapperProps {
  children: ReactNode;
  enableAutoReset?: boolean;
  resetTimeoutMinutes?: number;
  resetPath?: string;
  adminPin?: string;
}

const KIOSK_PIN = "1234"; // TODO: change before deploying

export const KioskModeWrapper: React.FC<KioskModeWrapperProps> = ({
  children,
  enableAutoReset = true,
  resetTimeoutMinutes = 5,
  resetPath = "/kiosk/feedback",
  adminPin = KIOSK_PIN,
}) => {
  const navigate = useNavigate();
  const [isKioskLocked, setIsKioskLocked] = useState(true);
  const lastActivityRef = useRef<number>(Date.now());
  const tapCountRef = useRef<number>(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Block navigation, shortcuts, context menu
  useEffect(() => {
    if (!isKioskLocked) return;

    // Push a sentinel so back-button bounces forward
    window.history.pushState(null, "", window.location.href);
    const handlePopState = () => {
      window.history.pushState(null, "", window.location.href);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const blocked = ["F5", "F11", "F12", "Escape"];
      const meta = e.ctrlKey || e.metaKey || e.altKey;
      if (blocked.includes(e.key)) {
        e.preventDefault();
        return;
      }
      if (meta && ["t", "w", "n", "q", "l", "r", "p", "j"].includes(e.key.toLowerCase())) {
        e.preventDefault();
        return;
      }
      lastActivityRef.current = Date.now();
    };

    const handleContextMenu = (e: MouseEvent) => e.preventDefault();
    const bump = () => { lastActivityRef.current = Date.now(); };

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("pointerdown", bump);
    window.addEventListener("touchstart", bump);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("touchstart", bump);
    };
  }, [isKioskLocked]);

  // Auto-reset on inactivity
  useEffect(() => {
    if (!enableAutoReset || !isKioskLocked) return;
    const timeoutMs = resetTimeoutMinutes * 60 * 1000;
    const id = setInterval(() => {
      if (Date.now() - lastActivityRef.current > timeoutMs) {
        navigate(resetPath, { replace: true });
        lastActivityRef.current = Date.now();
      }
    }, 10000);
    return () => clearInterval(id);
  }, [enableAutoReset, isKioskLocked, resetTimeoutMinutes, navigate, resetPath]);

  // Fullscreen body styles while locked + request browser fullscreen on first interaction
  useEffect(() => {
    if (!isKioskLocked) return;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    const tryFullscreen = async () => {
      try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      } catch { /* requires user gesture; will retry on next tap */ }
    };
    window.addEventListener("pointerdown", tryFullscreen, { once: true });

    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
      window.removeEventListener("pointerdown", tryFullscreen);
    };
  }, [isKioskLocked]);

  const handleAdminUnlock = () => {
    const pin = window.prompt("Enter admin PIN:");
    if (pin === null) return;
    if (pin === adminPin) {
      setIsKioskLocked(false);
    } else {
      window.alert("Wrong PIN");
    }
  };

  const handleLock = () => {
    setIsKioskLocked(true);
    navigate(resetPath, { replace: true });
  };

  // Corner triple-tap detector
  const handleCornerTap = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isKioskLocked) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const zone = 60;
    const inCorner =
      (e.clientX < zone || e.clientX > w - zone) &&
      (e.clientY < zone || e.clientY > h - zone);
    if (!inCorner) return;

    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => { tapCountRef.current = 0; }, 1500);

    if (tapCountRef.current >= 3) {
      tapCountRef.current = 0;
      handleAdminUnlock();
    }
  };

  return (
    <div
      onPointerDown={handleCornerTap}
      className="fixed inset-0 w-screen h-screen overflow-hidden bg-background select-none"
      style={{ touchAction: "manipulation" }}
    >
      <div className="absolute inset-0 overflow-auto">{children}</div>

      {isKioskLocked && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground/70">
          Auto-reset after {resetTimeoutMinutes} min idle · triple-tap any corner for admin
        </div>
      )}

      {!isKioskLocked && (
        <div className="absolute bottom-4 right-4 flex items-center gap-2 rounded-lg border border-border bg-card/95 backdrop-blur p-2 shadow-lg">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Unlock className="w-3 h-3" /> Unlocked
          </span>
          <button
            onClick={handleLock}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Lock className="w-3 h-3" /> Lock Kiosk
          </button>
        </div>
      )}
    </div>
  );
};

export default KioskModeWrapper;
