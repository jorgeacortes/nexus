"use client";

import { CircleAlert, MessageSquare, Send, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { CopyButton } from "@/components/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { PROMPTABLE_HARNESSES } from "@/domain/tasks/task";
import { useLiveAgents } from "@/hooks/use-live-agents";
import { apiFetch } from "@/lib/api";
import type { ProjectDto, TaskDto } from "@/lib/dto";
import { AGENT_STATUS_DOT, AGENT_STATUS_LABELS, type LiveAgent, type LiveAgentsPayload } from "@/lib/herdr";
import { cn } from "@/lib/utils";

import { PageHeader } from "../../_components/page-header";
import { AssigneeChip } from "../../board/_components/assignee-chip";
import { COLUMN_META } from "../../board/_components/board-meta";
import { NeedsHumanBadge } from "../../board/_components/needs-human-badge";

/** Harnesses Nexus can prompt back through Herdr; Cursor resolves by hand. */
function canPrompt(task: TaskDto): boolean {
  return Boolean(task.herdrPaneId) && task.harness !== null && PROMPTABLE_HARNESSES.includes(task.harness);
}

/** Inbox: tasks whose ball is in the operator's court, agent-blocked suggestions, and triage. */
export function InboxClient({
  initialTasks,
  projects,
  initialLive,
}: {
  initialTasks: TaskDto[];
  projects: ProjectDto[];
  initialLive: LiveAgentsPayload;
}) {
  const [tasks, setTasks] = useState<TaskDto[]>(initialTasks);
  const [resolving, setResolving] = useState<TaskDto | null>(null);
  const live = useLiveAgents(initialLive);

  const liveByPaneId = useMemo(() => {
    const map = new Map<string, LiveAgent>();
    for (const agent of live.agents) {
      if (agent.paneId) map.set(agent.paneId, agent);
    }
    return map;
  }, [live.agents]);

  const needsYou = tasks.filter((task) => task.needsHuman);
  const suggested = tasks.filter((task) => {
    if (task.needsHuman || !task.herdrPaneId) return false;
    return liveByPaneId.get(task.herdrPaneId)?.status === "blocked";
  });
  const suggestedIds = new Set(suggested.map((task) => task.id));
  const triage = tasks.filter((task) => !task.projectId && !task.needsHuman && !suggestedIds.has(task.id));

  function replace(updated: TaskDto) {
    setTasks((list) => list.map((task) => (task.id === updated.id ? updated : task)));
  }

  async function flag(task: TaskDto) {
    try {
      const updated = await apiFetch<TaskDto>(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ needsHuman: true, needsHumanReason: "Linked agent reported blocked" }),
      });
      replace(updated);
      toast.success("Flagged as needing human");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not flag the task");
    }
  }

  async function assignProject(task: TaskDto, projectId: string) {
    try {
      const updated = await apiFetch<TaskDto>(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ projectId: projectId === "" ? null : projectId }),
      });
      replace(updated);
      toast.success("Project tag updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the project tag");
    }
  }

  return (
    <>
      <PageHeader
        title="Inbox"
        description="Whose court is the ball in? Resolve, unblock, and triage."
        actions={
          <Badge variant={needsYou.length > 0 ? "default" : "secondary"} className="gap-1">
            <CircleAlert className="size-3" />
            {needsYou.length} awaiting you
          </Badge>
        }
      />

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 md:p-6">
        <section className="space-y-2">
          <SectionHeading icon={CircleAlert} title="Needs you" count={needsYou.length} />
          {needsYou.length === 0 ? (
            <EmptyLine>Nothing is waiting on you.</EmptyLine>
          ) : (
            <div className="space-y-2">
              {needsYou.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  liveAgent={task.herdrPaneId ? liveByPaneId.get(task.herdrPaneId) : undefined}
                  projectName={projectName(projects, task.projectId)}
                  actions={
                    <Button size="sm" onClick={() => setResolving(task)}>
                      <Send />
                      {canPrompt(task) ? "Unblock" : "Resolve"}
                    </Button>
                  }
                />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <SectionHeading icon={TriangleAlert} title="Suggested — agent blocked" count={suggested.length} />
          {suggested.length === 0 ? (
            <EmptyLine>No linked agent reports blocked.</EmptyLine>
          ) : (
            <div className="space-y-2">
              {suggested.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  liveAgent={task.herdrPaneId ? liveByPaneId.get(task.herdrPaneId) : undefined}
                  projectName={projectName(projects, task.projectId)}
                  actions={
                    <Button size="sm" variant="outline" onClick={() => flag(task)}>
                      <CircleAlert />
                      Flag
                    </Button>
                  }
                />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <SectionHeading icon={MessageSquare} title="No project — triage" count={triage.length} />
          {triage.length === 0 ? (
            <EmptyLine>Every task has a project tag.</EmptyLine>
          ) : (
            <div className="space-y-2">
              {triage.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  liveAgent={task.herdrPaneId ? liveByPaneId.get(task.herdrPaneId) : undefined}
                  projectName={projectName(projects, task.projectId)}
                  actions={
                    <NativeSelect
                      className="w-44"
                      size="sm"
                      value=""
                      onChange={(event) => assignProject(task, event.target.value)}
                    >
                      <NativeSelectOption value="">Tag a project…</NativeSelectOption>
                      {projects.map((project) => (
                        <NativeSelectOption key={project.id} value={project.id}>
                          {project.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  }
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {resolving ? (
        <ResolveDialog
          key={resolving.id}
          task={resolving}
          onOpenChange={(open) => (open ? undefined : setResolving(null))}
          onResolved={(updated) => {
            replace(updated);
            setResolving(null);
          }}
        />
      ) : null}
    </>
  );
}

function projectName(projects: ProjectDto[], projectId: string | null): string | undefined {
  return projectId ? projects.find((project) => project.id === projectId)?.name : undefined;
}

function SectionHeading({ icon: Icon, title, count }: { icon: typeof CircleAlert; title: string; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 text-muted-foreground" />
      <h2 className="text-sm font-semibold">{title}</h2>
      <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{count}</span>
    </div>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function TaskRow({
  task,
  liveAgent,
  projectName: name,
  actions,
}: {
  task: TaskDto;
  liveAgent?: LiveAgent;
  projectName?: string;
  actions: React.ReactNode;
}) {
  return (
    <article className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{task.title}</p>
          {task.needsHuman ? <NeedsHumanBadge reason={task.needsHumanReason} /> : null}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{COLUMN_META[task.status].label}</Badge>
          {name ? <Badge variant="ghost">{name}</Badge> : null}
          <AssigneeChip task={task} />
          {liveAgent ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className={cn("size-1.5 rounded-full", AGENT_STATUS_DOT[liveAgent.status])} />
              {AGENT_STATUS_LABELS[liveAgent.status]}
            </span>
          ) : null}
          <CopyButton value={task.id} size="icon-xs" title="Copy task ID" toastMessage="Task ID copied" />
        </div>
        {task.needsHuman && task.needsHumanReason ? (
          <p className="mt-1.5 text-xs text-muted-foreground">{task.needsHumanReason}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </article>
  );
}

function ResolveDialog({
  task,
  onOpenChange,
  onResolved,
}: {
  task: TaskDto;
  onOpenChange: (open: boolean) => void;
  onResolved: (task: TaskDto) => void;
}) {
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const promptable = canPrompt(task);

  async function submit() {
    setSaving(true);
    try {
      const updated = await apiFetch<TaskDto>(`/api/tasks/${task.id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ message: message.trim() || null }),
      });
      onResolved(updated);
      toast.success(promptable ? "Agent prompted and flag cleared" : "Flag cleared");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not resolve the task");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Resolve “{task.title}”</DialogTitle>
          <DialogDescription>
            {promptable
              ? "Nexus sends this message to the agent on the linked Herdr pane, then clears the flag."
              : "No promptable terminal pane is linked, so this only clears the flag — resolve it by hand."}
          </DialogDescription>
        </DialogHeader>
        {promptable ? (
          <Textarea
            value={message}
            rows={3}
            placeholder="Optional message back to the agent…"
            onChange={(event) => setMessage(event.target.value)}
          />
        ) : null}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={saving} onClick={submit}>
            {saving ? "Resolving…" : promptable ? "Send & clear" : "Clear flag"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
