import { type Clock, systemClock } from "@/application/tasks/clock";
import { completedBeforeArchive, isArchiveEligible } from "@/domain/tasks/archive";
import type { Task } from "@/domain/tasks/task";
import type { TaskRepository } from "@/domain/tasks/task.repository";

export type ArchiveSweepResult = {
  archived: Task[];
};

/**
 * One-shot archive sweep. `nx archive sweep` calls it, and so do the board and
 * task-list reads. There is no timer and no crontab entry: nothing runs unless
 * someone looks or asks.
 *
 * The first run is retroactive. A task whose `completedAt` is already older
 * than the interval archives on that run; there is no "only from launch" mark.
 */
export class ArchiveTasksUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(): Promise<ArchiveSweepResult> {
    const now = this.clock.now();
    const candidates = await this.tasks.findArchiveCandidates(completedBeforeArchive(now));
    const archived: Task[] = [];
    for (const candidate of candidates) {
      if (!isArchiveEligible(candidate, now)) continue;
      const stamped = await this.tasks.archive(candidate.id, now);
      if (stamped) archived.push(stamped);
    }
    return { archived };
  }
}
