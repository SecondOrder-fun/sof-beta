// src/components/common/skeletons/MobileCardSkeleton.jsx
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Generic mobile card skeleton for carousel views
 * Used by both MobileRafflesList and MobileMarketsList loading states
 */
const MobileCardSkeleton = () => {
  return (
    <Card>
      <CardContent className="py-6 space-y-4">
        {/* Title area */}
        <div className="space-y-2">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
        {/* Chart / content area */}
        <Skeleton className="h-40 w-full rounded-md" />
        {/* Action row */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-24" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-16 rounded-md" />
            <Skeleton className="h-9 w-16 rounded-md" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default MobileCardSkeleton;
