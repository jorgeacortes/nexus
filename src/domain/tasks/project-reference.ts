/**
 * Port owned by the tasks context: lets a use case confirm a project id exists
 * without importing the projects context's internals.
 */
export interface ProjectReferencePort {
  exists(projectId: string): Promise<boolean>;
}
