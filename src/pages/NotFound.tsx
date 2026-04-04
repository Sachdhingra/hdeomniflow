import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Home } from "lucide-react";

const NotFound = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Auto-redirect to dashboard after 3 seconds
    const timer = setTimeout(() => navigate("/", { replace: true }), 3000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="text-center space-y-4">
        <p className="text-lg text-muted-foreground">This page doesn't exist. Redirecting to dashboard...</p>
        <Button onClick={() => navigate("/", { replace: true })} className="gap-2">
          <Home className="w-4 h-4" />Go to Dashboard
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
