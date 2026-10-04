import { ProjectReferenceNotFoundError } from "@/application/tasks/errors";
import type { ProjectReferencePort } from "@/domain/tasks/project-reference";
import type { CreateTaskInput, Task } from "@/domain/tasks/task";
import type { TaskRepository } from "@/domain/tasks/task.repository";

/** Creates a task, rejecting a project id that does not exist. */
export class CreateTaskUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly projects: ProjectReferencePort,
  ) {}

  async execute(input: CreateTaskInput): Promise<Task> {
    if (input.projectId) {
      const exists = await this.projects.exists(input.projectId);
      if (!exists) {
        throw new ProjectReferenceNotFoundError(input.projectId);
      }
    }
    return this.tasks.save(input);
  }
}
