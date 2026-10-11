export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Project ${id} not found.`);
    this.name = "ProjectNotFoundError";
  }
}

/** `nx project add` refuses a second project with the same name. It does not upsert. */
export class DuplicateProjectNameError extends Error {
  constructor(existingName: string) {
    super(
      `A project named "${existingName}" already exists. Use \`nx project edit\` to change its folder or workspace.`,
    );
    this.name = "DuplicateProjectNameError";
  }
}
