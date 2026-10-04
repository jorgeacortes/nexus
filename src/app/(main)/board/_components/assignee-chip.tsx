import { Bot, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { HARNESS_LABELS } from "@/domain/tasks/task";
import type { TaskDto } from "@/lib/dto";
import { cn } from "@/lib/utils";

type AssigneeFields = Pick<TaskDto, "assignee" | "agentName" | "harness">;

/**
 * Compact "who owns this" chip: you, or one agent and its harness. The model is
 * deliberately not part of the chip — `ModelTag` gives it its own row, so a long
 * id can wrap instead of being truncated inside a badge.
 */
export function AssigneeChip({ task, className }: { task: AssigneeFields; className?: string }) {
  if (task.assignee === "me") {
    return (
      <Badge variant="secondary" className={cn("gap-1", className)}>
        <UserRound className="size-3" />
        You
      </Badge>
    );
  }

  if (task.assignee === "agent") {
    const harness = task.harness ? HARNESS_LABELS[task.harness] : (task.agentName ?? "Agent");
    return (
      <Badge variant="outline" className={cn("gap-1", className)} title={task.agentName ?? undefined}>
        <Bot className="size-3" />
        <span>{harness}</span>
      </Badge>
    );
  }

  return (
    <Badge variant="ghost" className={cn("text-muted-foreground", className)}>
      Unassigned
    </Badge>
  );
}
