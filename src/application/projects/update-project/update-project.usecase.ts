import { ProjectNotFoundError } from "@/application/projects/errors";
import type { Project, UpdateProjectInput } from "@/domain/projects/project";
import type { ProjectRepository } from "@/domain/projects/project.repository";

export class UpdateProjectUseCase {
  constructor(private readonly projects: ProjectRepository) {}

  async execute(id: string, input: UpdateProjectInput): Promise<Project> {
    const existing = await this.projects.findById(id);
    if (!existing) {
      throw new ProjectNotFoundError(id);
    }
    return this.projects.update(id, input);
  }
}
