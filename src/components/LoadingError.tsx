import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface LoadingErrorProps {
  message?: string;
  onRetry: () => void;
}

const LoadingError = ({ message = "Data failed to load.", onRetry }: LoadingErrorProps) => (
  <Card className="border-destructive/30 bg-destructive/5">
    <CardContent className="p-6 flex flex-col items-center gap-3 text-center">
      <AlertCircle className="w-8 h-8 text-destructive" />
      <p className="text-sm font-medium text-destructive">{message}</p>
      <Button variant="outline" size="sm" className="gap-2" onClick={onRetry}>
        <RefreshCw className="w-4 h-4" />Tap to Retry
      </Button>
    </CardContent>
  </Card>
);

export default LoadingError;
