import { Bot, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { HARNESS_LABELS } from "@/domain/tasks/task";
import type { TaskDto } from "@/lib/dto";
import { cn } from "@/lib/utils";

type AssigneeFields = Pick<TaskDto, "assignee" | "agentName" | "harness" | "model" | "effort">;

/** Compact "who owns this" chip: you, or one agent with its model/effort. */
export function AssigneeChip({
  task,
  className,
  showDetails = true,
}: {
  task: AssigneeFields;
  className?: string;
  showDetails?: boolean;
}) {
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
    const detail = [task.model, task.effort].filter(Boolean).join(" · ");
    return (
      <Badge
        variant="outline"
        className={cn("gap-1", className)}
        title={[task.agentName, detail].filter(Boolean).join(" — ")}
      >
        <Bot className="size-3" />
        <span>{harness}</span>
        {showDetails && detail ? <span className="text-muted-foreground">{detail}</span> : null}
      </Badge>
    );
  }

  return (
    <Badge variant="ghost" className={cn("text-muted-foreground", className)}>
      Unassigned
    </Badge>
  );
}
