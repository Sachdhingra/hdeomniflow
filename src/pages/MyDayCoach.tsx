import { useEffect } from "react";
import { Bot } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { coachMessagesTable, useStaffCoach } from "@/hooks/useStaffCoach";
import CoachPanel from "@/components/coach/CoachPanel";

const MyDayCoach = () => {
  const { user } = useAuth();
  const coach = useStaffCoach(user?.id);
  const { messages } = coach;

  // Mark the coach's messages read once the page is open.
  useEffect(() => {
    if (!user || !messages.some(m => m.sender === "agent" && !m.read_at)) return;
    coachMessagesTable()
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("sender", "agent")
      .is("read_at", null)
      .then(() => undefined);
  }, [user, messages]);

  if (!user || user.role !== "sales") {
    return (
      <div className="p-6">
        <h1 className="text-xl font-bold mb-2">My Day Coach unavailable</h1>
        <p className="text-muted-foreground">The coach is currently available for sales staff only.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto h-[calc(100vh-7rem)] flex flex-col bg-card border border-border rounded-lg overflow-hidden">
      <header className="px-4 py-3 border-b border-border flex items-center gap-2">
        <div className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center text-primary-foreground">
          <Bot className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <div className="font-semibold">My Day Coach</div>
          <div className="text-xs text-muted-foreground">
            Hi {user.name}! I check in every 2 hours (11 am – 8 pm). Type, tap, or just talk to me — in any language.
          </div>
        </div>
      </header>
      <CoachPanel coach={coach} variant="page" />
    </div>
  );
};

export default MyDayCoach;
