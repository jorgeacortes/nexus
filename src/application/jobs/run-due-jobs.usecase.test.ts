import { beforeEach, describe, expect, it } from "vitest";

import {
  JobNotRunnableError,
  type RunDueJobsDeps,
  runDueJobs,
  runJobNow,
} from "@/application/jobs/run-due-jobs.usecase";
import type { HarnessPane, HarnessPort, HarnessTab, HarnessWorkspace } from "@/domain/dispatch/harness";
import { type Job, type JobRun, pauseJob, resumeJob } from "@/domain/jobs/job";
import { buildJobPrompt, type JobPromptProject } from "@/domain/jobs/job-prompt";
import type { LiveAgentInfo, LiveAgentPort } from "@/domain/tasks/live-agents";
import type { NexusDb } from "@/infrastructure/db/nexus/db";
import { jobRuns, jobs, jobsMeta } from "@/infrastructure/db/nexus/schema";
import { DrizzleJobRepository } from "@/infrastructure/repositories/jobs/drizzle-job.repository";
import { createTestDb } from "@/test-support/db";

const CREATED = new Date("2026-10-01T00:00:00.000Z");
const NOW = new Date("2026-10-11T12:00:00.000Z");
const PANE = "wR:p1";

function hoursBefore(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: crypto.randomUUID(),
    name: "morning",
    kind: "schedule",
    schedule: null,
    intervalSeconds: 3600,
    timezone: "UTC",
    prompt: "Check the board.",
    predicate: null,
    dailyRunCap: null,
    projectId: null,
    targetPaneId: PANE,
    targetMode: "reuse",
    harness: null,
    model: null,
    effort: null,
    enabled: true,
    state: "active",
    nextRunAt: NOW,
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    retryCount: 0,
    maxRetries: 3,
    timeoutSeconds: 60,
    runCount: 0,
    leaseOwner: null,
    leaseUntil: null,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  };
}

function agent(paneId = PANE, cwd = "/tmp/nexus", status = "idle"): LiveAgentInfo {
  return { paneId, agentKind: "pi", status, cwd, model: null, effort: null };
}

function agents(rows: LiveAgentInfo[] = [agent()]): { port: LiveAgentPort; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    port: {
      list: async () => {
        calls += 1;
        return rows;
      },
    },
  };
}

function prompts(
  impl?: (paneId: string, text: string) => Promise<void> | void,
  read: (paneId: string) => Promise<string> | string = () => "",
): {
  port: RunDueJobsDeps["agentPrompt"];
  calls: { paneId: string; text: string; timeoutMs: number | undefined }[];
  reads: string[];
} {
  const calls: { paneId: string; text: string; timeoutMs: number | undefined }[] = [];
  const reads: string[] = [];
  return {
    calls,
    reads,
    port: {
      prompt: async (paneId, text, options) => {
        calls.push({ paneId, text, timeoutMs: options?.timeoutMs });
        await impl?.(paneId, text);
      },
      read: async (paneId) => {
        reads.push(paneId);
        return read(paneId);
      },
    },
  };
}

const PROJECT: JobPromptProject = {
  id: "proj-1",
  name: "nexus",
  folderPath: "/tmp/nexus",
  herdrWorkspaceId: "wJ",
};

type HarnessCalls = {
  createWorkspace: Array<{ label: string; cwd: string | null }>;
  createTab: Array<{ workspaceId: string; label: string; cwd: string | null }>;
  startAgent: Array<{ name: string; kind: string; paneId: string; timeoutMs: number | undefined }>;
};

function workspace(id: string, label: string): HarnessWorkspace {
  return {
    workspaceId: id,
    label,
    focused: false,
    tabCount: 1,
    paneCount: 1,
    agentStatus: "unknown",
    activeTabId: null,
  };
}

function shellPane(paneId: string, workspaceId: string, cwd: string): HarnessPane {
  return {
    paneId,
    tabId: `${workspaceId}:t1`,
    workspaceId,
    agent: null,
    agentStatus: "unknown",
    cwd,
    focused: false,
    terminalTitle: "",
  };
}

