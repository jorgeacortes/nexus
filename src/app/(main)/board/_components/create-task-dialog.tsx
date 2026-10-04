"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { TASK_STATUSES, type TaskStatus } from "@/domain/tasks/task";
import { apiFetch } from "@/lib/api";
import type { ProjectDto, TaskDto } from "@/lib/dto";

import { AssignmentFields, type AssignmentValue, EMPTY_ASSIGNMENT_VALUE } from "./assignment-fields";
import { COLUMN_META } from "./board-meta";

/** Creates a task from the board. Project is optional (dump-and-triage inbox). */
export function CreateTaskDialog({
  projects,
  onCreated,
}: {
  projects: ProjectDto[];
  onCreated: (task: TaskDto) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState<TaskStatus>("backlog");
  const [assignment, setAssignment] = useState<AssignmentValue>(EMPTY_ASSIGNMENT_VALUE);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      const task = await apiFetch<TaskDto>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title,
          description: description.trim() === "" ? null : description,
          projectId: projectId === "" ? null : projectId,
          status,
          ...assignment,
        }),
      });
      onCreated(task);
      toast.success("Task created");
      setOpen(false);
      setTitle("");
      setDescription("");
      setProjectId("");
      setStatus("backlog");
      setAssignment(EMPTY_ASSIGNMENT_VALUE);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the task");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus />
          New task
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>An actionable unit, done by you or one agent.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-task-title">Title</Label>
            <Input
              id="new-task-title"
              value={title}
              placeholder="Implement TAVILY support"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-task-description">Description</Label>
            <Textarea
              id="new-task-description"
              value={description}
              rows={3}
              placeholder="Optional context"
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-task-project">Project</Label>
              <NativeSelect
                id="new-task-project"
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
              <Label htmlFor="new-task-status">Status</Label>
              <NativeSelect
                id="new-task-status"
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

          <AssignmentFields value={assignment} onChange={setAssignment} />
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={saving || title.trim() === ""} onClick={submit}>
            {saving ? "Creating…" : "Create task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
