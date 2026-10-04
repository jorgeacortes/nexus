import type { TaskStatus } from "@/domain/tasks/task";

/** Column presentation for the single board. Status is "why has work stopped?". */
export const COLUMN_META: Record<TaskStatus, { label: string; hint: string; dot: string }> = {
  backlog: { label: "Backlog", hint: "Not ready yet", dot: "bg-muted-foreground/50" },
  ready: { label: "Ready", hint: "Queued for an agent", dot: "bg-chart-3" },
  in_progress: { label: "In progress", hint: "Being worked", dot: "bg-chart-2" },
  blocked: { label: "Blocked", hint: "Cannot move forward", dot: "bg-destructive" },
  done: { label: "Done", hint: "Awaiting review", dot: "bg-chart-1" },
};
