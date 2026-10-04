/** Project domain: the stable container (≈ Herdr workspace + folder) that tags tasks. */

export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectValidationError";
  }
}

export type Project = {
  id: string;
  name: string;
  folderPath: string | null;
  herdrWorkspaceId: string | null;
  createdAt: Date;
};

export type CreateProjectInput = {
  name: string;
  folderPath?: string | null;
  herdrWorkspaceId?: string | null;
};

export type UpdateProjectInput = {
  name?: string;
  folderPath?: string | null;
  herdrWorkspaceId?: string | null;
};

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new ProjectValidationError("A project needs a name.");
  }
  return trimmed;
}

function normalizeOptional(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function createProject(input: CreateProjectInput): Project {
  return {
    id: crypto.randomUUID(),
    name: normalizeName(input.name),
    folderPath: normalizeOptional(input.folderPath),
    herdrWorkspaceId: normalizeOptional(input.herdrWorkspaceId),
    createdAt: new Date(),
  };
}

export function updateProject(project: Project, input: UpdateProjectInput): Project {
  return {
    ...project,
    name: input.name !== undefined ? normalizeName(input.name) : project.name,
    folderPath: input.folderPath !== undefined ? normalizeOptional(input.folderPath) : project.folderPath,
    herdrWorkspaceId:
      input.herdrWorkspaceId !== undefined ? normalizeOptional(input.herdrWorkspaceId) : project.herdrWorkspaceId,
  };
}
