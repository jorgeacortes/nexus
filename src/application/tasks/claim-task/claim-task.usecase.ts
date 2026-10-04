import { TaskNotFoundError } from "@/application/tasks/errors";
import type { ClaimTaskInput, Task } from "@/domain/tasks/task";
import type { TaskRepository } from "@/domain/tasks/task.repository";

/**
 * Claims a task for an agent pane: `backlog`/`ready` → `in_progress`. The
 * transition rules (idempotent same-pane claim, double-claim rejection) live in
 * the domain; this use case only enforces existence.
 */
export class ClaimTaskUseCase {
  constructor(private readonly tasks: TaskRepository) {}

  async execute(id: string, input: ClaimTaskInput = {}): Promise<Task> {
    const task = await this.tasks.findById(id);
    if (!task) {
      throw new TaskNotFoundError(id);
    }
    return this.tasks.claim(id, input);
  }
}
