import { TaskNotFoundError } from "@/application/tasks/errors";
import type { AgentPromptPort } from "@/domain/tasks/agent-prompt";
import type { Harness, Task } from "@/domain/tasks/task";
import type { TaskRepository } from "@/domain/tasks/task.repository";

export const DEFAULT_UNBLOCK_PROMPT =
  "You were flagged as needing human input — it is resolved. Please continue with the task.";

/** Harnesses Nexus can talk to over the Herdr socket; Cursor is resolved by hand. */
const PROMPTABLE_HARNESSES: readonly Harness[] = ["pi", "claude_code"];

export class AgentUnreachableError extends Error {
  constructor(paneId: string, cause: unknown) {
    super(`Could not reach the agent on pane ${paneId}: ${cause instanceof Error ? cause.message : "unknown error"}`);
    this.name = "AgentUnreachableError";
  }
}

/**
 * Resolves a task awaiting human action: for terminal harnesses with a linked
 * pane it prompts the agent back through Herdr, then clears the flag. Cursor (or
 * a task with no live pane) is resolved by hand — the flag is cleared only.
 */
export class ResolveTaskUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly agent: AgentPromptPort,
  ) {}

  async execute(id: string, input: { message?: string | null } = {}): Promise<Task> {
    const task = await this.tasks.findById(id);
    if (!task) {
      throw new TaskNotFoundError(id);
    }

    const paneId = task.herdrPaneId;
    const canPrompt = paneId !== null && task.harness !== null && PROMPTABLE_HARNESSES.includes(task.harness);
    if (paneId && canPrompt) {
      try {
        await this.agent.prompt(paneId, input.message?.trim() || DEFAULT_UNBLOCK_PROMPT);
      } catch (error) {
        throw new AgentUnreachableError(paneId, error);
      }
    }

    return this.tasks.update(id, { needsHuman: false, needsHumanReason: null });
  }
}
