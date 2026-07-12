import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  JARVIS_FAB_POSITION_STORAGE_KEY,
  JARVIS_FAB_TAGLINE,
  JARVIS_ROLES,
  clampJarvisFabPosition,
  type JarvisRole,
} from "@/lib/jarvis";

const BUTTON_SIZE = 56;
const DRAG_THRESHOLD_PX = 6;

interface Pos {
  x: number;
  y: number;
}

function defaultPos(): Pos {
  return clampJarvisFabPosition(
    window.innerWidth - BUTTON_SIZE - 16,
    window.innerHeight - BUTTON_SIZE - 96,
    window.innerWidth,
    window.innerHeight,
    BUTTON_SIZE,
  );
}

function loadPos(): Pos {
  try {
    const raw = localStorage.getItem(JARVIS_FAB_POSITION_STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p?.x === "number" && typeof p?.y === "number") {
        return clampJarvisFabPosition(p.x, p.y, window.innerWidth, window.innerHeight, BUTTON_SIZE);
      }
    }
  } catch {
    // corrupt/unavailable storage — fall through to the default corner
  }
  return defaultPos();
}

// Floating Jarvis launcher shown on every screen for roles that can use
// Jarvis. Drag it anywhere (position is remembered); tap it to open /jarvis.
const JarvisFloatingButton = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [pos, setPos] = useState<Pos>(loadPos);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const posRef = useRef(pos);
  posRef.current = pos;

  const savePos = useCallback((p: Pos) => {
    try {
      localStorage.setItem(JARVIS_FAB_POSITION_STORAGE_KEY, JSON.stringify(p));
    } catch {
      // storage unavailable — position just won't persist
    }
  }, []);

  // Keep the button on-screen when the window is resized or rotated.
  useEffect(() => {
    const onResize = () => {
      setPos(p => clampJarvisFabPosition(p.x, p.y, window.innerWidth, window.innerHeight, BUTTON_SIZE));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!user || !JARVIS_ROLES.includes(user.role as JarvisRole)) return null;
  if (location.pathname === "/jarvis") return null;

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: posRef.current.x,
      originY: posRef.current.y,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
    }
    setPos(clampJarvisFabPosition(d.originX + dx, d.originY + dy, window.innerWidth, window.innerHeight, BUTTON_SIZE));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (d?.moved) {
      savePos(posRef.current);
    } else {
      navigate("/jarvis");
    }
  };

  // Show the tagline on whichever side has room; hide it when we're mid-drag.
  const taglineOnLeft = pos.x + BUTTON_SIZE / 2 > window.innerWidth / 2;

  return (
    <div
      className="fixed z-50 select-none"
      style={{ left: pos.x, top: pos.y, width: BUTTON_SIZE, height: BUTTON_SIZE }}
    >
      <button
        type="button"
        aria-label={`Jarvis — ${JARVIS_FAB_TAGLINE}`}
        title={`Jarvis — ${JARVIS_FAB_TAGLINE}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={`w-14 h-14 rounded-full gradient-primary shadow-xl flex items-center justify-center text-primary-foreground transition-transform ${
          dragging ? "scale-110 cursor-grabbing" : "cursor-grab hover:scale-105 active:scale-95"
        }`}
        style={{ touchAction: "none" }}
      >
        <Bot className="w-7 h-7" />
      </button>
      {!dragging && (
        <button
          type="button"
          onClick={() => navigate("/jarvis")}
          className={`absolute top-1/2 -translate-y-1/2 bg-card border border-border shadow-md rounded-full px-3 py-1.5 text-xs font-medium text-foreground whitespace-nowrap ${
            taglineOnLeft ? "right-full mr-2" : "left-full ml-2"
          }`}
        >
          {JARVIS_FAB_TAGLINE}
        </button>
      )}
    </div>
  );
};


export default JarvisFloatingButton;
