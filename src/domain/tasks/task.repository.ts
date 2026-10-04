import type { CreateTaskInput, Task, UpdateTaskInput } from "@/domain/tasks/task";

export interface TaskRepository {
  findById(id: string): Promise<Task | null>;
  findAll(): Promise<Task[]>;
  findByProjectId(projectId: string): Promise<Task[]>;
  findByHerdrPaneId(paneId: string): Promise<Task | null>;
  save(input: CreateTaskInput): Promise<Task>;
  update(id: string, input: UpdateTaskInput): Promise<Task>;
  delete(id: string): Promise<void>;
}
