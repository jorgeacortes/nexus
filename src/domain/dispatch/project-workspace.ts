/**
 * Port owned by the dispatch context: the project fields `ensureWorkspace`
 * resolves against and the one write it makes back. A narrow projection, not the
 * projects aggregate, following `src/domain/tasks/project-reference.ts` — the
 * dispatch context never imports the projects context's internals, and the write
 * still funnels through the same `ProjectRepository.update` the web PATCH uses.
 */

/** The project fields the dispatcher needs to resolve or create a workspace. */
export type DispatchProject = {
  id: string;
  name: string;
  folderPath: string | null;
  herdrWorkspaceId: string | null;
};

export interface ProjectWorkspacePort {
  /** Persists the resolved or freshly created Herdr workspace id on the project. */
  setWorkspaceId(projectId: string, workspaceId: string): Promise<void>;
}
