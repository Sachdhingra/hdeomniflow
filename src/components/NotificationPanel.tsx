import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, Truck, AlertCircle, CheckCircle, Info, History } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

const ICON_MAP: Record<string, React.ReactNode> = {
  info: <Info className="w-4 h-4 text-primary" />,
  warning: <AlertCircle className="w-4 h-4 text-warning" />,
  success: <CheckCircle className="w-4 h-4 text-success" />,
  delivery: <Truck className="w-4 h-4 text-primary" />,
};

const NotificationPanel = () => {
  const { user } = useAuth();
  const { notifications, markNotificationRead } = useData();
  const [showHistory, setShowHistory] = useState(false);

  const myNotifications = notifications
    .filter(n => n.user_id === user?.id || user?.role === "admin")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const unreadNotifications = myNotifications.filter(n => !n.read);
  const readNotifications = myNotifications.filter(n => n.read);
  const displayList = showHistory ? readNotifications : unreadNotifications;
  const unreadCount = unreadNotifications.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center bg-destructive text-destructive-foreground text-xs">
              {unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-sm">{showHistory ? "History" : "Notifications"}</h3>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowHistory(!showHistory)}>
            <History className="w-3 h-3" />{showHistory ? "Unread" : "History"}
          </Button>
        </div>
        <ScrollArea className="max-h-80">
          {displayList.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4 text-center">
              {showHistory ? "No past notifications" : "All caught up! 🎉"}
            </p>
          ) : (
            displayList.map(n => (
              <div
                key={n.id}
                onClick={() => { if (!n.read) markNotificationRead(n.id); }}
                className={`p-3 border-b border-border cursor-pointer hover:bg-muted/50 transition-colors flex items-start gap-2 ${!n.read ? "bg-primary/5" : ""}`}
              >
                {ICON_MAP[n.type] || ICON_MAP.info}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${!n.read ? "font-medium" : ""}`}>{n.message}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(n.created_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                  </p>
                </div>
                {!n.read && <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />}
              </div>
            ))
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationPanel;
