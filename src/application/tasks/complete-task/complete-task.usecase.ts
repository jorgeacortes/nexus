import { TaskNotFoundError } from "@/application/tasks/errors";
import type { FinishedTaskDispatchPort } from "@/domain/tasks/finished-task-dispatch";
import type { CompleteTaskInput, Task } from "@/domain/tasks/task";
import type { TaskRepository } from "@/domain/tasks/task.repository";

/**
 * Completes a task: `in_progress` → `done`, or `blocked` → `done` to force-close
 * it. Clears the needs-human flag and records the completion timestamp/notes.
 *
 * Completing is also the end of the work: the task's open dispatch row ends as
 * `closed` so its lease stops being held and the task can be dispatched again
 * later (DSP-8). That is a ledger write only — the agent's tab is left alone.
 */
export class CompleteTaskUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly dispatches: FinishedTaskDispatchPort,
  ) {}

  async execute(id: string, input: CompleteTaskInput = {}): Promise<Task> {
    const task = await this.tasks.findById(id);
    if (!task) {
      throw new TaskNotFoundError(id);
    }
    const completed = await this.tasks.complete(id, input);
    await this.dispatches.endOpenForTask(completed.id);
    return completed;
  }
}
