import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useVoiceReminder } from "@/hooks/useVoiceReminder";
import { VOICE_REMINDER_ROLES } from "@/lib/voiceReminder";
import {
  JARVIS_BRIEFING_OPTOUT_KEY,
  briefingPlayedKey,
  shouldPlayBriefing,
} from "@/lib/jarvis";
import { Button } from "@/components/ui/button";
import { Volume2, Square, Loader2, Play, X } from "lucide-react";

// Auto-plays the Gemini voice briefing (overdue leads, follow-ups, today's
// jobs, pending approvals — scoped to the user's role) on the first app open
// of each day. Browsers may block audio that starts without a fresh tap, so
// the banner keeps a Play button as the fallback.
const MorningBriefing = () => {
  const { user } = useAuth();
  const { play, stop, loading, playing, script } = useVoiceReminder();
  const [visible, setVisible] = useState(false);
  const [everPlayed, setEverPlayed] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (playing) setEverPlayed(true);
  }, [playing]);

  // Finished naturally after having played → slip away quietly.
  useEffect(() => {
    if (everPlayed && !playing && !loading) {
      const t = setTimeout(() => setVisible(false), 4000);
      return () => clearTimeout(t);
    }
  }, [everPlayed, playing, loading]);

  useEffect(() => {
    if (!user || startedRef.current) return;
    if (!VOICE_REMINDER_ROLES.includes(user.role as (typeof VOICE_REMINDER_ROLES)[number])) return;
    try {
      if (localStorage.getItem(JARVIS_BRIEFING_OPTOUT_KEY) === "on") return;
      const key = briefingPlayedKey(user.id);
      const today = new Date().toISOString().slice(0, 10);
      if (!shouldPlayBriefing(localStorage.getItem(key), today)) return;
      // Mark before playing so a blocked autoplay doesn't nag on every reload.
      localStorage.setItem(key, today);
    } catch {
      return; // no storage → can't rate-limit to once a day, so skip
    }
    startedRef.current = true;
    setVisible(true);
    play();
  }, [user, play]);

  const dismiss = () => {
    stop();
    setVisible(false);
  };

  const optOut = () => {
    try {
      localStorage.setItem(JARVIS_BRIEFING_OPTOUT_KEY, "on");
    } catch {
      // storage unavailable — opt-out just won't persist
    }
    dismiss();
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100vw-2rem)] max-w-md">
      <div className="bg-card border border-border shadow-xl rounded-lg p-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center text-primary-foreground shrink-0">
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Volume2 className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">Daily briefing</div>
          <div className="text-xs text-muted-foreground truncate">
            {loading
              ? "Preparing today's briefing…"
              : playing
                ? "Playing — your day at a glance"
                : everPlayed
                  ? "That's your briefing. Have a great day!"
                  : "Tap play to hear your day at a glance"}
          </div>
        </div>
        {playing ? (
          <Button variant="destructive" size="sm" className="gap-1 shrink-0" onClick={stop}>
            <Square className="w-4 h-4" /> Stop
          </Button>
        ) : (
          !loading &&
          !everPlayed && (
            <Button size="sm" className="gradient-primary gap-1 shrink-0" onClick={() => play()}>
              <Play className="w-4 h-4" /> Play
            </Button>
          )
        )}
        <button
          type="button"
          onClick={dismiss}
          className="text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Dismiss briefing"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="text-center mt-1">
        <button
          type="button"
          onClick={optOut}
          className="text-[11px] text-muted-foreground hover:text-foreground underline"
        >
          Don't auto-play this daily
        </button>
      </div>
      {script && !playing && !loading && (
        <div className="mt-2 bg-card border border-border rounded-lg p-3 text-xs text-muted-foreground max-h-32 overflow-y-auto whitespace-pre-wrap">
          {script}
        </div>
      )}
    </div>
  );
};

export default MorningBriefing;
