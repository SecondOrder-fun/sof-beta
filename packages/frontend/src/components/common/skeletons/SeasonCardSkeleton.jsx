// src/components/common/skeletons/SeasonCardSkeleton.jsx
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton loader matching ActiveSeasonCard layout
 * Shows animated placeholders while season data loads
 */
const SeasonCardSkeleton = () => {
  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="py-1 pb-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-8" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <Skeleton className="h-3 w-32 mt-1" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2 pt-0">
        {/* Bonding curve chart area */}
        <div className="overflow-hidden rounded-md bg-muted/40">
          <Skeleton className="h-44 w-full" />
        </div>
        {/* Price and buttons row */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-24" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-14 rounded-md" />
            <Skeleton className="h-8 w-14 rounded-md" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default SeasonCardSkeleton;
