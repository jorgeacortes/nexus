"use client";

import { useDrop } from "react-dnd";

import type { TaskStatus } from "@/domain/tasks/task";
import { dndRef } from "@/lib/dnd";
import type { TaskDto } from "@/lib/dto";
import { cn } from "@/lib/utils";

import { COLUMN_META } from "./board-meta";
import { TASK_DRAG_TYPE, TaskCard } from "./task-card";

/** One status column; drops move a task to this status. */
export function BoardColumn({
  status,
  tasks,
  projectNames,
  onDropTask,
  onSelectTask,
}: {
  status: TaskStatus;
  tasks: TaskDto[];
  projectNames: Map<string, string>;
  onDropTask: (taskId: string, status: TaskStatus) => void;
  onSelectTask: (id: string) => void;
}) {
  const meta = COLUMN_META[status];
  const [{ isOver }, drop] = useDrop<{ id: string }, void, { isOver: boolean }>(
    () => ({
      accept: TASK_DRAG_TYPE,
      drop: (item) => onDropTask(item.id, status),
      collect: (monitor) => ({ isOver: monitor.isOver() }),
    }),
    [status, onDropTask],
  );

  return (
    <section className="flex w-[290px] shrink-0 flex-col rounded-xl border border-border bg-muted/30">
      <header className="flex items-center gap-2 px-3 py-2.5">
        <span className={cn("size-2 rounded-full", meta.dot)} />
        <h2 className="text-sm font-semibold">{meta.label}</h2>
        <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{tasks.length}</span>
        <span className="ml-auto hidden text-[11px] text-muted-foreground xl:inline">{meta.hint}</span>
      </header>

      <div
        ref={dndRef<HTMLDivElement>(drop)}
        className={cn("flex-1 space-y-2 overflow-y-auto px-2 pb-3 transition-colors", isOver && "bg-accent/60")}
      >
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            projectName={task.projectId ? projectNames.get(task.projectId) : undefined}
            onSelect={onSelectTask}
          />
        ))}
        {tasks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            Drop a task here
          </p>
        ) : null}
      </div>
    </section>
  );
}
