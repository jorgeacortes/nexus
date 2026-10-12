"use client";

import { useEffect, useRef, useState } from "react";

import { TASK_STATUSES, type TaskStatus } from "@/domain/tasks/task";
import type { TaskDto } from "@/lib/dto";
import type { LiveAgent } from "@/lib/herdr";
import { linkedPaneState } from "@/lib/pane-link";
import { cn } from "@/lib/utils";

import { COLUMN_META } from "./board-meta";
import { TaskCard } from "./task-card";

/**
 * The phone board: count-first and single-axis, below `md` only. A sticky strip
 * carries all five status counts (the shape the snap-scroll columns lose —
 * a 375px window shows one column of five) and the selected status's cards
 * render as a plain vertical list. Same route, same `byStatus`, same data as the
 * desktop board; the desktop columns are hidden, not re-implemented. The
 * selected status is view state, not URL state — the desktop has no equivalent.
 */
export function PhoneBoard({
  byStatus,
  totalByStatus,
  projectNames,
  liveByPaneId,
  currentByPane,
  onSelectTask,
}: {
  byStatus: Map<TaskStatus, TaskDto[]>;
  /** Counts over every task, so the strip can say how much the filter is hiding. */
  totalByStatus: Map<TaskStatus, number>;
  projectNames: Map<string, string>;
  liveByPaneId: Map<string, LiveAgent>;
  /** Built from every task, so a filter cannot change which card owns a pane. */
  currentByPane: Map<string, TaskDto>;
  onSelectTask: (id: string) => void;
}) {
  const [selected, setSelected] = useState<TaskStatus>("backlog");
  const scroller = useRef<HTMLDivElement>(null);

  // A new status starts at its own top, not where the last one was scrolled to.
  // biome-ignore lint/correctness/useExhaustiveDependencies: rerun when the status changes
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [selected]);

  const tasks = byStatus.get(selected) ?? [];
  const hiddenCount = Math.max(0, (totalByStatus.get(selected) ?? 0) - tasks.length);

  return (
    <div ref={scroller} className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain md:hidden">
      <fieldset
        aria-label="Status"
        className="sticky top-0 z-10 m-0 grid shrink-0 grid-cols-5 gap-1 border-0 border-b border-border bg-background px-2 py-2"
      >
        {TASK_STATUSES.map((status) => {
          const meta = COLUMN_META[status];
          const count = byStatus.get(status)?.length ?? 0;
          const hidden = Math.max(0, (totalByStatus.get(status) ?? 0) - count);
          const active = status === selected;
          return (
            <button
              key={status}
              type="button"
              aria-pressed={active}
              title={hidden > 0 ? `${count} shown, ${hidden} hidden by the filter` : `${meta.label}: ${count}`}
              onClick={() => setSelected(status)}
              className={cn(
                "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1.5 transition-colors",
                active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground",
              )}
            >
              <span className="flex items-baseline gap-1 leading-none">
                <span className={cn("size-1.5 self-center rounded-full", meta.dot, active && "opacity-0")} />
                <span className="text-base font-semibold tabular-nums">{count}</span>
                {hidden > 0 ? (
                  <span
                    className={cn(
                      "text-[9px] tabular-nums",
                      active ? "text-primary-foreground/70" : "text-muted-foreground",
                    )}
                  >
                    +{hidden}
                  </span>
                ) : null}
              </span>
              <span
                className={cn(
                  "w-full text-balance text-center text-[10px] leading-tight",
                  active ? "text-primary-foreground/80" : "text-muted-foreground",
                )}
              >
                {meta.label}
              </span>
            </button>
          );
        })}
      </fieldset>

      <div className="space-y-2 p-3 pb-[calc(0.75rem_+_env(safe-area-inset-bottom,0px))]">
        {tasks.map((task) => {
          const liveAgent = task.herdrPaneId ? liveByPaneId.get(task.herdrPaneId) : undefined;
          return (
            <TaskCard
              key={task.id}
              task={task}
              projectName={task.projectId ? projectNames.get(task.projectId) : undefined}
              liveAgent={liveAgent}
              paneState={linkedPaneState(task, currentByPane, liveAgent !== undefined)}
              onSelect={onSelectTask}
              compact
            />
          );
        })}
        {tasks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
            {hiddenCount > 0
              ? `${hiddenCount} hidden by the filter`
              : `Nothing in ${COLUMN_META[selected].label.toLowerCase()}`}
          </p>
        ) : null}
      </div>
    </div>
  );
}
