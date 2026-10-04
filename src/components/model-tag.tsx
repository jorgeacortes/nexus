import { Cpu } from "lucide-react";

import { modelLabel } from "@/domain/tasks/model";
import type { TaskDto } from "@/lib/dto";
import type { LiveAgent } from "@/lib/herdr";
import { cn } from "@/lib/utils";

type ModelFields = Pick<TaskDto, "assignee" | "agentName" | "model" | "effort" | "herdrPaneId">;

/**
 * The model (and effort) the task's agent is running, on its own line so a long
 * id wraps instead of being truncated — the old chip cut off at 170px, which is
 * exactly what made a provider-prefixed Herdr label unreadable.
 *
 * Precedence: the live session value (already the harness's own ground truth,
 * resolved server-side) wins while the pane is online, then the value stored on
 * the task from the claim. A live agent whose model cannot be resolved renders
 * "Model unknown" instead of nothing, so a blank never reads as "no model"; a
 * card with no agent and no model stays compact. This is a label, not a chip:
 * the owner chip (`AssigneeChip`) must never carry the model again.
 */
export function ModelTag({
  task,
  liveAgent,
  className,
}: {
  task: ModelFields;
  liveAgent?: LiveAgent;
  className?: string;
}) {
  const isAgent = task.assignee === "agent" || Boolean(task.agentName) || Boolean(liveAgent);
  if (!isAgent) return null;

  const model = liveAgent?.model ?? task.model;
  const effort = liveAgent?.effort ?? task.effort;

  if (!model) {
    if (!liveAgent) return null;
    return (
      <span className={cn("inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground/70", className)}>
        <Cpu className="size-2.5 shrink-0" />
        Model unknown
      </span>
    );
  }

  return (
    <span
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] leading-relaxed text-muted-foreground",
        className,
      )}
    >
      <Cpu className="size-2.5 shrink-0" />
      <span className="min-w-0 break-words">{modelLabel(model)}</span>
      {effort ? <span className="text-muted-foreground/80">· {effort}</span> : null}
    </span>
  );
}
