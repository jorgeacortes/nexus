export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Project ${id} not found.`);
    this.name = "ProjectNotFoundError";
  }
}
