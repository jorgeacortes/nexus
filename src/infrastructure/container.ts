import type { ProjectRepository } from "@/domain/projects/project.repository";
import type { AgentPromptPort } from "@/domain/tasks/agent-prompt";
import type { LiveAgentPort } from "@/domain/tasks/live-agents";
import type { ProjectReferencePort } from "@/domain/tasks/project-reference";
import type { TaskRepository } from "@/domain/tasks/task.repository";
import { db } from "@/infrastructure/db/nexus/db";
import { HerdrClient, type HerdrPort } from "@/infrastructure/herdr/herdr-client";
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
export const herdrClient: HerdrPort = new HerdrClient();
export const serverCollector: ServerCollectorPort = new ProcfsServerCollector();

/** The ports Nexus itself answers on, so the Servers screen can mark its own rows. */
export const nexusPorts: NexusPorts = resolveNexusPorts();

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

/** Adapts the Herdr snapshot to the read-only live-agent port dispatch uses. */
export const liveAgents: LiveAgentPort = {
  list: async () =>
    (await herdrClient.snapshot()).agents.map((agent) => ({
      paneId: agent.paneId,
      agentKind: agent.agent,
      status: agent.agentStatus,
      cwd: agent.cwd,
    })),
};
