import { TaskNotFoundError } from "@/application/tasks/errors";
import type { FinishedTaskDispatchPort } from "@/domain/tasks/finished-task-dispatch";
import type { Task, TaskStatus } from "@/domain/tasks/task";
import type { TaskRepository } from "@/domain/tasks/task.repository";

/** Moves a task between kanban columns. Status is task-level: "why has work stopped?". */
export class MoveTaskUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly dispatches: FinishedTaskDispatchPort,
  ) {}

  async execute(id: string, status: TaskStatus): Promise<Task> {
    const task = await this.tasks.findById(id);
    if (!task) {
      throw new TaskNotFoundError(id);
    }
    const moved = await this.tasks.update(id, { status });
    // Dragging a card to Done ends its work just like `nx done` does, so the
    // open dispatch row ends as `closed` and releases the lease (DSP-8).
    if (status === "done") {
      await this.dispatches.endOpenForTask(moved.id);
    }
    return moved;
  }
}
