import { desc, eq } from "drizzle-orm";

import {
  type AssigneeType,
  type CreateTaskInput,
  createTask,
  type Harness,
  isAssigneeType,
  isHarness,
  isTaskStatus,
  type Task,
  type TaskStatus,
  type UpdateTaskInput,
  updateTask,
} from "@/domain/tasks/task";
import type { TaskRepository } from "@/domain/tasks/task.repository";
import type { NexusDb } from "@/infrastructure/db/nexus/db";
import { tasks } from "@/infrastructure/db/nexus/schema";

type TaskRow = typeof tasks.$inferSelect;

function toStatus(value: string): TaskStatus {
  return isTaskStatus(value) ? value : "backlog";
}

function toAssignee(value: string | null): AssigneeType | null {
  return isAssigneeType(value) ? value : null;
}

function toHarness(value: string | null): Harness | null {
  return isHarness(value) ? value : null;
}

function toDomain(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    status: toStatus(row.status),
    assignee: toAssignee(row.assignee),
    agentName: row.agentName,
    harness: toHarness(row.harness),
    model: row.model,
    effort: row.effort,
    herdrPaneId: row.herdrPaneId,
    needsHuman: row.needsHuman,
    needsHumanReason: row.needsHumanReason,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function toRow(task: Task) {
  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    description: task.description,
    status: task.status,
    assignee: task.assignee,
    agentName: task.agentName,
    harness: task.harness,
    model: task.model,
    effort: task.effort,
    herdrPaneId: task.herdrPaneId,
    needsHuman: task.needsHuman,
    needsHumanReason: task.needsHumanReason,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export class DrizzleTaskRepository implements TaskRepository {
  constructor(private readonly db: NexusDb) {}

  async findById(id: string): Promise<Task | null> {
    const row = this.db.select().from(tasks).where(eq(tasks.id, id)).get();
    return row ? toDomain(row) : null;
  }

  async findAll(): Promise<Task[]> {
    return this.db.select().from(tasks).orderBy(desc(tasks.updatedAt)).all().map(toDomain);
  }

  async findByProjectId(projectId: string): Promise<Task[]> {
    return this.db
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .orderBy(desc(tasks.updatedAt))
      .all()
      .map(toDomain);
  }

  async findByHerdrPaneId(paneId: string): Promise<Task | null> {
    const row = this.db.select().from(tasks).where(eq(tasks.herdrPaneId, paneId)).get();
    return row ? toDomain(row) : null;
  }

  async save(input: CreateTaskInput): Promise<Task> {
    const task = createTask(input);
    this.db.insert(tasks).values(toRow(task)).run();
    return task;
  }

  async update(id: string, input: UpdateTaskInput): Promise<Task> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error(`Task ${id} not found`);
    }
    const updated = updateTask(existing, input);
    this.db.update(tasks).set(toRow(updated)).where(eq(tasks.id, id)).run();
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.db.delete(tasks).where(eq(tasks.id, id)).run();
  }
}
