import { usePresence, PresenceStatus } from "@/contexts/PresenceContext";
import { cn } from "@/lib/utils";

interface Props {
  userId: string;
  className?: string;
  showLabel?: boolean;
}

const colorFor = (s: PresenceStatus) =>
  s === "online" ? "bg-emerald-500" : s === "away" ? "bg-amber-400" : "bg-muted-foreground/40";

const labelFor = (s: PresenceStatus) =>
  s === "online" ? "Online" : s === "away" ? "Away" : "Offline";

const PresenceDot = ({ userId, className, showLabel }: Props) => {
  const { presence } = usePresence();
  const status = (presence[userId] ?? "offline") as PresenceStatus;
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span
        className={cn("w-2 h-2 rounded-full shrink-0 ring-1 ring-background", colorFor(status))}
        title={labelFor(status)}
      />
      {showLabel && <span className="text-[10px] text-muted-foreground">{labelFor(status)}</span>}
    </span>
  );
};

export default PresenceDot;
