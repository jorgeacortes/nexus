/**
 * Raised when a project has no live Herdr workspace and no folder to create one
 * in. Refusing is the point: a workspace with an invented cwd would run the agent
 * somewhere arbitrary.
 */
export class MissingProjectFolderError extends Error {
  constructor(projectName: string) {
    super(
      `Project "${projectName}" has no folder path, so no Herdr workspace can be created for it. ` +
        `Set one with \`nx project edit ${projectName} --folder <path>\`.`,
    );
    this.name = "MissingProjectFolderError";
  }
}
