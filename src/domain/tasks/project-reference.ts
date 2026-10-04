/**
 * Port owned by the tasks context: lets a use case confirm a project id exists
 * (and read its name/folder for dispatch) without importing the projects
 * context's internals.
 */
export type ProjectReference = {
  id: string;
  name: string;
  folderPath: string | null;
};

export interface ProjectReferencePort {
  exists(projectId: string): Promise<boolean>;
  find(projectId: string): Promise<ProjectReference | null>;
}
