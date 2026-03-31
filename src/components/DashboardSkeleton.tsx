import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

const StatSkeleton = () => (
  <Card>
    <CardContent className="p-4 flex items-start justify-between">
      <div className="space-y-2 flex-1">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-16" />
      </div>
      <Skeleton className="h-9 w-9 rounded-lg" />
    </CardContent>
  </Card>
);

const CardSkeleton = () => (
  <Card>
    <CardContent className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-3 w-36" />
    </CardContent>
  </Card>
);

export const DashboardSkeleton = () => (
  <div className="space-y-6 animate-in fade-in duration-300">
    <div className="space-y-1">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-64" />
    </div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatSkeleton />
      <StatSkeleton />
      <StatSkeleton />
      <StatSkeleton />
    </div>
    <div className="space-y-3">
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  </div>
);

export const ListSkeleton = () => (
  <div className="space-y-3">
    <CardSkeleton />
    <CardSkeleton />
    <CardSkeleton />
  </div>
);

export default DashboardSkeleton;