/** A fake topology port. Unused writes throw so a reuse run cannot create a tab by accident. */
function jobHarness(options: { panes?: HarnessPane[]; failStart?: Error | (() => Error | undefined) }): {
  port: HarnessPort;
  calls: HarnessCalls;
} {
  const calls: HarnessCalls = { createWorkspace: [], createTab: [], startAgent: [] };
  const unexpected = (method: string): never => {
    throw new Error(`unexpected harness.${method}`);
  };
  return {
    calls,
    port: {
      listWorkspaces: async () => [workspace("wJ", "nexus")],
      listTabs: async () => unexpected("listTabs"),
      listPanes: async () => options.panes ?? [],
      getTab: async () => unexpected("getTab"),
      processes: async () => unexpected("processes"),
      createWorkspace: async (label, cwd) => {
        calls.createWorkspace.push({ label, cwd });
        return workspace("wCreated", label);
      },
      createTab: async (workspaceId, label, cwd) => {
        calls.createTab.push({ workspaceId, label, cwd });
        const n = calls.createTab.length;
        const tab: HarnessTab = {
          tabId: `${workspaceId}:t${n}`,
          workspaceId,
          label,
          focused: false,
          paneCount: 1,
          agentStatus: "unknown",
        };
        return { tab, rootPane: { ...shellPane(`${workspaceId}:p${n}`, workspaceId, cwd ?? ""), tabId: tab.tabId } };
      },
      renameTab: async () => {},
      startAgent: async (name, kind, paneId, startOptions) => {
        calls.startAgent.push({ name, kind, paneId, timeoutMs: startOptions?.timeoutMs });
        const failure = typeof options.failStart === "function" ? options.failStart() : options.failStart;
        if (failure) throw failure;
      },
      closeTab: async () => unexpected("closeTab"),
    },
  };
}

function dump(db: NexusDb) {
  return {
    jobs: db.select().from(jobs).all(),
    runs: db.select().from(jobRuns).all(),
    meta: db.select().from(jobsMeta).all(),
  };
}

