"use client";

import { Cpu } from "lucide-react";
import { useDrag } from "react-dnd";

import { Badge } from "@/components/ui/badge";
import { dndRef } from "@/lib/dnd";
import type { TaskDto } from "@/lib/dto";
import { AGENT_STATUS_DOT, AGENT_STATUS_LABELS, type LiveAgent } from "@/lib/herdr";
import { relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

import { AssigneeChip } from "./assignee-chip";
import { NeedsHumanBadge } from "./needs-human-badge";

export const TASK_DRAG_TYPE = "nexus-task";

const PRIORITY_BADGES: Record<string, { label: string; className: string }> = {
  blocker: {
    label: "Blocker",
    className: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  },
  high: {
    label: "High",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  normal: {
    label: "Normal",
    className: "border-zinc-500/20 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  },
  low: {
    label: "Low",
    className: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  },
  someday: {
    label: "Someday",
    className: "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-400",
  },
};

/** A draggable kanban card. The card is the task; the project is only a tag. */
export function TaskCard({
  task,
  projectName,
  liveAgent,
  onSelect,
}: {
  task: TaskDto;
  projectName?: string;
  liveAgent?: LiveAgent;
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

  const isAgent = task.assignee === "agent" || Boolean(task.agentName) || Boolean(liveAgent);
  const activeModel = liveAgent?.model ?? task.model;
  const activeEffort = liveAgent?.effort ?? task.effort;
  const modelEffort = [activeModel, activeEffort].filter(Boolean).join(" · ");

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
        {task.priority && PRIORITY_BADGES[task.priority] ? (
          <span
            className={cn(
              "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none",
              PRIORITY_BADGES[task.priority].className,
            )}
          >
            {PRIORITY_BADGES[task.priority].label}
          </span>
        ) : null}
        {projectName ? (
          <Badge variant="outline" className="max-w-full truncate text-muted-foreground">
            {projectName}
          </Badge>
        ) : null}
        <AssigneeChip task={task} showDetails={false} />
        {isAgent && modelEffort ? (
          <Badge
            variant="outline"
            className="max-w-[170px] truncate text-[10px] font-normal text-muted-foreground/90 border-border/70 bg-muted/30 gap-1 px-1.5 py-0.5"
            title={modelEffort}
          >
            <Cpu className="size-2.5 shrink-0" />
            <span className="truncate">{modelEffort}</span>
          </Badge>
        ) : null}
        {liveAgent ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", AGENT_STATUS_DOT[liveAgent.status])} />
            {AGENT_STATUS_LABELS[liveAgent.status]}
          </span>
        ) : task.herdrPaneId ? (
          <span className="text-[11px] text-muted-foreground/70">pane offline</span>
        ) : null}
        {task.claimedAt ? (
          <span className="text-[11px] text-muted-foreground/70">claimed {relativeTime(task.claimedAt)}</span>
        ) : null}
      </div>
    </button>
  );
}
