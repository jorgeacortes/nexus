"use client";

import { CircleAlert, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "@/domain/tasks/task";
import { apiFetch } from "@/lib/api";
import type { ProjectDto, TaskDto } from "@/lib/dto";
import type { LiveAgent } from "@/lib/herdr";
import { relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

import { AssignmentFields, type AssignmentValue } from "./assignment-fields";
import { COLUMN_META } from "./board-meta";

/** Slide-over editor for a single task: content, project tag, assignment, and the human flag. */
export function TaskDetailSheet({
  task,
  projects,
  liveAgent,
  onClose,
  onUpdated,
  onDeleted,
}: {
  task: TaskDto | null;
  projects: ProjectDto[];
  liveAgent?: LiveAgent;
  onClose: () => void;
  onUpdated: (task: TaskDto) => void;
  onDeleted: (id: string) => void;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [projectId, setProjectId] = useState(task?.projectId ?? "");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "backlog");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "normal");
  const [assignment, setAssignment] = useState<AssignmentValue>({
    assignee: task?.assignee ?? null,
    harness: task?.harness ?? null,
    model: task?.model ?? null,
    effort: task?.effort ?? null,
  });
  const [needsHuman, setNeedsHuman] = useState(task?.needsHuman ?? false);
  const [needsHumanReason, setNeedsHumanReason] = useState(task?.needsHumanReason ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!task) return;
    setSaving(true);
    try {
      const updated = await apiFetch<TaskDto>(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title,
          description: description.trim() === "" ? null : description,
          projectId: projectId === "" ? null : projectId,
          status,
          priority,
          ...assignment,
          needsHuman,
          needsHumanReason: needsHuman ? needsHumanReason || null : null,
        }),
      });
      onUpdated(updated);
      toast.success("Task saved");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the task");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!task) return;
    setSaving(true);
    try {
      await apiFetch<{ id: string }>(`/api/tasks/${task.id}`, { method: "DELETE" });
      onDeleted(task.id);
      toast.success("Task deleted");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the task");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={task !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="right" className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Task</SheetTitle>
          <SheetDescription>Edit the card, its project tag, and who owns it.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {liveAgent?.status === "blocked" && !needsHuman ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-300" />
              <p className="flex-1 text-muted-foreground">
                The linked agent on <span className="font-mono">{liveAgent.paneId}</span> reports{" "}
                <span className="font-medium text-foreground">blocked</span>. Flag it as needing you?
              </p>
              <Button size="sm" variant="outline" onClick={() => setNeedsHuman(true)}>
                Flag
              </Button>
            </div>
          ) : null}

          <div className="space-y-1.5">
            {/* Not a <Label>: a <code> is not labelable, so the heading is plain text. */}
            <p className="text-sm leading-none font-medium select-none">Task ID</p>
            <div className="flex items-center gap-2">
              <code
                id="detail-id"
                className="min-w-0 flex-1 select-all break-all rounded-md border border-border bg-muted/40 px-2 py-1.5 font-mono text-xs leading-relaxed text-muted-foreground"
              >
                {task?.id}
              </code>
              <CopyButton
                value={task?.id ?? ""}
                label="Copy"
                variant="outline"
                size="sm"
                title="Copy task ID"
                toastMessage="Task ID copied"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="detail-title">Title</Label>
            <Input id="detail-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="detail-description">Description</Label>
            <Textarea
              id="detail-description"
              value={description}
              rows={4}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="detail-project">Project</Label>
              <NativeSelect
                id="detail-project"
                className="w-full"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <NativeSelectOption value="">No project</NativeSelectOption>
                {projects.map((project) => (
                  <NativeSelectOption key={project.id} value={project.id}>
                    {project.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="detail-status">Status</Label>
              <NativeSelect
                id="detail-status"
                className="w-full"
                value={status}
                onChange={(event) => setStatus(event.target.value as TaskStatus)}
              >
                {TASK_STATUSES.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {COLUMN_META[value].label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="detail-priority">Priority</Label>
              <NativeSelect
                id="detail-priority"
                className="w-full"
                value={priority}
                onChange={(event) => setPriority(event.target.value as TaskPriority)}
              >
                {TASK_PRIORITIES.map((val) => (
                  <NativeSelectOption key={val} value={val}>
                    {TASK_PRIORITY_LABELS[val]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>

          <Separator />

          <AssignmentFields value={assignment} onChange={setAssignment} />

          {task?.herdrPaneId ? (
            <p className="text-xs text-muted-foreground">
              Linked Herdr pane: <span className="font-mono">{task.herdrPaneId}</span>
            </p>
          ) : null}

          {task?.claimedAt || task?.completedAt ? (
            <p className="text-xs text-muted-foreground">
              {task.claimedAt ? <>Claimed {relativeTime(task.claimedAt)}</> : null}
              {task.completedAt ? (
                <>
                  {task.claimedAt ? " · " : ""}
                  Completed {relativeTime(task.completedAt)}
                </>
              ) : null}
            </p>
          ) : null}

          {task?.completionNotes ? (
            <p className="text-xs text-muted-foreground">Notes: {task.completionNotes}</p>
          ) : null}

          <Separator />

          <div className="space-y-2">
            <Button
              type="button"
              variant={needsHuman ? "default" : "outline"}
              size="sm"
              aria-pressed={needsHuman}
              className={cn(needsHuman && "bg-amber-500 text-amber-950 hover:bg-amber-500/90")}
              onClick={() => setNeedsHuman((value) => !value)}
            >
              <CircleAlert />
              {needsHuman ? "Needs human" : "Flag as needing human"}
            </Button>
            {needsHuman ? (
              <div className="space-y-1.5">
                <Label htmlFor="detail-reason">Reason</Label>
                <Input
                  id="detail-reason"
                  value={needsHumanReason}
                  placeholder="Waiting on a decision, key, review…"
                  onChange={(event) => setNeedsHumanReason(event.target.value)}
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border p-4">
          <Button variant="destructive" size="sm" disabled={saving} onClick={remove}>
            <Trash2 />
            Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" disabled={saving || title.trim() === ""} onClick={save}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
