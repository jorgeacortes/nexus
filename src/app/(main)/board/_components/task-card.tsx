"use client";

import { BadgeCheck } from "lucide-react";
import { useDrag } from "react-dnd";
import { ModelTag } from "@/components/model-tag";
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

type TaskCardProps = {
  task: TaskDto;
  projectName?: string;
  liveAgent?: LiveAgent;
  onSelect: (id: string) => void;
};

/**
 * A kanban card. The card is the task; the project is only a tag. `compact` is
 * the phone variant (see `CompactTaskCard`); the desktop card is a drag source
 * and is intentionally left as it was.
 */
export function TaskCard({ compact = false, ...props }: TaskCardProps & { compact?: boolean }) {
  return compact ? <CompactTaskCard {...props} /> : <DraggableTaskCard {...props} />;
}

/** Desktop card. Must stay the drag source it always was. */
function DraggableTaskCard({ task, projectName, liveAgent, onSelect }: TaskCardProps) {
  const [{ isDragging }, drag] = useDrag(
    () => ({
      type: TASK_DRAG_TYPE,
      item: { id: task.id },
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }),
    [task.id],
  );

  const isAgent = task.assignee === "agent" || Boolean(task.agentName) || Boolean(liveAgent);

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

      {/* Its own row: a long model id wraps instead of being truncated. */}
      {isAgent ? <ModelTag task={task} liveAgent={liveAgent} className="mt-1.5" /> : null}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {task.priority && PRIORITY_BADGES[task.priority] ? <PriorityPill priority={task.priority} /> : null}
        {projectName ? (
          <Badge variant="outline" className="max-w-full truncate text-muted-foreground">
            {projectName}
          </Badge>
        ) : null}
        {task.reviewedAt ? (
          <Badge
            variant="outline"
            title={`Reviewed ${new Date(task.reviewedAt).toLocaleString()}`}
            className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          >
            <BadgeCheck className="size-3" />
            Reviewed
          </Badge>
        ) : null}
        <AssigneeChip task={task} />
        {liveAgent ? (
          <LiveStatus status={liveAgent.status} />
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

/**
 * Phone card: title, needs-human badge, harness chip + live status dot, project
 * tag and only non-normal priorities. The description excerpt, the model row,
 * the Reviewed badge and the claimed time move behind the tap (the sheet) —
 * the model never becomes a chip, it simply is not on the card.
 */
function CompactTaskCard({ task, projectName, liveAgent, onSelect }: TaskCardProps) {
  const priority = task.priority && task.priority !== "normal" ? PRIORITY_BADGES[task.priority] : undefined;

  return (
    <button
      type="button"
      onClick={() => onSelect(task.id)}
      className={cn(
        "w-full cursor-pointer rounded-xl border border-border bg-card p-3 text-left text-card-foreground shadow-xs transition-colors",
        "hover:border-ring/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className={cn(
            "text-sm font-medium leading-snug",
            // A needs-human card is the actionable one, so its title gets the third line.
            task.needsHuman ? "line-clamp-3" : "line-clamp-2",
          )}
        >
          {task.title}
        </p>
        {task.needsHuman ? <NeedsHumanBadge reason={task.needsHumanReason} /> : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {priority ? <PriorityPill priority={task.priority ?? "normal"} /> : null}
        {projectName ? (
          <Badge variant="outline" className="max-w-full truncate text-muted-foreground">
            {projectName}
          </Badge>
        ) : null}
        <AssigneeChip task={task} />
        {liveAgent ? <LiveStatus status={liveAgent.status} /> : null}
      </div>
    </button>
  );
}

function PriorityPill({ priority }: { priority: string }) {
  const badge = PRIORITY_BADGES[priority];
  if (!badge) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none",
        badge.className,
      )}
    >
      {badge.label}
    </span>
  );
}

/** The live Herdr status as a dot + word, so "still moving?" reads without a tap. */
function LiveStatus({ status }: { status: LiveAgent["status"] }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <span className={cn("size-1.5 rounded-full", AGENT_STATUS_DOT[status])} />
      {AGENT_STATUS_LABELS[status]}
    </span>
  );
}