describe("runDueJobs", () => {
  let db: NexusDb;
  let repo: DrizzleJobRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new DrizzleJobRepository(db);
  });

  it("claims due jobs up to the limit and skips the ones that are not due", async () => {
    const early = makeJob({ id: "job-early", name: "early", nextRunAt: hoursBefore(2) });
    const mid = makeJob({ id: "job-mid", name: "mid", nextRunAt: hoursBefore(1) });
    const late = makeJob({ id: "job-late", name: "late", nextRunAt: NOW });
    const future = makeJob({ id: "job-future", name: "future", nextRunAt: new Date(NOW.getTime() + 1000) });
    const paused = makeJob({ id: "job-paused", name: "paused", state: "paused" });
    const disabled = makeJob({ id: "job-off", name: "off", enabled: false });
    const dead = makeJob({ id: "job-dead", name: "dead", state: "dead" });
    const unscheduled = makeJob({ id: "job-none", name: "none", nextRunAt: null });
    const held = makeJob({
      id: "job-held",
      name: "held",
      nextRunAt: hoursBefore(3),
      leaseOwner: "other",
      leaseUntil: new Date(NOW.getTime() + 60_000),
    });
    for (const job of [late, held, paused, early, disabled, dead, mid, future, unscheduled]) {
      await repo.insert(job);
    }

    const sent = prompts();
    const report = await runDueJobs(
      {
        jobs: repo,
        projects: { find: async () => null },
        agentPrompt: sent.port,
        liveAgents: agents().port,
        leaseOwner: "tick",
      },
      { now: NOW, limit: 2 },
    );

    expect(sent.calls.map((call) => call.paneId)).toEqual([PANE, PANE]);
    expect(sent.calls[0]?.text).toBe(buildJobPrompt(early, null));
    expect(sent.calls[1]?.text).toBe(buildJobPrompt(mid, null));
    expect(report.due).toEqual(["job-early", "job-mid"]);
    expect(report.runs.map((run) => run.jobId)).toEqual(["job-early", "job-mid"]);
    expect(report.lastTickAt).toBe(NOW.toISOString());

    for (const id of ["job-late", "job-future", "job-paused", "job-off", "job-dead", "job-none", "job-held"]) {
      expect(await repo.runsFor(id), id).toEqual([]);
      const stored = await repo.findById(id);
      expect(stored?.runCount, id).toBe(0);
      expect(stored?.updatedAt.toISOString(), id).toBe(CREATED.toISOString());
    }

    const claimed = await repo.findById("job-early");
    expect(claimed).toMatchObject({
      state: "active",
      retryCount: 0,
      runCount: 1,
      lastStatus: "ok",
      lastError: null,
      leaseOwner: null,
      leaseUntil: null,
    });
    expect(claimed?.nextRunAt?.toISOString()).toBe(new Date(NOW.getTime() + 3_600_000).toISOString());
    expect(await repo.runsFor("job-early")).toMatchObject([{ status: "ok", paneId: PANE, leaseOwner: "tick" }]);
    expect((await repo.readMeta())?.lastTickAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("lets exactly one of two concurrent ticks claim a job", async () => {
    await repo.insert(makeJob({ id: "job-race", name: "race" }));
    const sent = prompts(async () => {
      await Promise.resolve();
    });
    const shared = {
      jobs: repo,
      projects: { find: async () => null },
      agentPrompt: sent.port,
      liveAgents: agents().port,
    };

    const [first, second] = await Promise.all([
      runDueJobs({ ...shared, leaseOwner: "tick-a" }, { now: NOW, limit: 5 }),
      runDueJobs({ ...shared, leaseOwner: "tick-b" }, { now: NOW, limit: 5 }),
    ]);

    expect(sent.calls).toHaveLength(1);
    const runs = [...first.runs, ...second.runs];
    const lost = [...first.lost, ...second.lost];
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("ok");
    expect(lost).toEqual(["job-race"]);
    expect(await repo.runsFor("job-race")).toHaveLength(1);
    expect(await repo.findById("job-race")).toMatchObject({ runCount: 1, leaseOwner: null, leaseUntil: null });
  });

  it("reaps a running attempt whose lease expired and retries it", async () => {
    const crashedAt = new Date(NOW.getTime() - 60_000);
    const job = makeJob({
      id: "job-reap",
      name: "reap-me",
      maxRetries: 3,
      runCount: 1,
      leaseOwner: "crashed",
      leaseUntil: crashedAt,
      lastStatus: "running",
      lastRunAt: crashedAt,
    });
    await repo.insert(job);
    const stale: JobRun = {
      id: "run-old",
      jobId: job.id,
      startedAt: new Date(NOW.getTime() - 120_000),
      finishedAt: null,
      status: "running",
      paneId: PANE,
      leaseOwner: "crashed",
      prompt: "old prompt",
      output: null,
      error: null,
    };
    await repo.insertRun(stale);

    const during: { job: Job | null } = { job: null };
    const sent = prompts(async () => {
      during.job = await repo.findById(job.id);
    });
    await runDueJobs(
      {
        jobs: repo,
        projects: { find: async () => null },
        agentPrompt: sent.port,
        liveAgents: agents().port,
        leaseOwner: "tick",
      },
      { now: NOW, limit: 5 },
    );

    expect(sent.calls).toHaveLength(1);
    expect(during.job?.retryCount).toBe(1);
    expect(during.job?.leaseOwner).toBe("tick");
    expect(during.job?.leaseUntil?.toISOString()).toBe(new Date(NOW.getTime() + 60_000).toISOString());
    expect(during.job?.lastStatus).toBe("running");

    const runs = await repo.runsFor(job.id);
    expect(runs.map((run) => run.status)).toEqual(["timeout", "ok"]);
    expect(runs[0]).toMatchObject({ id: "run-old", error: "Lease expired before the run finished." });
    expect(runs[0]?.finishedAt?.toISOString()).toBe(NOW.toISOString());
    expect(runs[1]).toMatchObject({ status: "ok", paneId: PANE, leaseOwner: "tick" });

    const after = await repo.findById(job.id);
    expect(after).toMatchObject({
      state: "active",
      retryCount: 0,
      runCount: 2,
      lastStatus: "ok",
      leaseOwner: null,
      leaseUntil: null,
    });
    expect(after?.nextRunAt?.toISOString()).toBe(new Date(NOW.getTime() + 3_600_000).toISOString());
  });

  it("dead-letters a reaped run that has no retries left", async () => {
    const crashedAt = new Date(NOW.getTime() - 60_000);
    const job = makeJob({
      id: "job-reap-dead",
      maxRetries: 0,
      runCount: 1,
      leaseOwner: "crashed",
      leaseUntil: crashedAt,
      lastStatus: "running",
    });
    await repo.insert(job);
    await repo.insertRun({
      id: "run-old",
      jobId: job.id,
      startedAt: crashedAt,
      finishedAt: null,
      status: "running",
      paneId: PANE,
      leaseOwner: "crashed",
      prompt: "old",
      output: null,
      error: null,
    });

    const sent = prompts();
    await runDueJobs(
      {
        jobs: repo,
        projects: { find: async () => null },
        agentPrompt: sent.port,
        liveAgents: agents().port,
        leaseOwner: "tick",
      },
      { now: NOW, limit: 5 },
    );

    expect(sent.calls).toHaveLength(0);
    expect(await repo.findById(job.id)).toMatchObject({
      state: "dead",
      retryCount: 0,
      leaseOwner: null,
      leaseUntil: null,
      lastStatus: "timeout",
    });
    expect(await repo.runsFor(job.id)).toMatchObject([{ id: "run-old", status: "timeout" }]);
  });

  it("retries a failed dispatch with 2^n backoff", async () => {
    await repo.insert(makeJob({ id: "job-backoff", name: "backoff", maxRetries: 4 }));
    const sent = prompts(async () => {
      throw new Error("agent unavailable");
    });
    const tick = (now: Date) =>
      runDueJobs(
        {
          jobs: repo,
          projects: { find: async () => null },
          agentPrompt: sent.port,
          liveAgents: agents().port,
          leaseOwner: "tick",
        },
        { now, limit: 5 },
      );

    await tick(NOW);
    let stored = await repo.findById("job-backoff");
    expect(stored).toMatchObject({
      state: "active",
      retryCount: 1,
      lastStatus: "error",
      lastError: "agent unavailable",
      leaseOwner: null,
      leaseUntil: null,
    });
    expect(stored?.nextRunAt?.toISOString()).toBe("2026-10-11T12:00:02.000Z");
    expect(await repo.runsFor("job-backoff")).toMatchObject([{ status: "error", error: "agent unavailable" }]);

    await tick(new Date(NOW.getTime() + 1000));
    expect(sent.calls).toHaveLength(1);
    expect(await repo.runsFor("job-backoff")).toHaveLength(1);

    const second = new Date(NOW.getTime() + 2000);
    await tick(second);
    stored = await repo.findById("job-backoff");
    expect(stored?.retryCount).toBe(2);
    expect(stored?.nextRunAt?.toISOString()).toBe(new Date(second.getTime() + 4000).toISOString());
    expect(sent.calls).toHaveLength(2);
  });

  it("dead-letters a job after max_retries", async () => {
    await repo.insert(makeJob({ id: "job-dead-letter", name: "dead-letter", maxRetries: 1 }));
    const sent = prompts(async () => {
      throw new Error("agent unavailable");
    });
    const tick = (now: Date) =>
      runDueJobs(
        {
          jobs: repo,
          projects: { find: async () => null },
          agentPrompt: sent.port,
          liveAgents: agents().port,
          leaseOwner: "tick",
        },
        { now, limit: 5 },
      );

    await tick(NOW);
    expect(await repo.findById("job-dead-letter")).toMatchObject({ state: "active", retryCount: 1 });

    const second = new Date(NOW.getTime() + 2000);
    await tick(second);
    const dead = await repo.findById("job-dead-letter");
    expect(dead).toMatchObject({
      state: "dead",
      retryCount: 1,
      lastStatus: "error",
      lastError: "agent unavailable",
      leaseOwner: null,
    });
    expect(dead?.nextRunAt?.toISOString()).toBe(second.toISOString());
    expect(await repo.runsFor("job-dead-letter")).toHaveLength(2);

    await tick(new Date(second.getTime() + 60_000));
    expect(sent.calls).toHaveLength(2);
    expect(await repo.runsFor("job-dead-letter")).toHaveLength(2);
  });

  it("does not run a paused job, and runs it again after resume", async () => {
    const job = makeJob({ id: "job-pause", name: "pausable" });
    await repo.insert(job);
    const paused = pauseJob(job, NOW);
    await repo.update(paused);

    const sent = prompts();
    const base: RunDueJobsDeps = {
      jobs: repo,
      projects: { find: async () => null },
      agentPrompt: sent.port,
      liveAgents: agents().port,
      leaseOwner: "tick",
    };
    await runDueJobs(base, { now: NOW, limit: 5 });

    expect(sent.calls).toHaveLength(0);
    expect(await repo.runsFor(job.id)).toEqual([]);
    expect(await repo.findById(job.id)).toMatchObject({ state: "paused", updatedAt: paused.updatedAt });
    expect((await repo.readMeta())?.lastTickAt?.toISOString()).toBe(NOW.toISOString());

    const stored = await repo.findById(job.id);
    if (!stored) throw new Error("missing job");
    const later = new Date(NOW.getTime() + 1000);
    await repo.update(resumeJob(stored, later));
    await runDueJobs(base, { now: later, limit: 5 });

    expect(sent.calls).toHaveLength(1);
    expect(await repo.findById(job.id)).toMatchObject({ state: "active", lastStatus: "ok" });
    expect(await repo.runsFor(job.id)).toMatchObject([{ status: "ok" }]);
  });

  it("writes nothing on a dry run", async () => {
    const due = makeJob({ id: "job-due", name: "due" });
    const crashedAt = new Date(NOW.getTime() - 1000);
    const leased = makeJob({
      id: "job-leased",
      name: "leased",
      leaseOwner: "crashed",
      leaseUntil: crashedAt,
      lastStatus: "running",
      runCount: 1,
    });
    await repo.insert(due);
    await repo.insert(leased);
    await repo.insertRun({
      id: "run-open",
      jobId: leased.id,
      startedAt: crashedAt,
      finishedAt: null,
      status: "running",
      paneId: PANE,
      leaseOwner: "crashed",
      prompt: "old",
      output: null,
      error: null,
    });

    const before = dump(db);
    const sent = prompts();
    const listed = agents();
    const report = await runDueJobs(
      {
        jobs: repo,
        projects: { find: async () => null },
        agentPrompt: sent.port,
        liveAgents: listed.port,
        leaseOwner: "tick",
      },
      { now: NOW, limit: 10, dryRun: true },
    );

    expect(dump(db)).toEqual(before);
    expect(sent.calls).toHaveLength(0);
    expect(listed.calls()).toBe(0);
    expect(report.dryRun).toBe(true);
    expect(report.reaped).toEqual([]);
    expect(report.runs).toEqual([]);
    expect(report.lastTickAt).toBeNull();
    expect(report.due.slice().sort()).toEqual(["job-due", "job-leased"]);
  });

  it("fails a reuse run with no pane and does not create a tab", async () => {
    await repo.insert(makeJob({ id: "job-missing", name: "missing", targetPaneId: "wR:missing", maxRetries: 3 }));
    const sent = prompts();
    const harness = jobHarness({});
    const report = await runDueJobs(
      {
        jobs: repo,
        projects: { find: async () => PROJECT },
        agentPrompt: sent.port,
        liveAgents: agents([agent(PANE)]).port,
        harness: harness.port,
        leaseOwner: "tick",
      },
      { now: NOW, limit: 5 },
    );

    expect(sent.calls).toHaveLength(0);
    expect(harness.calls.createTab).toEqual([]);
    expect(harness.calls.createWorkspace).toEqual([]);
    expect(harness.calls.startAgent).toEqual([]);
    expect(report.runs[0]).toMatchObject({ status: "error", paneId: null, error: "no pane" });
    expect(await repo.findById("job-missing")).toMatchObject({
      state: "active",
      retryCount: 1,
      lastStatus: "error",
      lastError: "no pane",
      leaseOwner: null,
    });
  });

  it("prompts a live idle target inside the project folder and does not spawn", async () => {
    const job = makeJob({
      id: "job-pinned",
      name: "pinned",
      projectId: PROJECT.id,
      targetPaneId: "wR:p1",
      targetMode: "spawn",
      prompt: "Look around.",
    });
    await repo.insert(job);
    const sent = prompts(undefined, () => "looked");
    const harness = jobHarness({});
    await runDueJobs(
      {
        jobs: repo,
        projects: { find: async () => PROJECT },
        agentPrompt: sent.port,
        liveAgents: agents([
          agent("wR:p9", "/tmp/elsewhere"),
          agent("wR:p2", "/tmp/nexus", "working"),
          agent("wR:p1", "/tmp/nexus/web", "idle"),
        ]).port,
        harness: harness.port,
        leaseOwner: "tick",
      },
      { now: NOW, limit: 5 },
    );

    expect(harness.calls.createTab).toEqual([]);
    expect(sent.calls).toHaveLength(1);
    expect(sent.calls[0]?.paneId).toBe("wR:p1");
    expect(sent.calls[0]?.timeoutMs).toBe(60_000);
    expect(sent.calls[0]?.text).toBe(buildJobPrompt(job, PROJECT));
    expect(sent.reads).toEqual(["wR:p1"]);
    expect(await repo.runsFor(job.id)).toMatchObject([{ status: "ok", paneId: "wR:p1", output: "looked" }]);
  });

  it("does not prompt an idle pane that sits in another project", async () => {
    await repo.insert(
      makeJob({
        id: "job-cross",
        name: "cross",
        projectId: PROJECT.id,
        targetPaneId: "wOther:p1",
        targetMode: "reuse",
      }),
    );
    const sent = prompts();
    const harness = jobHarness({});
    const report = await runDueJobs(
      {
        jobs: repo,
        projects: { find: async () => PROJECT },
        agentPrompt: sent.port,
        liveAgents: agents([agent("wOther:p1", "/tmp/other-project", "idle")]).port,
        harness: harness.port,
        leaseOwner: "tick",
      },
      { now: NOW, limit: 5 },
    );

    expect(sent.calls).toHaveLength(0);
    expect(harness.calls.createTab).toEqual([]);
    expect(report.runs[0]).toMatchObject({ status: "error", error: "no pane", paneId: null });
  });

  it("spawns into the project folder when the named pane is elsewhere, and records the output", async () => {
    const job = makeJob({
      id: "job-spawn",
      name: "spawn-me",
      projectId: PROJECT.id,
      targetPaneId: "wOther:p1",
      targetMode: "spawn",
      prompt: "Do the job.",
    });
    await repo.insert(job);
    const sent = prompts(undefined, () => "spawned output");
    const harness = jobHarness({ panes: [shellPane("wOther:p9", "wJ", "/tmp/other-project")] });
    await runDueJobs(
      {
        jobs: repo,
        projects: { find: async () => PROJECT },
        agentPrompt: sent.port,
        liveAgents: agents([agent("wOther:p1", "/tmp/other-project", "idle")]).port,
        harness: harness.port,
        leaseOwner: "tick",
      },
      { now: NOW, limit: 5 },
    );

    expect(harness.calls.createWorkspace).toEqual([]);
    expect(harness.calls.createTab).toEqual([{ workspaceId: "wJ", label: "spawn-me", cwd: "/tmp/nexus" }]);
    expect(harness.calls.startAgent).toMatchObject([{ paneId: "wJ:p1", kind: "pi", timeoutMs: 60_000 }]);
    expect(sent.calls[0]?.paneId).toBe("wJ:p1");
    expect(sent.calls[0]?.text).toBe(buildJobPrompt(job, PROJECT));
    expect(sent.reads).toEqual(["wJ:p1"]);
    expect(await repo.runsFor(job.id)).toMatchObject([{ status: "ok", paneId: "wJ:p1", output: "spawned output" }]);
  });

  it("reuses a bare shell in the project folder instead of creating a tab", async () => {
    await repo.insert(
      makeJob({
        id: "job-shell",
        name: "shell",
        projectId: PROJECT.id,
        targetPaneId: null,
        targetMode: "spawn",
      }),
    );
    const sent = prompts(undefined, () => "from the shell");
    const harness = jobHarness({ panes: [shellPane("wJ:shell", "wJ", "/tmp/nexus")] });
    await runDueJobs(
      {
        jobs: repo,
        projects: { find: async () => PROJECT },
        agentPrompt: sent.port,
        liveAgents: agents([]).port,
        harness: harness.port,
        leaseOwner: "tick",
      },
      { now: NOW, limit: 5 },
    );

    expect(harness.calls.createTab).toEqual([]);
    expect(harness.calls.startAgent).toMatchObject([{ paneId: "wJ:shell" }]);
    expect(await repo.runsFor("job-shell")).toMatchObject([
      { status: "ok", paneId: "wJ:shell", output: "from the shell" },
    ]);
  });

  it("records a prompt timeout and retries it with the same backoff", async () => {
    await repo.insert(makeJob({ id: "job-wait", name: "wait", maxRetries: 3 }));
    const sent = prompts(() => {
      const error = new Error("timeout") as Error & { code: string };
      error.code = "timeout";
      throw error;
    });
    await runDueJobs(
      {
        jobs: repo,
        projects: { find: async () => null },
        agentPrompt: sent.port,
        liveAgents: agents().port,
        leaseOwner: "tick",
      },
      { now: NOW, limit: 5 },
    );

    expect(sent.reads).toEqual([]);
    expect(await repo.findById("job-wait")).toMatchObject({
      state: "active",
      retryCount: 1,
      lastStatus: "timeout",
      lastError: "timeout",
    });
    expect((await repo.findById("job-wait"))?.nextRunAt?.toISOString()).toBe("2026-10-11T12:00:02.000Z");
    expect(await repo.runsFor("job-wait")).toMatchObject([{ status: "timeout", paneId: PANE, output: null }]);
  });

  it("records a start timeout and retries it on the next due tick", async () => {
    await repo.insert(makeJob({ id: "job-start", name: "start-slow", projectId: PROJECT.id, targetMode: "spawn" }));
    let starts = 0;
    const harness = jobHarness({
      failStart: () => {
        starts += 1;
        return starts === 1
          ? new Error("herdr agent.start: agent start-slow did not become interactive within 60000ms")
          : undefined;
      },
    });
    const sent = prompts(undefined, () => "ready the second time");
    const tick = (now: Date) =>
      runDueJobs(
        {
          jobs: repo,
          projects: { find: async () => PROJECT },
          agentPrompt: sent.port,
          liveAgents: agents([]).port,
          harness: harness.port,
          leaseOwner: "tick",
        },
        { now, limit: 5 },
      );

    const first = await tick(NOW);
    expect(first.runs[0]).toMatchObject({ status: "timeout", paneId: "wJ:p1" });
    expect(first.runs[0]?.error).toMatch(/did not become interactive/);
    expect(sent.calls).toHaveLength(0);
    let stored = await repo.findById("job-start");
    expect(stored).toMatchObject({ state: "active", retryCount: 1, lastStatus: "timeout", leaseOwner: null });
    expect(stored?.nextRunAt?.toISOString()).toBe("2026-10-11T12:00:02.000Z");
    expect(await repo.runsFor("job-start")).toMatchObject([{ status: "timeout", paneId: "wJ:p1", output: null }]);

    const second = new Date(NOW.getTime() + 2000);
    await tick(second);
    stored = await repo.findById("job-start");
    expect(stored).toMatchObject({ state: "active", retryCount: 0, lastStatus: "ok" });
    expect(sent.calls).toHaveLength(1);
    expect(await repo.runsFor("job-start")).toMatchObject([
      { status: "timeout", paneId: "wJ:p1" },
      { status: "ok", paneId: "wJ:p2", output: "ready the second time" },
    ]);
  });
});

describe("runJobNow", () => {
  let db: NexusDb;
  let repo: DrizzleJobRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new DrizzleJobRepository(db);
  });

  function deps(sent: ReturnType<typeof prompts>): RunDueJobsDeps {
    return {
      jobs: repo,
      projects: { find: async () => null },
      agentPrompt: sent.port,
      liveAgents: agents().port,
      leaseOwner: "operator",
    };
  }

  it("runs a job whose next run is still in the future", async () => {
    await repo.insert(makeJob({ id: "job-later", nextRunAt: new Date(NOW.getTime() + 3_600_000) }));
    const sent = prompts();
    const run = await runJobNow(deps(sent), "job-later", NOW);
    expect(run).toMatchObject({ jobId: "job-later", status: "ok", paneId: PANE });
    expect(sent.calls).toHaveLength(1);
    expect((await repo.findById("job-later"))?.runCount).toBe(1);
  });

  it("refuses a paused job and leaves it out of the due set", async () => {
    await repo.insert(makeJob({ id: "job-paused", state: "paused", nextRunAt: hoursBefore(1) }));
    await expect(runJobNow(deps(prompts()), "job-paused", NOW)).rejects.toBeInstanceOf(JobNotRunnableError);
    expect(await repo.selectDue(NOW, 5)).toEqual([]);
    expect((await repo.findById("job-paused"))?.state).toBe("paused");
  });

  it("revives a dead job and dispatches it", async () => {
    await repo.insert(
      makeJob({
        id: "job-dead",
        state: "dead",
        retryCount: 3,
        lastError: "no pane",
        lastStatus: "error",
        nextRunAt: null,
      }),
    );
    const sent = prompts();
    const run = await runJobNow(deps(sent), "job-dead", NOW);
    expect(run).toMatchObject({ jobId: "job-dead", status: "ok", state: "active" });
    const stored = await repo.findById("job-dead");
    expect(stored).toMatchObject({ state: "active", retryCount: 0, lastError: null, lastStatus: "ok" });
    expect(stored?.nextRunAt).not.toBeNull();
  });

  it("does not dispatch a review job, a poll whose check is false, or a job over its daily cap", async () => {
    await repo.insert(makeJob({ id: "job-review", kind: "review", nextRunAt: hoursBefore(1) }));
    await repo.insert(
      makeJob({
        id: "job-poll",
        kind: "poll",
        predicate: "stale_ready_task",
        intervalSeconds: 600,
        nextRunAt: hoursBefore(1),
      }),
    );
    await repo.insert(makeJob({ id: "job-capped", dailyRunCap: 1, intervalSeconds: 3600, nextRunAt: hoursBefore(1) }));
    await repo.insertRun({
      id: "run-today",
      jobId: "job-capped",
      startedAt: NOW,
      finishedAt: NOW,
      status: "ok",
      paneId: PANE,
      leaseOwner: "tick",
      prompt: "earlier",
      output: null,
      error: null,
    });

    const sent = prompts();
    const report = await runDueJobs(
      {
        ...deps(sent),
        predicates: { holds: async () => false },
      },
      { now: NOW, limit: 5 },
    );

    expect(sent.calls).toHaveLength(0);
    expect(report.runs).toEqual([]);
    expect((await repo.findById("job-review"))?.runCount).toBe(0);
    expect((await repo.findById("job-poll"))?.nextRunAt?.getTime()).toBe(NOW.getTime() + 600_000 - 1);
    expect((await repo.findById("job-capped"))?.runCount).toBe(0);
    expect((await repo.findById("job-capped"))?.nextRunAt?.getTime()).toBeGreaterThan(NOW.getTime());
  });
});
