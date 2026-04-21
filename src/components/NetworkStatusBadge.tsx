import { useEffect, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";

const NetworkStatusBadge = () => {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (online) {
    return (
      <span
        className="hidden sm:inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success"
        title="Online"
      >
        <Wifi className="h-3 w-3" />
        Online
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
      title="Offline"
    >
      <WifiOff className="h-3 w-3" />
      Offline
    </span>
  );
};

export default NetworkStatusBadge;
