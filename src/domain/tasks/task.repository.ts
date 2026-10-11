import type { ClaimTaskInput, CompleteTaskInput, CreateTaskInput, Task, UpdateTaskInput } from "@/domain/tasks/task";

export interface TaskRepository {
  findById(id: string): Promise<Task | null>;
  /** Tasks still on the board. Archived rows are omitted. */
  findAll(): Promise<Task[]>;
  /** Tasks still on the board for one project. Archived rows are omitted. */
  findByProjectId(projectId: string): Promise<Task[]>;
  /** Archived tasks, newest archive stamp first. */
  findArchived(): Promise<Task[]>;
  /**
   * Done, not-yet-archived tasks whose `completedAt` is strictly before
   * `completedBefore`. The sweep still re-checks eligibility in the domain.
   */
  findArchiveCandidates(completedBefore: Date): Promise<Task[]>;
  findByHerdrPaneId(paneId: string): Promise<Task | null>;
  save(input: CreateTaskInput): Promise<Task>;
  update(id: string, input: UpdateTaskInput): Promise<Task>;
  /** Guarded `backlog|ready → in_progress` transition (domain rules apply). */
  claim(id: string, input: ClaimTaskInput): Promise<Task>;
  /** Guarded `in_progress|blocked → done` transition (domain rules apply). */
  complete(id: string, input: CompleteTaskInput): Promise<Task>;
  /**
   * Stamps `archivedAt` when the task is still eligible at `now`. Returns null
   * when a concurrent sweep already archived it or it is no longer eligible.
   */
  archive(id: string, now: Date): Promise<Task | null>;
  /** `ready`, with `archivedAt` and `completedAt` cleared. */
  unarchive(id: string, now: Date): Promise<Task>;
  delete(id: string): Promise<void>;
}
