import type { EnsureWorkspaceOutcome, EnsureWorkspaceUseCase } from "@/application/dispatch/ensure-workspace";
import { ProjectReferenceNotFoundError, TaskNotFoundError } from "@/application/tasks/errors";
import {
  DISPATCHABLE_STATUSES,
  type Dispatch,
  DispatchNotDispatchableError,
  DispatchRequiresProjectError,
  DispatchSpawnError,
} from "@/domain/dispatch/dispatch";
import type { DispatchRepository } from "@/domain/dispatch/dispatch.repository";
import type { HarnessPort, HarnessWorkspace } from "@/domain/dispatch/harness";
import {
  agentKindForHarness,
  agentNameForTask,
  choosePlacement,
  expandHome,
  taskTabLabel,
} from "@/domain/dispatch/placement";
import type { DispatchProjectPort } from "@/domain/dispatch/project-workspace";
import type { AgentPromptPort } from "@/domain/tasks/agent-prompt";
import { buildDispatchPrompt } from "@/domain/tasks/dispatch-prompt";
import { agentStateForPane, type LiveAgentInfo, type LiveAgentPort } from "@/domain/tasks/live-agents";
import type { Task } from "@/domain/tasks/task";
import type { TaskRepository } from "@/domain/tasks/task.repository";

export type DispatchPlacementKind = "reused_pane" | "created_tab";

export type DispatchTaskResult = {
  task: Task;
  dispatch: Dispatch;
  workspace: HarnessWorkspace;
  workspaceOutcome: EnsureWorkspaceOutcome;
  matchedBy: "label" | "folder" | null;
  placement: DispatchPlacementKind;
};

export interface DispatchTaskDeps {
  tasks: TaskRepository;
  dispatches: DispatchRepository;
  harness: HarnessPort;
  /** Read side: the project a task belongs to, as a `DispatchProject`. */
  projects: DispatchProjectPort;
  /** Resolves or creates the project's Herdr workspace (DSP-3). */
  ensureWorkspace: EnsureWorkspaceUseCase;
  agentPrompt: AgentPromptPort;
  liveAgents: LiveAgentPort;
  /** Who holds the lease, for the ledger (`host:pid` in production). */
  leaseOwner: string;
  now?: () => Date;
  /** How long an *unstarted* attempt may hold the lease before it can be superseded. */
  leaseTtlMs?: number;
  /** How long to wait for a freshly started agent to become interactive and named. */
  startTimeoutMs?: number;
}

/** A crashed attempt that never started an agent is superseded after this long. */
const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000;

/** Herdr's own CLI default for `agent start --timeout`. */
const DEFAULT_START_TIMEOUT_MS = 30_000;

