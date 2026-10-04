"use client";

import { Activity, Bot, Cpu, FolderGit2, Terminal, TriangleAlert } from "lucide-react";
import { useMemo } from "react";

import { ModelTag } from "@/components/model-tag";
import { Badge } from "@/components/ui/badge";
import { modelLabel } from "@/domain/tasks/model";
import { HARNESS_LABELS } from "@/domain/tasks/task";
import { useLiveAgents } from "@/hooks/use-live-agents";
import type { TaskDto } from "@/lib/dto";
import { AGENT_STATUS_DOT, AGENT_STATUS_LABELS, type LiveAgent, type LiveAgentsPayload } from "@/lib/herdr";
import { cn } from "@/lib/utils";

import { PageHeader } from "../../_components/page-header";
import { AssigneeChip } from "../../board/_components/assignee-chip";
import { COLUMN_META } from "../../board/_components/board-meta";

/** Agents overview: Herdr-visible live state plus agent tasks with no live pane (Cursor, by hand). */
export function AgentsClient({ initialLive, tasks }: { initialLive: LiveAgentsPayload; tasks: TaskDto[] }) {
  const live = useLiveAgents(initialLive);

  const taskByPane = useMemo(() => {
    const map = new Map<string, TaskDto>();
    for (const task of tasks) {
      if (task.herdrPaneId) map.set(task.herdrPaneId, task);
    }
    return map;
  }, [tasks]);

  const workspaces = useMemo(() => {
    const groups = new Map<string, { label: string; agents: LiveAgent[] }>();
    for (const agent of live.agents) {
      const group = groups.get(agent.workspaceId) ?? { label: agent.workspaceLabel || agent.workspaceId, agents: [] };
      group.agents.push(agent);
      groups.set(agent.workspaceId, group);
    }
    return [...groups.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label));
  }, [live.agents]);

  const handTracked = tasks.filter((task) => task.assignee === "agent" && !taskByPane.has(task.herdrPaneId ?? ""));

  return (
    <>
      <PageHeader
        title="Agents"
        description="Live status from Herdr. Assignment (harness, model, effort) lives in SQLite."
        actions={
          <Badge variant={live.available ? "secondary" : "destructive"} className="gap-1">
            <Activity className="size-3" />
            {live.available ? "Herdr connected" : "Herdr unavailable"}
          </Badge>
        }
      />

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 md:p-6">
        {!live.available ? (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <TriangleAlert className="mt-0.5 size-4 text-destructive" />
            <div>
              <p className="font-medium">Herdr is not reachable</p>
              <p className="text-muted-foreground">
                {live.error ?? "The socket did not answer."} Task state still works.
              </p>
            </div>
          </div>
        ) : null}

        {live.agents.length === 0 && live.available ? (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No agents are running in Herdr right now.
          </p>
        ) : null}

        {workspaces.map(([workspaceId, group]) => (
          <section key={workspaceId} className="space-y-2">
            <div className="flex items-center gap-2">
              <FolderGit2 className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">{group.label}</h2>
              <span className="font-mono text-xs text-muted-foreground">{workspaceId}</span>
              <span className="text-xs text-muted-foreground">
                {group.agents.length} agent{group.agents.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="grid gap-2 lg:grid-cols-2">
              {group.agents.map((agent) => {
                const task = taskByPane.get(agent.paneId);
                return (
                  <article key={agent.paneId} className="rounded-xl border border-border bg-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={cn("size-2.5 shrink-0 rounded-full", AGENT_STATUS_DOT[agent.status])} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{agent.terminalTitle || agent.agentKind}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {agent.harness ? HARNESS_LABELS[agent.harness] : agent.agentKind} · {agent.cwd}
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {AGENT_STATUS_LABELS[agent.status]}
                      </Badge>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge variant="ghost" className="gap-1 font-mono text-muted-foreground">
                        <Terminal className="size-3" />
                        {agent.paneId}
                      </Badge>
                      {agent.model ? (
                        <Badge variant="secondary" className="gap-1">
                          <Cpu className="size-3" />
                          {modelLabel(agent.model)}
                          {agent.effort ? <span className="text-muted-foreground">· {agent.effort}</span> : null}
                        </Badge>
                      ) : null}
                      {agent.tabLabel && agent.tabLabel !== "1" ? (
                        <Badge variant="ghost" className="text-muted-foreground">
                          tab {agent.tabLabel}
                        </Badge>
                      ) : null}
                    </div>

                    {task ? (
                      <div className="mt-3 flex items-center gap-2 border-t border-border pt-2">
                        <Bot className="size-3.5 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                        <Badge variant="outline">{COLUMN_META[task.status].label}</Badge>
                      </div>
                    ) : (
                      <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
                        No task linked to this pane.
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        ))}

        {handTracked.length > 0 ? (
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <Bot className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Tracked by hand</h2>
              <span className="text-xs text-muted-foreground">
                agent tasks with no live Herdr pane (Cursor, or a pane that is gone)
              </span>
            </div>
            <div className="grid gap-2 lg:grid-cols-2">
              {handTracked.map((task) => (
                <article key={task.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-medium">{task.title}</p>
                    <Badge variant="outline">{COLUMN_META[task.status].label}</Badge>
                  </div>
                  <div className="mt-2">
                    <AssigneeChip task={task} />
                  </div>
                  <ModelTag task={task} className="mt-1.5" />
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
