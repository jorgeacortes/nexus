import { TaskNotFoundError } from "@/application/tasks/errors";
import type { TaskRepository } from "@/domain/tasks/task.repository";

export class DeleteTaskUseCase {
  constructor(private readonly tasks: TaskRepository) {}

  async execute(id: string): Promise<void> {
    const task = await this.tasks.findById(id);
    if (!task) {
      throw new TaskNotFoundError(id);
    }
    await this.tasks.delete(id);
  }
}
