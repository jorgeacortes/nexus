import type { CreateProjectInput, Project, UpdateProjectInput } from "@/domain/projects/project";

export interface ProjectRepository {
  findById(id: string): Promise<Project | null>;
  findAll(): Promise<Project[]>;
  save(input: CreateProjectInput): Promise<Project>;
  update(id: string, input: UpdateProjectInput): Promise<Project>;
  delete(id: string): Promise<void>;
}
