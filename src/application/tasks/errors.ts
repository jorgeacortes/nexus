export class TaskNotFoundError extends Error {
  constructor(id: string) {
    super(`Task ${id} not found.`);
    this.name = "TaskNotFoundError";
  }
}

export class ProjectReferenceNotFoundError extends Error {
  constructor(id: string) {
    super(`Project ${id} does not exist.`);
    this.name = "ProjectReferenceNotFoundError";
  }
}
