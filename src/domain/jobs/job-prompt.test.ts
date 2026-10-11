import { describe, expect, it } from "vitest";

import type { Job } from "@/domain/jobs/job";
import { buildJobPrompt } from "@/domain/jobs/job-prompt";

const EARLIER = new Date("2026-10-01T00:00:00.000Z");

function job(): Job {
  return {
    id: "b2e506d3-5781-43da-93f7-631764ff0a2d",
    name: "morning",
    kind: "schedule",
    schedule: "0 8 * * 1-5",
    intervalSeconds: null,
    timezone: "Europe/Madrid",
    prompt: "Check the board.",
    projectId: null,
    targetPaneId: null,
    targetMode: "reuse",
    harness: null,
    model: null,
    effort: null,
    enabled: true,
    state: "active",
    nextRunAt: EARLIER,
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    retryCount: 0,
    maxRetries: 3,
    timeoutSeconds: 600,
    runCount: 0,
    leaseOwner: null,
    leaseUntil: null,
    createdAt: EARLIER,
    updatedAt: EARLIER,
  };
}

describe("buildJobPrompt", () => {
  it("names the job, the project folder, and the brief", () => {
    const stored = job();
    const prompt = buildJobPrompt(stored, { name: "nexus", folderPath: "~/ws/nexus" });

    expect(prompt).toContain(`#${stored.id.slice(0, 8)} — morning`);
    expect(prompt).toContain("Project: nexus (~/ws/nexus)");
    expect(prompt).toContain("Check the board.");
    expect(prompt).toContain(`Job id: ${stored.id}`);
    expect(prompt).not.toContain("nx claim");
    expect(prompt).not.toContain("nx review");
  });

  it("degrades when the job has no project or brief", () => {
    const stored = job();
    const prompt = buildJobPrompt({ ...stored, prompt: "  " }, null);
    expect(prompt).toContain("Project: none");
    expect(prompt).not.toContain("undefined");
  });
});
