import { hostname } from "node:os";

import { CloseHarnessUseCase, type PaneTaskPort } from "@/application/dispatch/close-harness";
import { DetectLostAgentsUseCase, type LostAgentTaskPort } from "@/application/dispatch/detect-lost-agents";
import { DispatchTaskUseCase } from "@/application/dispatch/dispatch-task";
import { EnsureWorkspaceUseCase } from "@/application/dispatch/ensure-workspace";
import type { DispatchRepository } from "@/domain/dispatch/dispatch.repository";
import type { HarnessPort } from "@/domain/dispatch/harness";
import type { DispatchProjectPort, ProjectWorkspacePort } from "@/domain/dispatch/project-workspace";
import type { ProjectRepository } from "@/domain/projects/project.repository";
import type { AgentPromptPort } from "@/domain/tasks/agent-prompt";
import type { LiveAgentPort } from "@/domain/tasks/live-agents";
import type { ProjectReferencePort } from "@/domain/tasks/project-reference";
import type { TaskRepository } from "@/domain/tasks/task.repository";
import { db } from "@/infrastructure/db/nexus/db";
import { type ContainerInventoryPort, HttpContainerInventory } from "@/infrastructure/docker/container-inventory";
import { HerdrClient } from "@/infrastructure/herdr/herdr-client";
import { DrizzleDispatchRepository } from "@/infrastructure/repositories/dispatch/drizzle-dispatch.repository";
import { DrizzleProjectRepository } from "@/infrastructure/repositories/projects/drizzle-project.repository";
import { DrizzleTaskRepository } from "@/infrastructure/repositories/tasks/drizzle-task.repository";
import {
  type NexusPorts,
  ProcfsServerCollector,
  resolveNexusPorts,
  type ServerCollectorPort,
} from "@/infrastructure/servers/server-collector";

/**
 * Composition root: the only place that wires contexts together. Routes and
 * pages import ready-made repositories/clients from here.
 */
export const projectRepo: ProjectRepository = new DrizzleProjectRepository(db);
export const taskRepo: TaskRepository = new DrizzleTaskRepository(db);
export const dispatchRepo: DispatchRepository = new DrizzleDispatchRepository(db);
export const herdrClient: HerdrClient = new HerdrClient();
export const serverCollector: ServerCollectorPort = new ProcfsServerCollector();
export const containerInventory: ContainerInventoryPort = new HttpContainerInventory();

/** The ports Nexus itself answers on, so the Servers screen can mark its own rows. */
export const nexusPorts: NexusPorts = resolveNexusPorts();

/** The dispatch context's Herdr topology port, served by the same socket client. */
export const harness: HarnessPort = herdrClient;

/**
 * Persists the workspace `ensureWorkspace` resolves or creates onto its project,
 * and reads a project as the dispatch context's narrow `DispatchProject`. Both
 * funnel through the same `ProjectRepository` the web PATCH uses, so the
 * dispatcher's repair and `nx project edit --workspace` write identically.
 */
export const projectWorkspace: ProjectWorkspacePort & DispatchProjectPort = {
  setWorkspaceId: async (projectId, workspaceId) => {
    await projectRepo.update(projectId, { herdrWorkspaceId: workspaceId });
  },
  find: async (projectId) => {
    const project = await projectRepo.findById(projectId);
    return project
      ? {
          id: project.id,
          name: project.name,
          folderPath: project.folderPath,
          herdrWorkspaceId: project.herdrWorkspaceId,
        }
      : null;
  },
};

/** Adapts the projects repository to the lookup port the tasks context declares. */
export const projectReference: ProjectReferencePort = {
  exists: async (projectId) => (await projectRepo.findById(projectId)) !== null,
  find: async (projectId) => {
    const project = await projectRepo.findById(projectId);
    return project ? { id: project.id, name: project.name, folderPath: project.folderPath } : null;
  },
};

/** Adapts the Herdr client to the tasks context's agent-prompt port. */
export const agentPrompt: AgentPromptPort = {
  prompt: (paneId, text) => herdrClient.prompt(paneId, text),
};

/** Adapts the Herdr snapshot to the read-only live-agent port dispatch/claim use. */
export const liveAgents: LiveAgentPort = {
  list: async () =>
    (await herdrClient.snapshot()).agents.map((agent) => ({
      paneId: agent.paneId,
      agentKind: agent.agent,
      status: agent.agentStatus,
      cwd: agent.cwd,
      model: agent.model,
      effort: agent.effort,
    })),
};

const ensureWorkspace = new EnsureWorkspaceUseCase(harness, projectWorkspace);

/**
 * The tasks-context read the close guard needs: the task a pane is assigned to.
 * Through the same repository every other path uses, never a new query.
 */
export const paneTask: PaneTaskPort = {
  findByHerdrPaneId: async (paneId) => {
    const task = await taskRepo.findByHerdrPaneId(paneId);
    return task ? { id: task.id, title: task.title, status: task.status } : null;
  },
};

/** The guarded teardown `nx dispatch close` and `POST /api/dispatch/close` call. */
export const closeHarness = new CloseHarnessUseCase(harness, paneTask);

/**
 * The tasks-context read/write the lost-agent sweep needs: the task a dispatch
 * row names, and the operator flag it sets. Both funnel through the same
 * `TaskRepository` every other path uses.
 */
export const lostAgentTasks: LostAgentTaskPort = {
  findById: async (id) => {
    const task = await taskRepo.findById(id);
    return task ? { id: task.id, title: task.title, status: task.status } : null;
  },
  flagNeedsHuman: async (id, reason) => {
    await taskRepo.update(id, { needsHuman: true, needsHumanReason: reason });
  },
};

/** The one-shot lost-agent sweep `nx dispatch detect` / `POST /api/dispatch/detect` call. No poller. */
export const detectLostAgents = new DetectLostAgentsUseCase({
  dispatches: dispatchRepo,
  tasks: lostAgentTasks,
  harness,
});

/** The one-shot actuator `nx dispatch` and `POST /api/dispatch` call. No daemon. */
export const dispatchTask = new DispatchTaskUseCase({
  tasks: taskRepo,
  dispatches: dispatchRepo,
  harness,
  projects: projectWorkspace,
  ensureWorkspace,
  agentPrompt,
  liveAgents,
  leaseOwner: `${hostname()}:${process.pid}`,
});
