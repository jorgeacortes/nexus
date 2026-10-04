import { CircleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** The "whose court is the ball in?" signal — orthogonal to status. */
export function NeedsHumanBadge({ reason, className }: { reason?: string | null; className?: string }) {
  return (
    <Badge
      className={cn("gap-1 border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300", className)}
      title={reason ?? "Needs human action"}
    >
      <CircleAlert className="size-3" />
      Needs human
    </Badge>
  );
}
