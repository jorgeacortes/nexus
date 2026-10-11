import { DuplicateProjectNameError } from "@/application/projects/errors";
import { type CreateProjectInput, type Project, sameProjectName } from "@/domain/projects/project";
import type { ProjectRepository } from "@/domain/projects/project.repository";

export class CreateProjectUseCase {
  constructor(private readonly projects: ProjectRepository) {}

  async execute(input: CreateProjectInput): Promise<Project> {
    const existing = (await this.projects.findAll()).find((project) => sameProjectName(project.name, input.name));
    if (existing) {
      throw new DuplicateProjectNameError(existing.name);
    }
    return this.projects.save(input);
  }
}
