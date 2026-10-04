"use client";

import { useCallback, useMemo, useState } from "react";

import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { toast } from "sonner";

import { TASK_STATUSES, type TaskStatus } from "@/domain/tasks/task";
import { apiFetch } from "@/lib/api";
import type { ProjectDto, TaskDto } from "@/lib/dto";

import { PageHeader } from "../../_components/page-header";
import { BoardColumn } from "./board-column";
import { CreateTaskDialog } from "./create-task-dialog";
import { TaskDetailSheet } from "./task-detail-sheet";

/**
 * The single kanban board. Drag-and-drop PATCHes the task status; the project
 * stays a tag on the card. Tasks are composed here, live agent status is layered
 * on later (Phase 3).
 */
export function BoardClient({
  initialTasks,
  initialProjects,
}: {
  initialTasks: TaskDto[];
  initialProjects: ProjectDto[];
}) {
  const [tasks, setTasks] = useState<TaskDto[]>(initialTasks);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const projectNames = useMemo(
    () => new Map(initialProjects.map((project) => [project.id, project.name])),
    [initialProjects],
  );

  const byStatus = useMemo(() => {
    const grouped = new Map<TaskStatus, TaskDto[]>();
    for (const status of TASK_STATUSES) {
      grouped.set(status, []);
    }
    for (const task of tasks) {
      grouped.get(task.status)?.push(task);
    }
    return grouped;
  }, [tasks]);

  const moveTask = useCallback(
    async (taskId: string, status: TaskStatus) => {
      const current = tasks.find((task) => task.id === taskId);
      if (!current || current.status === status) return;
      const previous = tasks;
      setTasks((list) => list.map((task) => (task.id === taskId ? { ...task, status } : task)));
      try {
        const updated = await apiFetch<TaskDto>(`/api/tasks/${taskId}`, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        });
        setTasks((list) => list.map((task) => (task.id === taskId ? updated : task)));
      } catch (error) {
        setTasks(previous);
        toast.error(error instanceof Error ? error.message : "Could not move the task");
      }
    },
    [tasks],
  );

  const selected = tasks.find((task) => task.id === selectedId) ?? null;

  return (
    <>
      <PageHeader
        title="Board"
        description="One board for every project — the project is a tag on the card."
        actions={
          <CreateTaskDialog projects={initialProjects} onCreated={(task) => setTasks((list) => [task, ...list])} />
        }
      />
      <DndProvider backend={HTML5Backend}>
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4 md:p-6">
          {TASK_STATUSES.map((status) => (
            <BoardColumn
              key={status}
              status={status}
              tasks={byStatus.get(status) ?? []}
              projectNames={projectNames}
              onDropTask={moveTask}
              onSelectTask={setSelectedId}
            />
          ))}
        </div>
      </DndProvider>
      {selected ? (
        <TaskDetailSheet
          key={selected.id}
          task={selected}
          projects={initialProjects}
          onClose={() => setSelectedId(null)}
          onUpdated={(updated) => setTasks((list) => list.map((task) => (task.id === updated.id ? updated : task)))}
          onDeleted={(id) => setTasks((list) => list.filter((task) => task.id !== id))}
        />
      ) : null}
    </>
  );
}
