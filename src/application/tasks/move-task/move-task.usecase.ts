import { TaskNotFoundError } from "@/application/tasks/errors";
import type { Task, TaskStatus } from "@/domain/tasks/task";
import type { TaskRepository } from "@/domain/tasks/task.repository";

/** Moves a task between kanban columns. Status is task-level: "why has work stopped?". */
export class MoveTaskUseCase {
  constructor(private readonly tasks: TaskRepository) {}

  async execute(id: string, status: TaskStatus): Promise<Task> {
    const task = await this.tasks.findById(id);
    if (!task) {
      throw new TaskNotFoundError(id);
    }
    return this.tasks.update(id, { status });
  }
}
