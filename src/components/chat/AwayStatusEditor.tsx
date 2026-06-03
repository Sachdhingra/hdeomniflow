import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoonStar } from "lucide-react";
import { toast } from "sonner";

const AwayStatusEditor = () => {
  const { user } = useAuth();
  const [isAway, setIsAway] = useState(false);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("user_status")
        .select("is_away, away_message")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) {
        setIsAway(!!data.is_away);
        setMsg(data.away_message ?? "");
      }
    })();
  }, [user?.id]);

  const save = async (away: boolean) => {
    if (!user) return;
    const { error } = await supabase.from("user_status").upsert(
      { user_id: user.id, is_away: away, away_message: msg, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    if (error) return toast.error(error.message);
    setIsAway(away);
    toast.success(away ? "Marked as away" : "Back online");
    setOpen(false);
  };

  if (!user) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`h-8 gap-1.5 text-xs ${isAway ? "text-amber-500" : "text-muted-foreground"}`}
          aria-label="Set away status"
        >
          <MoonStar className="w-3.5 h-3.5" />
          {isAway ? "Away" : "Set away"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end">
        <div className="space-y-2">
          <div className="text-sm font-medium">Away message</div>
          <Input
            placeholder="e.g. In a meeting until 4pm"
            value={msg}
            onChange={e => setMsg(e.target.value)}
          />
          <div className="flex gap-2 justify-end">
            {isAway && (
              <Button size="sm" variant="ghost" onClick={() => save(false)}>
                I'm back
              </Button>
            )}
            <Button size="sm" onClick={() => save(true)}>
              Set away
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default AwayStatusEditor;
