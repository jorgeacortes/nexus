import { TaskNotFoundError } from "@/application/tasks/errors";
import type { Task } from "@/domain/tasks/task";
import type { TaskRepository } from "@/domain/tasks/task.repository";

/**
 * Sets the "whose court is the ball in?" flag. Orthogonal to status: it can sit
 * on in_progress (agent paused for input), blocked (needs a decision), or done
 * (awaiting review).
 */
export class FlagNeedsHumanUseCase {
  constructor(private readonly tasks: TaskRepository) {}

  async execute(id: string, needsHuman: boolean, reason: string | null = null): Promise<Task> {
    const task = await this.tasks.findById(id);
    if (!task) {
      throw new TaskNotFoundError(id);
    }
    return this.tasks.update(id, { needsHuman, needsHumanReason: needsHuman ? reason : null });
  }
}
