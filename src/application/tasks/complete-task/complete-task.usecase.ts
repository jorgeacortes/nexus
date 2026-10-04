import { TaskNotFoundError } from "@/application/tasks/errors";
import type { CompleteTaskInput, Task } from "@/domain/tasks/task";
import type { TaskRepository } from "@/domain/tasks/task.repository";

/**
 * Completes a task: `in_progress` → `done`, or `blocked` → `done` to force-close
 * it. Clears the needs-human flag and records the completion timestamp/notes.
 */
export class CompleteTaskUseCase {
  constructor(private readonly tasks: TaskRepository) {}

  async execute(id: string, input: CompleteTaskInput = {}): Promise<Task> {
    const task = await this.tasks.findById(id);
    if (!task) {
      throw new TaskNotFoundError(id);
    }
    return this.tasks.complete(id, input);
  }
}
