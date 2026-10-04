import { AgentUnreachableError, NoEligibleAgentError, TaskNotFoundError } from "@/application/tasks/errors";
import type { AgentPromptPort } from "@/domain/tasks/agent-prompt";
import { buildDispatchPrompt } from "@/domain/tasks/dispatch-prompt";
import { agentStateForPane, type LiveAgentInfo, type LiveAgentPort } from "@/domain/tasks/live-agents";
import type { ProjectReferencePort } from "@/domain/tasks/project-reference";
import { isKnownModelForHarness, type Task, TaskValidationError } from "@/domain/tasks/task";
import type { TaskRepository } from "@/domain/tasks/task.repository";

export type DispatchTaskInput = {
  paneId?: string | null;
  target?: "auto" | null;
};

function expandHome(folder: string): string {
  const home = process.env.HOME ?? "";
  const expanded = folder.startsWith("~/") && home ? `${home}/${folder.slice(2)}` : folder;
  return expanded.replace(/\/+$/, "");
}

function isInside(cwd: string, folder: string): boolean {
  return cwd === folder || cwd.startsWith(`${folder}/`);
}

/**
 * The declarative push: prompt an agent pane to work a task and record the
 * assignment pointers. `paneId` always wins; `target: "auto"` picks the idle
 * agent whose cwd sits inside the task's project folder, and fails loudly when
 * there is none (dispatch never silently crosses projects).
 */
export class DispatchTaskUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly projects: ProjectReferencePort,
    private readonly agent: AgentPromptPort,
    private readonly liveAgents: LiveAgentPort,
  ) {}

  async execute(id: string, input: DispatchTaskInput = {}): Promise<Task> {
    const task = await this.tasks.findById(id);
    if (!task) {
      throw new TaskNotFoundError(id);
    }

    const agents = await this.liveAgents.list();
    const explicitPane = input.paneId?.trim() || null;
    const paneId = explicitPane ?? (input.target === "auto" ? await this.resolveAuto(task, agents) : null);
    if (!paneId) {
      throw new TaskValidationError('Pass a pane id or target "auto" to dispatch.');
    }

    const project = task.projectId ? await this.projects.find(task.projectId) : null;
    try {
      await this.agent.prompt(paneId, buildDispatchPrompt(task, project));
    } catch (error) {
      throw new AgentUnreachableError(paneId, error);
    }

    // The agent is the live pane: resolve its kind/harness from the same snapshot
    // the board reads. A pane Herdr does not report clears the pointers instead of
    // keeping a stale name. A model belongs to the harness it was chosen for, so a
    // harness that cannot run the recorded model drops the (model, effort) pair.
    const identity = agentStateForPane(agents, paneId);
    const keepsModel = !identity.harness || !task.model || isKnownModelForHarness(identity.harness, task.model);

    return this.tasks.update(id, {
      assignee: "agent",
      agentName: identity.agentName,
      harness: identity.harness,
      model: keepsModel ? task.model : null,
      effort: keepsModel ? task.effort : null,
      herdrPaneId: paneId,
    });
  }

  private async resolveAuto(task: Task, agents: LiveAgentInfo[]): Promise<string> {
    if (!task.projectId) {
      throw new NoEligibleAgentError("the task has no project to match a folder against");
    }
    const project = await this.projects.find(task.projectId);
    if (!project?.folderPath) {
      throw new NoEligibleAgentError(`project "${project?.name ?? task.projectId}" has no folder path`);
    }
    const folder = expandHome(project.folderPath);
    const idle = agents
      .filter((agent) => agent.status === "idle" && isInside(agent.cwd, folder))
      .sort((a, b) => a.paneId.localeCompare(b.paneId));
    if (idle.length === 0) {
      throw new NoEligibleAgentError(`no idle agent pane under ${folder}`);
    }
    return idle[0].paneId;
  }
}
