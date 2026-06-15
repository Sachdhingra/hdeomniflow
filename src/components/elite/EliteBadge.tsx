import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

const EliteBadge = ({ className }: { className?: string }) => (
  <span className={cn(
    "inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 text-white text-[10px] font-bold px-2 py-0.5 shadow-sm",
    className,
  )}>
    <Star className="w-3 h-3 fill-current" /> ELITE
  </span>
);

export default EliteBadge;