function isDispatchable(status: string): boolean {
  return (DISPATCHABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * The create flow of DESIGN-dispatch.md:
 *
 * 1. **Lease** the task in one SQLite transaction; refuse while a live dispatch
 *    exists (the lease precedes every side effect, so a racing caller touches no
 *    topology).
 * 2. **Ensure the workspace** for the task's project (DSP-3).
 * 3. **Place** the agent: reuse a bare shell pane in that workspace when it sits
 *    in the task's folder (relabelling that tab with the task), otherwise create
 *    a tab labelled with the task. The tab the agent lands in always carries the
 *    task's label, never Herdr's `1`.
 * 4. **Start** the agent (`<slug>-<short-id>`), unique among live agents.
 * 5. **Assign**: push the dispatch prompt, then record the pane, agent and
 *    harness on the task.
 *
 * A failure after the lease is compensated, never silent: the dispatch row is
 * ended as `failed` (holding the placement if one was reached) and, when
 * topology was already created, the task is flagged for the operator naming the
 * orphan tab. **Nothing is closed on any path** — the guarded close is DSP-5.
 */
export class DispatchTaskUseCase {
  private readonly now: () => Date;
  private readonly leaseTtlMs: number;
  private readonly startTimeoutMs: number;

  constructor(private readonly deps: DispatchTaskDeps) {
    this.now = deps.now ?? (() => new Date());
    this.leaseTtlMs = deps.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    this.startTimeoutMs = deps.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  }

  async execute(id: string): Promise<DispatchTaskResult> {
    const task = await this.deps.tasks.findById(id);
    if (!task) {
      throw new TaskNotFoundError(id);
    }
    if (!isDispatchable(task.status)) {
      throw new DispatchNotDispatchableError(task.status);
    }
    if (!task.projectId) {
      throw new DispatchRequiresProjectError(task.id);
    }
    const project = await this.deps.projects.find(task.projectId);
    if (!project) {
      throw new ProjectReferenceNotFoundError(task.projectId);
    }

    const acquiredAt = this.now();
    const dispatch = await this.deps.dispatches.acquireLease({
      taskId: task.id,
      leaseOwner: this.deps.leaseOwner,
      now: acquiredAt,
      leaseUntil: new Date(acquiredAt.getTime() + this.leaseTtlMs),
    });

    let orphan: { tabId: string | null; paneId: string } | null = null;
    try {
      const ensured = await this.deps.ensureWorkspace.execute(project);
      const folder = project.folderPath ? expandHome(project.folderPath) : null;
      const panes = await this.deps.harness.listPanes(ensured.workspace.workspaceId);
      const placement = choosePlacement(panes, folder);
      const tabLabel = taskTabLabel(task.title);

      let paneId: string;
      let tabId: string | null;
      let placed: DispatchPlacementKind;
      if (placement.kind === "reuse") {
        paneId = placement.pane.paneId;
        tabId = placement.pane.tabId || null;
        placed = "reused_pane";
      } else {
        const created = await this.deps.harness.createTab(ensured.workspace.workspaceId, tabLabel, folder);
        paneId = created.rootPane.paneId;
        tabId = created.tab.tabId;
        placed = "created_tab";
      }
      // Record the place the moment it exists: whatever fails next, the tab is
      // in the ledger rather than an unrecorded orphan.
      orphan = { tabId, paneId };
      await this.deps.dispatches.recordPlacement(dispatch.id, {
        workspaceId: ensured.workspace.workspaceId,
        tabId,
        paneId,
      });

      // A reused tab is usually a workspace's root shell, which Herdr labels `1`;
      // the agent is about to become its only tenant, so give it the task's name.
      // A tab that already holds other panes is not ours to relabel.
      if (placement.kind === "reuse" && tabId && panes.filter((pane) => pane.tabId === tabId).length === 1) {
        await this.deps.harness.renameTab(tabId, tabLabel);
      }

      const harness = task.harness ?? "pi";
      const agentName = agentNameForTask(task);
      await this.deps.harness.startAgent(agentName, agentKindForHarness(harness), paneId, {
        timeoutMs: this.startTimeoutMs,
      });
      await this.deps.dispatches.recordStart(dispatch.id, { agentName, harness, startedAt: this.now() });

      await this.deps.agentPrompt.prompt(paneId, buildDispatchPrompt(task, project));

      // `agentName`/`harness` are the pane's live identity, resolved from the same
      // snapshot the board reads (never the started name or a pane id).
      const observed = agentStateForPane(await this.listLiveAgents(), paneId);
      const updatedTask = await this.deps.tasks.update(task.id, {
        assignee: "agent",
        agentName: observed.agentName ?? agentKindForHarness(harness),
        harness: observed.agentName !== null ? observed.harness : harness,
        herdrPaneId: paneId,
      });

      return {
        task: updatedTask,
        dispatch: (await this.deps.dispatches.findById(dispatch.id)) ?? dispatch,
        workspace: ensured.workspace,
        workspaceOutcome: ensured.outcome,
        matchedBy: ensured.matchedBy,
        placement: placed,
      };
    } catch (error) {
      await this.compensate(task, dispatch.id, orphan, error);
      if (orphan) {
        throw new DispatchSpawnError(task.id, error instanceof Error ? error.message : "unknown error", orphan);
      }
      throw error;
    }
  }

  /** Records the failure and, when topology was touched, flags the orphaned tab. */
  private async compensate(
    task: Task,
    dispatchId: string,
    orphan: { tabId: string | null; paneId: string } | null,
    error: unknown,
  ): Promise<void> {
    await this.deps.dispatches.finish(dispatchId, "failed", this.now());
    if (!orphan) return;
    const detail = error instanceof Error ? error.message : "unknown error";
    const where = `${orphan.tabId ? `tab ${orphan.tabId}` : "pane"} (pane ${orphan.paneId})`;
    await this.deps.tasks.update(task.id, {
      needsHuman: true,
      needsHumanReason: `Dispatch failed after placing the agent in ${where}: ${detail}`,
    });
  }

  /** Live agents are best-effort: a snapshot failure means "identity unknown". */
  private async listLiveAgents(): Promise<LiveAgentInfo[]> {
    try {
      return await this.deps.liveAgents.list();
    } catch {
      return [];
    }
  }
}
