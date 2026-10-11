import { type Clock, systemClock } from "@/application/tasks/clock";
import { TaskNotFoundError } from "@/application/tasks/errors";
import type { Task } from "@/domain/tasks/task";
import type { TaskRepository } from "@/domain/tasks/task.repository";

/**
 * Returns an archived task to the board as `ready`, clearing `archivedAt` and
 * `completedAt` so the next sweep cannot immediately archive it again.
 */
export class UnarchiveTaskUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(id: string): Promise<Task> {
    const existing = await this.tasks.findById(id);
    if (!existing) {
      throw new TaskNotFoundError(id);
    }
    return this.tasks.unarchive(id, this.clock.now());
  }
}
