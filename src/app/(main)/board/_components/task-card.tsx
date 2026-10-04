"use client";

import { useDrag } from "react-dnd";

import { Badge } from "@/components/ui/badge";
import { dndRef } from "@/lib/dnd";
import type { TaskDto } from "@/lib/dto";
import { cn } from "@/lib/utils";

import { AssigneeChip } from "./assignee-chip";
import { NeedsHumanBadge } from "./needs-human-badge";

export const TASK_DRAG_TYPE = "nexus-task";

/** A draggable kanban card. The card is the task; the project is only a tag. */
export function TaskCard({
  task,
  projectName,
  onSelect,
}: {
  task: TaskDto;
  projectName?: string;
  onSelect: (id: string) => void;
}) {
  const [{ isDragging }, drag] = useDrag(
    () => ({
      type: TASK_DRAG_TYPE,
      item: { id: task.id },
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }),
    [task.id],
  );

  return (
    <button
      ref={dndRef<HTMLButtonElement>(drag)}
      type="button"
      onClick={() => onSelect(task.id)}
      className={cn(
        "w-full cursor-grab rounded-xl border border-border bg-card p-3 text-left text-card-foreground shadow-xs transition-colors",
        "hover:border-ring/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        isDragging && "opacity-40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">{task.title}</p>
        {task.needsHuman ? <NeedsHumanBadge reason={task.needsHumanReason} /> : null}
      </div>

      {task.description ? (
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{task.description}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {projectName ? (
          <Badge variant="outline" className="max-w-full truncate text-muted-foreground">
            {projectName}
          </Badge>
        ) : null}
        <AssigneeChip task={task} />
      </div>
    </button>
  );
}
