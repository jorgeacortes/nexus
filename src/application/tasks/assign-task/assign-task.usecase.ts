import { TaskNotFoundError } from "@/application/tasks/errors";
import type { AssigneeType, Harness, Task } from "@/domain/tasks/task";
import type { TaskRepository } from "@/domain/tasks/task.repository";

export type AssignTaskInput = {
  assignee: AssigneeType | null;
  agentName?: string | null;
  harness?: Harness | null;
  model?: string | null;
  effort?: string | null;
  herdrPaneId?: string | null;
};

/**
 * Assigns a task to the operator or one agent. The `(model, effort)` pair is
 * validated against the registry by the domain; the harness only narrows models.
 */
export class AssignTaskUseCase {
  constructor(private readonly tasks: TaskRepository) {}

  async execute(id: string, input: AssignTaskInput): Promise<Task> {
    const task = await this.tasks.findById(id);
    if (!task) {
      throw new TaskNotFoundError(id);
    }
    return this.tasks.update(id, input);
  }
}
