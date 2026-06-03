import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MessagesSquare } from "lucide-react";

export interface ChatArrivalEventDetail {
  sender: string;
  role?: string;
  preview: string;
}

export const CHAT_ARRIVAL_EVENT = "chat-arrival-flash";

export const emitChatArrival = (detail: ChatArrivalEventDetail) => {
  window.dispatchEvent(new CustomEvent(CHAT_ARRIVAL_EVENT, { detail }));
};

/**
 * Full-screen, non-blocking flash overlay shown on every incoming chat message.
 * - Pulsing primary-color border on screen edges
 * - Floating sender pill at top-center
 * Auto-dismisses after 1.2s. Multiple arrivals stack and refresh the timer.
 */
const ChatArrivalFlash = () => {
  const [active, setActive] = useState<ChatArrivalEventDetail | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ChatArrivalEventDetail>).detail;
      setActive(detail);
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setActive(null), 1400);
    };
    window.addEventListener(CHAT_ARRIVAL_EVENT, handler);
    return () => {
      window.removeEventListener(CHAT_ARRIVAL_EVENT, handler);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  if (!active) return null;

  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-0 z-[9999] flex justify-center"
      style={{ animation: "chat-flash-fade 1.4s ease-out forwards" }}
    >
      {/* Pulsing border */}
      <div
        className="absolute inset-0 border-4 border-primary rounded-none"
        style={{ animation: "chat-flash-pulse 0.55s ease-in-out 2" }}
      />
      {/* Sender pill */}
      <div
        className="mt-4 flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-2 shadow-2xl"
        style={{ animation: "chat-flash-slide 0.35s ease-out" }}
      >
        <MessagesSquare className="w-4 h-4" />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">
            💬 {active.sender}
            {active.role ? ` (${active.role})` : ""}
          </span>
          <span className="text-xs opacity-90 max-w-[60vw] truncate">{active.preview}</span>
        </div>
      </div>
      <style>{`
        @keyframes chat-flash-pulse {
          0%   { box-shadow: inset 0 0 0 0 hsl(var(--primary) / 0.0); opacity: 0.85; }
          50%  { box-shadow: inset 0 0 80px 0 hsl(var(--primary) / 0.55); opacity: 1; }
          100% { box-shadow: inset 0 0 0 0 hsl(var(--primary) / 0.0); opacity: 0.4; }
        }
        @keyframes chat-flash-fade {
          0%, 80% { opacity: 1; }
          100%    { opacity: 0; }
        }
        @keyframes chat-flash-slide {
          from { transform: translateY(-30px); opacity: 0; }
          to   { transform: translateY(0);     opacity: 1; }
        }
      `}</style>
    </div>,
    document.body,
  );
};

export default ChatArrivalFlash;
