import type { ArchiveTasksUseCase } from "@/application/tasks/archive-tasks";
import type { Task } from "@/domain/tasks/task";
import type { TaskRepository } from "@/domain/tasks/task.repository";

/** Which archive slice a list read wants. The default is the live board. */
export type ArchivedFilter = "exclude" | "only" | "include";

/**
 * Task-list read. Runs the archive sweep first, then returns the requested
 * slice. Board, `GET /api/tasks`, and the archive page all go through here so
 * a done card older than the interval leaves without a separate daemon.
 */
export class ListTasksUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly archive: ArchiveTasksUseCase,
  ) {}

  async execute(input: { projectId?: string | null; archived?: ArchivedFilter } = {}): Promise<Task[]> {
    await this.archive.execute();
    const archived = input.archived ?? "exclude";
    const projectId = input.projectId ?? null;

    if (archived === "only") {
      const rows = await this.tasks.findArchived();
      return projectId ? rows.filter((task) => task.projectId === projectId) : rows;
    }

    const active = projectId ? await this.tasks.findByProjectId(projectId) : await this.tasks.findAll();
    if (archived === "exclude") return active;

    const archivedRows = await this.tasks.findArchived();
    const extra = projectId ? archivedRows.filter((task) => task.projectId === projectId) : archivedRows;
    return [...active, ...extra];
  }
}
