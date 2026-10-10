import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bot, Maximize2, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { coachMessagesTable, useStaffCoach, type CoachMessage } from "@/hooks/useStaffCoach";
import CoachPanel from "@/components/coach/CoachPanel";

// A check-in older than this is stale — don't pop up for it when the app opens.
const FRESH_MS = 3 * 60 * 60 * 1000;

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });

// The newest coach check-in the rep hasn't opened or answered yet.
function pendingCheckin(messages: CoachMessage[]): CoachMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.sender === "staff") return null; // they've already replied
    if (m.kind === "checkin") {
      return !m.read_at && Date.now() - new Date(m.created_at).getTime() < FRESH_MS ? m : null;
    }
  }
  return null;
}

const CoachPopupInner = ({ userId, userName }: { userId: string; userName: string }) => {
  const coach = useStaffCoach(userId);
  const { messages, voiceOn, speakMessage, stopVoice } = coach;
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const shownRef = useRef<Set<string>>(new Set());
  const onCoachPage = location.pathname === "/my-day";

  useEffect(() => {
    if (onCoachPage || open) return;
    const m = pendingCheckin(messages);
    if (!m || shownRef.current.has(m.id)) return;
    shownRef.current.add(m.id);
    setOpen(true);
    try {
      navigator.vibrate?.([120, 60, 120]);
    } catch {
      // vibration unsupported
    }
    // Read it aloud only if the rep has already opted in to voice.
    if (voiceOn) speakMessage(m);
  }, [messages, onCoachPage, open, voiceOn, speakMessage]);

  // Landing on the full page, or a reply arriving, closes the popup.
  useEffect(() => {
    if (onCoachPage && open) setOpen(false);
  }, [onCoachPage, open]);

  const close = useCallback(() => {
    stopVoice();
    setOpen(false);
    coachMessagesTable()
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("sender", "agent")
      .is("read_at", null)
      .then(() => undefined);
  }, [stopVoice, userId]);

  if (!open) return null;

  const current = pendingCheckin(messages) ?? messages.filter(m => m.kind === "checkin").slice(-1)[0];

  return (
    <div
      role="dialog"
      aria-label="Coach check-in"
      className="fixed z-[60] inset-x-0 bottom-0 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[26rem] max-h-[85vh] flex flex-col bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-8 fade-in duration-300"
    >
      <header className="px-4 py-3 border-b border-border flex items-center gap-3 bg-primary/5">
        <div className="relative">
          <span className="absolute inset-0 rounded-full bg-primary/30 animate-ping" />
          <div className="relative w-10 h-10 rounded-full gradient-primary flex items-center justify-center text-primary-foreground">
            <Bot className="w-5 h-5" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold leading-tight">Hey {userName} 👋</div>
          <div className="text-xs text-muted-foreground">
            Your coach check-in{current ? ` · ${timeLabel(current.created_at)}` : ""}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="Open full chat"
          aria-label="Open full chat"
          onClick={() => {
            close();
            navigate("/my-day");
          }}
        >
          <Maximize2 className="w-4 h-4" />
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-8" onClick={close}>
          <X className="w-4 h-4 mr-1" /> Later
        </Button>
      </header>
      <CoachPanel coach={coach} variant="popup" limit={4} />
    </div>
  );
};

// Mounted once in the app layout. Sales reps get a popup whenever a coach
// check-in lands (realtime) or is waiting when they open the app.
const CoachPopup = () => {
  const { user } = useAuth();
  if (!user || user.role !== "sales") return null;
  return <CoachPopupInner userId={user.id} userName={user.name.split(" ")[0]} />;
};

export default CoachPopup;
