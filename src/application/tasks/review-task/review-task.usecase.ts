import { ReviewRequiresDoneError, TaskNotFoundError } from "@/application/tasks/errors";
import type { Task } from "@/domain/tasks/task";
import type { TaskRepository } from "@/domain/tasks/task.repository";

/**
 * Records the operator's personal verification of a finished task as a
 * `reviewedAt` timestamp — orthogonal to status, and never derived from it.
 *
 * `reviewed = true` requires the task to be `done` and takes the ball out of the
 * operator's court (clears the needs-human flag). `reviewed = false` clears the
 * timestamp. Any move out of `done` clears it too, via `updateTask`.
 *
 * This is an operator assertion, not an agent self-assessment: an agent may only
 * call it when the operator has explicitly confirmed, in the conversation, that
 * they personally reviewed the task.
 */
export class ReviewTaskUseCase {
  constructor(private readonly tasks: TaskRepository) {}

  async execute(id: string, reviewed: boolean): Promise<Task> {
    const task = await this.tasks.findById(id);
    if (!task) {
      throw new TaskNotFoundError(id);
    }
    if (!reviewed) {
      return this.tasks.update(id, { reviewedAt: null });
    }
    if (task.status !== "done") {
      throw new ReviewRequiresDoneError(task.status);
    }
    return this.tasks.update(id, { reviewedAt: new Date(), needsHuman: false, needsHumanReason: null });
  }
}
