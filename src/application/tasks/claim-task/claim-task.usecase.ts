import { TaskNotFoundError } from "@/application/tasks/errors";
import { agentIdentityForPane, type LiveAgentInfo, type LiveAgentPort } from "@/domain/tasks/live-agents";
import type { Task } from "@/domain/tasks/task";
import type { TaskRepository } from "@/domain/tasks/task.repository";

export type ClaimTaskCommand = { paneId?: string | null };

/**
 * Claims a task for an agent pane: `backlog`/`ready` → `in_progress`. The
 * transition rules (idempotent same-pane claim, double-claim rejection) live in
 * the domain; this use case enforces existence and resolves the claiming pane's
 * live identity (agent kind + harness) from the Herdr snapshot, so the row never
 * records a pane/tab id as the agent name. Herdr being unavailable leaves the
 * identity empty — it never fails the claim.
 */
export class ClaimTaskUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly liveAgents: LiveAgentPort,
  ) {}

  async execute(id: string, input: ClaimTaskCommand = {}): Promise<Task> {
    const task = await this.tasks.findById(id);
    if (!task) {
      throw new TaskNotFoundError(id);
    }
    const identity = agentIdentityForPane(await this.listAgents(), input.paneId);
    return this.tasks.claim(id, { paneId: input.paneId, ...identity });
  }

  /** Live agents are best-effort: a snapshot failure means "identity unknown". */
  private async listAgents(): Promise<LiveAgentInfo[]> {
    try {
      return await this.liveAgents.list();
    } catch {
      return [];
    }
  }
}
