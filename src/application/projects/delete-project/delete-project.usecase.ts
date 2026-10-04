import { ProjectNotFoundError } from "@/application/projects/errors";
import type { ProjectRepository } from "@/domain/projects/project.repository";

export class DeleteProjectUseCase {
  constructor(private readonly projects: ProjectRepository) {}

  async execute(id: string): Promise<void> {
    const existing = await this.projects.findById(id);
    if (!existing) {
      throw new ProjectNotFoundError(id);
    }
    await this.projects.delete(id);
  }
}
