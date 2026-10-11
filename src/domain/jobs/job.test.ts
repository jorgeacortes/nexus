import { describe, expect, it } from "vitest";

import {
  type Job,
  JobTransitionError,
  jobNeedsHuman,
  markJobDead,
  pauseJob,
  resumeJob,
  reviveJob,
  transitionJob,
} from "@/domain/jobs/job";

const EARLIER = new Date("2026-10-01T00:00:00.000Z");
const NOW = new Date("2026-10-11T12:00:00.000Z");

function job(state: Job["state"]): Job {
  return {
    id: "job-1",
    name: "morning",
    kind: "schedule",
    schedule: "0 8 * * 1-5",
    intervalSeconds: null,
    timezone: "Europe/Madrid",
    prompt: "Check the board.",
    predicate: null,
    dailyRunCap: null,
    projectId: null,
    targetPaneId: null,
    targetMode: "reuse",
    harness: null,
    model: null,
    effort: null,
    enabled: true,
    state,
    nextRunAt: EARLIER,
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    retryCount: 1,
    maxRetries: 3,
    timeoutSeconds: 600,
    runCount: 4,
    leaseOwner: null,
    leaseUntil: null,
    createdAt: EARLIER,
    updatedAt: EARLIER,
  };
}

describe("job state transitions", () => {
  it("pauses an active job and resumes it", () => {
    const paused = pauseJob(job("active"), NOW);
    expect(paused.state).toBe("paused");
    expect(paused.updatedAt).toBe(NOW);
    expect(paused.enabled).toBe(true);
    expect(paused.retryCount).toBe(1);

    const resumed = resumeJob(paused, NOW);
    expect(resumed.state).toBe("active");
  });

  it("marks an active or paused job dead, and dead stays dead", () => {
    expect(markJobDead(job("active"), NOW).state).toBe("dead");
    expect(markJobDead(job("paused"), NOW).state).toBe("dead");

    expect(() => pauseJob(job("dead"), NOW)).toThrow(JobTransitionError);
    expect(() => resumeJob(job("dead"), NOW)).toThrow(JobTransitionError);
    expect(() => markJobDead(job("dead"), NOW)).toThrow(/cannot move to "dead"/);
  });

  it("treats a dead job as needing the operator and revives it for a re-run", () => {
    const dead = markJobDead(job("active"), NOW);
    expect(jobNeedsHuman(dead)).toBe(true);
    expect(jobNeedsHuman(job("active"))).toBe(false);

    const revived = reviveJob({ ...dead, retryCount: 3, lastError: "no pane" }, NOW);
    expect(revived.state).toBe("active");
    expect(revived.retryCount).toBe(0);
    expect(revived.lastError).toBeNull();
    expect(revived.nextRunAt).toBe(NOW);
    expect(jobNeedsHuman(revived)).toBe(false);
    expect(() => reviveJob(job("paused"), NOW)).toThrow(/dead/);
    expect(() => resumeJob(dead, NOW)).toThrow(JobTransitionError);
  });

  it("refuses a transition the current state does not allow", () => {
    expect(() => pauseJob(job("paused"), NOW)).toThrow(JobTransitionError);
    expect(() => resumeJob(job("active"), NOW)).toThrow(/cannot move to "active"/);
    expect(() => transitionJob(job("active"), "active", NOW)).toThrow(JobTransitionError);
  });
});
