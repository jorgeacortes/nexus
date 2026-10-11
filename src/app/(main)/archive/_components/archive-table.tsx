import { format } from "date-fns";

import { modelLabel } from "@/domain/tasks/model";
import { HARNESS_LABELS, TASK_PRIORITY_LABELS, type TaskPriority } from "@/domain/tasks/task";
import type { ProjectDto, TaskDto } from "@/lib/dto";
import { relativeTime } from "@/lib/time";

import { PageHeader } from "../../_components/page-header";
import { UnarchiveButton } from "./unarchive-button";

/**
 * Read-only archive. The row keeps the title, project, priority, who ran it,
 * when it was claimed and completed, and the completion notes. The only write
 * is Unarchive, which returns the task to Ready.
 */
export function ArchiveTable({ tasks, projects }: { tasks: TaskDto[]; projects: ProjectDto[] }) {
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const description =
    tasks.length === 0
      ? "Done work stays on the board for 7 days, then moves here. Nothing is deleted."
      : `${tasks.length} archived ${tasks.length === 1 ? "task" : "tasks"}. Nothing here is deleted.`;

  return (
    <>
      <PageHeader title="Archive" description={description} />
      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
        {tasks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No archived tasks yet.
          </p>
        ) : (
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <caption className="sr-only">Archived tasks</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Project</th>
                <th className="px-3 py-2 font-medium">Priority</th>
                <th className="px-3 py-2 font-medium">Agent</th>
                <th className="px-3 py-2 font-medium">Claimed</th>
                <th className="px-3 py-2 font-medium">Completed</th>
                <th className="px-3 py-2 font-medium">Notes</th>
                <th className="px-3 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id} className="border-b border-border/70 align-top">
                  <td className="max-w-xs px-3 py-3 font-medium">{task.title}</td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {task.projectId ? (projectNames.get(task.projectId) ?? "—") : "—"}
                  </td>
                  <td className="px-3 py-3">{priorityLabel(task.priority)}</td>
                  <td className="px-3 py-3 text-muted-foreground">{assignmentLabel(task)}</td>
                  <td className="px-3 py-3">
                    <When iso={task.claimedAt} />
                  </td>
                  <td className="px-3 py-3">
                    <When iso={task.completedAt} />
                  </td>
                  <td className="max-w-sm px-3 py-3 text-muted-foreground">
                    {task.completionNotes ? (
                      <p className="whitespace-pre-wrap break-words">{task.completionNotes}</p>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <UnarchiveButton taskId={task.id} title={task.title} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function priorityLabel(priority: TaskPriority): string {
  return TASK_PRIORITY_LABELS[priority] ?? "Normal";
}

function assignmentLabel(task: TaskDto): string {
  if (task.assignee === "me") return "You";
  const who = task.harness ? HARNESS_LABELS[task.harness] : task.agentName;
  const model = task.model ? `${modelLabel(task.model)}${task.effort ? ` · ${task.effort}` : ""}` : null;
  const label = [who, model].filter((part) => part && part.length > 0).join(" · ");
  return label || "—";
}

function When({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-muted-foreground">—</span>;
  return (
    <time dateTime={iso} title={iso} className="block whitespace-nowrap">
      {format(new Date(iso), "d MMM yyyy")}
      <span className="mt-0.5 block text-[11px] text-muted-foreground">{relativeTime(iso)}</span>
    </time>
  );
}
