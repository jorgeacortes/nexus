"use client";

import { CircleAlert, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { TASK_STATUSES, type TaskStatus } from "@/domain/tasks/task";
import { apiFetch } from "@/lib/api";
import type { ProjectDto, TaskDto } from "@/lib/dto";
import { cn } from "@/lib/utils";

import { AssignmentFields, type AssignmentValue } from "./assignment-fields";
import { COLUMN_META } from "./board-meta";

/** Slide-over editor for a single task: content, project tag, assignment, and the human flag. */
export function TaskDetailSheet({
  task,
  projects,
  onClose,
  onUpdated,
  onDeleted,
}: {
  task: TaskDto | null;
  projects: ProjectDto[];
  onClose: () => void;
  onUpdated: (task: TaskDto) => void;
  onDeleted: (id: string) => void;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [projectId, setProjectId] = useState(task?.projectId ?? "");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "backlog");
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
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Task</SheetTitle>
          <SheetDescription>Edit the card, its project tag, and who owns it.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
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

          <div className="grid grid-cols-2 gap-2">
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
          </div>

          <Separator />

          <AssignmentFields value={assignment} onChange={setAssignment} />

          {task?.herdrPaneId ? (
            <p className="text-xs text-muted-foreground">
              Linked Herdr pane: <span className="font-mono">{task.herdrPaneId}</span>
            </p>
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
