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

const KIOSK_PIN = "1234";

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
  const unlockingRef = useRef(false);

  // Block navigation, shortcuts, context menu
  useEffect(() => {
    if (!isKioskLocked) return;

    // Sentinel history entries — bounce back/forward attempts
    window.history.pushState(null, "", window.location.href);
    window.history.pushState(null, "", window.location.href);
    const handlePopState = () => {
      window.history.pushState(null, "", window.location.href);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const blocked = ["F1","F2","F3","F4","F5","F6","F7","F8","F9","F10","F11","F12","Escape","BrowserBack","BrowserForward","BrowserRefresh"];
      if (blocked.includes(e.key)) { e.preventDefault(); e.stopPropagation(); return; }
      const meta = e.ctrlKey || e.metaKey || e.altKey;
      if (meta) { e.preventDefault(); e.stopPropagation(); return; }
      lastActivityRef.current = Date.now();
    };

    const handleContextMenu = (e: MouseEvent) => e.preventDefault();
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (unlockingRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const bump = () => { lastActivityRef.current = Date.now(); };

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pointerdown", bump);
    window.addEventListener("touchstart", bump);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("beforeunload", beforeUnload);
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

  // Persistent fullscreen — re-request on any interaction if not in fullscreen, while locked
  useEffect(() => {
    if (!isKioskLocked) return;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    const tryFullscreen = async () => {
      try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen({ navigationUI: "hide" } as any);
        }
      } catch { /* needs gesture */ }
    };
    const onAnyTap = () => { tryFullscreen(); };
    const onFsChange = () => {
      // If user/system exited fullscreen while still locked, re-arm for next tap
      if (!document.fullscreenElement && isKioskLocked) {
        // Will re-request on next pointerdown via onAnyTap
      }
    };
    window.addEventListener("pointerdown", onAnyTap);
    document.addEventListener("fullscreenchange", onFsChange);
    // First attempt (likely needs gesture)
    tryFullscreen();

    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
      window.removeEventListener("pointerdown", onAnyTap);
      document.removeEventListener("fullscreenchange", onFsChange);
    };
  }, [isKioskLocked]);

  const handleAdminUnlock = () => {
    const pin = window.prompt("Enter admin PIN:");
    if (pin === null) return;
    if (pin === adminPin) {
      unlockingRef.current = true;
      setIsKioskLocked(false);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    } else {
      window.alert("Wrong PIN");
    }
  };

  const handleLock = () => {
    unlockingRef.current = false;
    setIsKioskLocked(true);
    navigate(resetPath, { replace: true });
  };

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
          Locked · triple-tap any corner for admin
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
