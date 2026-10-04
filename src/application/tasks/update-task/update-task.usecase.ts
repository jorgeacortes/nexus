import { ProjectReferenceNotFoundError, TaskNotFoundError } from "@/application/tasks/errors";
import type { ProjectReferencePort } from "@/domain/tasks/project-reference";
import type { Task, UpdateTaskInput } from "@/domain/tasks/task";
import type { TaskRepository } from "@/domain/tasks/task.repository";

/** Updates a task's content fields (title, description, project tag). */
export class UpdateTaskUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly projects: ProjectReferencePort,
  ) {}

  async execute(id: string, input: UpdateTaskInput): Promise<Task> {
    const task = await this.tasks.findById(id);
    if (!task) {
      throw new TaskNotFoundError(id);
    }
    if (input.projectId) {
      const exists = await this.projects.exists(input.projectId);
      if (!exists) {
        throw new ProjectReferenceNotFoundError(input.projectId);
      }
    }
    return this.tasks.update(id, input);
  }
}
