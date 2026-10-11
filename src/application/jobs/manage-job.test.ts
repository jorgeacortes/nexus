import { beforeEach, describe, expect, it } from "vitest";

import {
  createJob,
  editJob,
  listJobs,
  pauseManagedJob,
  removeJob,
  resumeManagedJob,
} from "@/application/jobs/manage-job";
import { JobValidationError, jobNeedsHuman } from "@/domain/jobs/job";
import type { NexusDb } from "@/infrastructure/db/nexus/db";
import { DrizzleJobRepository } from "@/infrastructure/repositories/jobs/drizzle-job.repository";
import { createTestDb } from "@/test-support/db";

const NOW = new Date("2026-10-11T12:00:00.000Z");

describe("manage jobs", () => {
  let db: NexusDb;
  let jobs: DrizzleJobRepository;
  const projects = { exists: async (id: string) => id === "proj-1" };
  const deps = () => ({ jobs, projects });

  beforeEach(() => {
    db = createTestDb();
    jobs = new DrizzleJobRepository(db);
  });

  it("creates a job due one interval from now and lists a dead job first", async () => {
    const created = await createJob(deps(), {
      name: "morning",
      prompt: "Check the board.",
      intervalSeconds: 3600,
      projectId: "proj-1",
      now: NOW,
    });
    expect(created.nextRunAt?.toISOString()).toBe("2026-10-11T13:00:00.000Z");
    expect(created.maxRetries).toBe(3);
    expect(created.state).toBe("active");

    const dead = await jobs.insert({
      ...created,
      id: "job-dead",
      name: "stuck",
      state: "dead",
      nextRunAt: null,
      lastError: "no pane",
    });
    const listed = await listJobs(deps());
    expect(listed.map((job) => job.id)).toEqual([dead.id, created.id]);
    expect(jobNeedsHuman(listed[0])).toBe(true);
  });

  it("refuses a job with no schedule and an unknown project", async () => {
    await expect(createJob(deps(), { name: "x", prompt: "y", now: NOW })).rejects.toBeInstanceOf(JobValidationError);
    await expect(
      createJob(deps(), { name: "x", prompt: "y", intervalSeconds: 60, projectId: "missing", now: NOW }),
    ).rejects.toThrow(/not found/);
  });

  it("pauses, resumes, edits the next run, and removes the row", async () => {
    const created = await createJob(deps(), {
      name: "morning",
      prompt: "Check the board.",
      intervalSeconds: 60,
      now: NOW,
    });
    const paused = await pauseManagedJob(deps(), created.id, NOW);
    expect(paused.state).toBe("paused");
    expect(await jobs.selectDue(new Date(NOW.getTime() + 120_000), 5)).toEqual([]);

    const resumed = await resumeManagedJob(deps(), created.id, NOW);
    expect(resumed.state).toBe("active");

    const edited = await editJob(deps(), created.id, { intervalSeconds: 120, now: NOW });
    expect(edited.intervalSeconds).toBe(120);
    expect(edited.nextRunAt?.toISOString()).toBe("2026-10-11T12:02:00.000Z");

    await removeJob(deps(), created.id);
    expect(await jobs.findById(created.id)).toBeNull();
  });
});
