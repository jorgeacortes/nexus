"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { toast } from "sonner";

import { TASK_PRIORITY_ORDER, TASK_STATUSES, type TaskStatus } from "@/domain/tasks/task";
import { useLiveAgents } from "@/hooks/use-live-agents";
import { apiFetch } from "@/lib/api";
import type { ProjectDto, TaskDto } from "@/lib/dto";
import type { LiveAgent, LiveAgentsPayload } from "@/lib/herdr";
import { cn } from "@/lib/utils";

import { PageHeader } from "../../_components/page-header";
import { BoardColumn } from "./board-column";
import {
  BOARD_PROJECT_PARAM,
  hrefWithProjectFilter,
  matchesProjectFilter,
  type ProjectFilter,
  parseProjectFilter,
  projectFilterCounts,
} from "./board-filter";
import { BoardFilterBar } from "./board-filter-bar";
import { CreateTaskDialog } from "./create-task-dialog";
import { TaskDetailSheet } from "./task-detail-sheet";

/**
 * The single kanban board. Drag-and-drop PATCHes the task status; the project
 * stays a tag on the card. Cards compose SQLite tasks with live Herdr status by
 * `herdr_pane_id` (polled).
 */
export function BoardClient({
  initialTasks,
  initialProjects,
  initialLive,
}: {
  initialTasks: TaskDto[];
  initialProjects: ProjectDto[];
  initialLive: LiveAgentsPayload;
}) {
  const [tasks, setTasks] = useState<TaskDto[]>(initialTasks);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const live = useLiveAgents(initialLive);
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const projectFilter = useMemo(
    () => parseProjectFilter(searchParams.get(BOARD_PROJECT_PARAM), initialProjects),
    [searchParams, initialProjects],
  );

  // The selection belongs in the URL: a narrowed board survives a refresh and
  // can be shared. replaceState (not push) keeps the History stack clean while
  // clicking through projects, and still updates useSearchParams.
  const setProjectFilter = useCallback(
    (filter: ProjectFilter) => {
      const href = hrefWithProjectFilter(pathname, filter, new URLSearchParams(searchParams.toString()));
      window.history.replaceState(null, "", href);
    },
    [pathname, searchParams],
  );

  const filterCounts = useMemo(() => projectFilterCounts(tasks), [tasks]);

  const liveByPaneId = useMemo(() => {
    const map = new Map<string, LiveAgent>();
    for (const agent of live.agents) {
      if (agent.paneId) map.set(agent.paneId, agent);
    }
    return map;
  }, [live.agents]);

  const projectNames = useMemo(
    () => new Map(initialProjects.map((project) => [project.id, project.name])),
    [initialProjects],
  );

  const visibleTasks = useMemo(
    () => tasks.filter((task) => matchesProjectFilter(task, projectFilter)),
    [tasks, projectFilter],
  );

  const byStatus = useMemo(() => {
    const grouped = new Map<TaskStatus, TaskDto[]>();
    for (const status of TASK_STATUSES) {
      grouped.set(status, []);
    }
    for (const task of visibleTasks) {
      grouped.get(task.status)?.push(task);
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => {
        const pA = TASK_PRIORITY_ORDER[a.priority ?? "normal"] ?? 2;
        const pB = TASK_PRIORITY_ORDER[b.priority ?? "normal"] ?? 2;
        if (pA !== pB) return pA - pB;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    }
    return grouped;
  }, [visibleTasks]);

  // Totals over every task, so a column can say how much the filter is hiding.
  const totalByStatus = useMemo(() => {
    const counts = new Map<TaskStatus, number>();
    for (const status of TASK_STATUSES) {
      counts.set(status, 0);
    }
    for (const task of tasks) {
      counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
    }
    return counts;
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
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
              <span
                className={cn("size-2 rounded-full", live.available ? "bg-emerald-500" : "bg-muted-foreground/40")}
              />
              {live.available ? `${live.agents.length} live agents` : "Herdr unavailable"}
            </span>
            <CreateTaskDialog projects={initialProjects} onCreated={(task) => setTasks((list) => [task, ...list])} />
          </div>
        }
      />
      <BoardFilterBar
        projects={initialProjects}
        counts={filterCounts}
        total={tasks.length}
        visible={visibleTasks.length}
        value={projectFilter}
        onChange={setProjectFilter}
      />
      <DndProvider backend={HTML5Backend}>
        {/* Phone: one column at a time, snapping, with the next column peeking. Desktop: a wrapping-free row. */}
        <div className="flex min-h-0 flex-1 snap-x snap-proximity scroll-p-4 gap-3 overflow-x-auto p-4 md:snap-none md:scroll-p-6 md:p-6">
          {TASK_STATUSES.map((status) => (
            <BoardColumn
              key={status}
              status={status}
              tasks={byStatus.get(status) ?? []}
              hiddenCount={(totalByStatus.get(status) ?? 0) - (byStatus.get(status)?.length ?? 0)}
              projectNames={projectNames}
              liveByPaneId={liveByPaneId}
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
          liveAgent={selected.herdrPaneId ? liveByPaneId.get(selected.herdrPaneId) : undefined}
          onClose={() => setSelectedId(null)}
          onUpdated={(updated) => setTasks((list) => list.map((task) => (task.id === updated.id ? updated : task)))}
          onDeleted={(id) => setTasks((list) => list.filter((task) => task.id !== id))}
        />
      ) : null}
    </>
  );
}
