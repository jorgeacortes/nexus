import type { CreateProjectInput, Project } from "@/domain/projects/project";
import type { ProjectRepository } from "@/domain/projects/project.repository";

export class CreateProjectUseCase {
  constructor(private readonly projects: ProjectRepository) {}

  async execute(input: CreateProjectInput): Promise<Project> {
    return this.projects.save(input);
  }
}
