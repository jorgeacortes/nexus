import type { ClaimTaskInput, CompleteTaskInput, CreateTaskInput, Task, UpdateTaskInput } from "@/domain/tasks/task";

export interface TaskRepository {
  findById(id: string): Promise<Task | null>;
  findAll(): Promise<Task[]>;
  findByProjectId(projectId: string): Promise<Task[]>;
  findByHerdrPaneId(paneId: string): Promise<Task | null>;
  save(input: CreateTaskInput): Promise<Task>;
  update(id: string, input: UpdateTaskInput): Promise<Task>;
  /** Guarded `backlog|ready → in_progress` transition (domain rules apply). */
  claim(id: string, input: ClaimTaskInput): Promise<Task>;
  /** Guarded `in_progress|blocked → done` transition (domain rules apply). */
  complete(id: string, input: CompleteTaskInput): Promise<Task>;
  delete(id: string): Promise<void>;
}
