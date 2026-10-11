import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  executeJobsTick,
  formatJobsTickReport,
  isLastTickFresh,
  type JobsTickIo,
  lastTickFreshForMs,
  msUntilNextTick,
  parseJobsTickArgs,
  randomJitterMs,
  readJobsTickEnv,
  runJobsTickLoop,
  TICK_JITTER_MAX_MS,
} from "@/application/jobs/jobs-tick";
import type { RunDueJobsReport } from "@/application/jobs/run-due-jobs.usecase";
import type { NexusDb } from "@/infrastructure/db/nexus/db";
import { migrateNexusDatabase } from "@/infrastructure/db/nexus/migrate";

const NOW = new Date("2026-10-11T12:00:30.000Z");
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function report(overrides: Partial<RunDueJobsReport> = {}): RunDueJobsReport {
  return { dryRun: false, due: [], reaped: [], lost: [], runs: [], lastTickAt: null, ...overrides };
}

function harness(overrides: Partial<JobsTickIo> = {}): { io: JobsTickIo; logs: string[] } {
  const logs: string[] = [];
  return {
    logs,
    io: {
      now: () => NOW,
      jitterMs: () => 0,
      shouldStop: () => false,
      sleep: async () => {},
      readLastTickAt: () => {
        throw new Error("readLastTickAt should not be called");
      },
      runTick: async () => {
        throw new Error("runTick should not be called");
      },
      stdout: (line) => logs.push(`out:${line}`),
      stderr: (line) => logs.push(`err:${line}`),
      ...overrides,
    },
  };
}

describe("parseJobsTickArgs", () => {
  it("defaults to a single tick", () => {
    expect(parseJobsTickArgs([])).toEqual({ ok: true, mode: "once", dryRun: false });
    expect(parseJobsTickArgs(["--once"])).toEqual({ ok: true, mode: "once", dryRun: false });
  });

  it("accepts loop, dry-run, and healthcheck", () => {
    expect(parseJobsTickArgs(["--loop", "--dry-run"])).toEqual({ ok: true, mode: "loop", dryRun: true });
    expect(parseJobsTickArgs(["--healthcheck"])).toEqual({ ok: true, mode: "healthcheck", dryRun: false });
  });

  it("rejects combined modes, a dry-run healthcheck, and unknown flags", () => {
    expect(parseJobsTickArgs(["--once", "--loop"]).ok).toBe(false);
    expect(parseJobsTickArgs(["--healthcheck", "--dry-run"]).ok).toBe(false);
    expect(parseJobsTickArgs(["--bogus"]).ok).toBe(false);
  });
});

describe("readJobsTickEnv", () => {
  it("defaults to off, one job per tick, and a minute", () => {
    expect(readJobsTickEnv({})).toEqual({
      ok: true,
      config: { enabled: false, concurrency: 1, tickSeconds: 60, dryRun: false },
    });
  });

  it("treats 1, true, yes, and on as enabled, and everything else as off", () => {
    const enabled = readJobsTickEnv({ JOBS_ENABLED: "1" });
    expect(enabled.ok && enabled.config.enabled).toBe(true);
    for (const value of ["true", "YES", "on", " 1 "]) {
      const parsed = readJobsTickEnv({ JOBS_ENABLED: value });
      expect(parsed.ok && parsed.config.enabled).toBe(true);
    }
    for (const value of ["0", "false", "no", "off", ""]) {
      const parsed = readJobsTickEnv({ JOBS_ENABLED: value });
      expect(parsed.ok && parsed.config.enabled).toBe(false);
    }
  });

  it("reads concurrency, interval, and dry-run", () => {
    expect(readJobsTickEnv({ JOB_CONCURRENCY: "3", JOB_TICK_SECONDS: "30", JOB_DRY_RUN: "yes" })).toEqual({
      ok: true,
      config: { enabled: false, concurrency: 3, tickSeconds: 30, dryRun: true },
    });
  });

  it("rejects a non-positive interval or concurrency", () => {
    expect(readJobsTickEnv({ JOB_TICK_SECONDS: "0" }).ok).toBe(false);
    expect(readJobsTickEnv({ JOB_CONCURRENCY: "abc" }).ok).toBe(false);
    expect(readJobsTickEnv({ JOB_TICK_SECONDS: "60.5" }).ok).toBe(false);
  });
});

describe("isLastTickFresh", () => {
  const tickSeconds = 60;

  it("is fresh inside two intervals and stale at the boundary", () => {
    expect(lastTickFreshForMs(tickSeconds)).toBe(120_000);
    expect(isLastTickFresh(new Date(NOW.getTime() - 119_999), NOW, tickSeconds)).toBe(true);
    expect(isLastTickFresh(new Date(NOW.getTime() - 120_000), NOW, tickSeconds)).toBe(false);
    expect(isLastTickFresh(new Date(NOW.getTime() + 1_000), NOW, tickSeconds)).toBe(true);
  });

  it("treats a missing or unreadable timestamp as stale", () => {
    expect(isLastTickFresh(null, NOW, tickSeconds)).toBe(false);
    expect(isLastTickFresh(new Date(Number.NaN), NOW, tickSeconds)).toBe(false);
  });
});

describe("msUntilNextTick", () => {
  it("waits out the rest of the minute, plus jitter", () => {
    expect(msUntilNextTick(NOW.getTime(), 60, 0)).toBe(30_000);
    expect(msUntilNextTick(NOW.getTime(), 60, 250)).toBe(30_250);
  });

  it("waits a full interval when already on a boundary", () => {
    const onTheMinute = Date.parse("2026-10-11T12:00:00.000Z");
    expect(msUntilNextTick(onTheMinute, 60, 0)).toBe(60_000);
  });

  it("aligns any other interval to the unix epoch", () => {
    expect(msUntilNextTick(75_000, 30, 0)).toBe(15_000);
  });
});

describe("randomJitterMs", () => {
  it("stays inside zero and five seconds", () => {
    expect(randomJitterMs(() => 0)).toBe(0);
    expect(randomJitterMs(() => 1)).toBe(TICK_JITTER_MAX_MS);
  });
});

describe("runJobsTickLoop", () => {
  it("sleeps before the first tick and awaits it before sleeping again", async () => {
    const order: string[] = [];
    let stopped = false;
    await runJobsTickLoop({
      tickSeconds: 60,
      now: () => new Date(30_000),
      jitterMs: () => 0,
      shouldStop: () => stopped,
      sleep: async (ms) => {
        order.push(`sleep:${ms}`);
        if (order.filter((entry) => entry.startsWith("sleep")).length === 2) stopped = true;
      },
      tick: async () => {
        order.push("tick-start");
        await Promise.resolve();
        order.push("tick-end");
      },
    });
    expect(order).toEqual(["sleep:30000", "tick-start", "tick-end", "sleep:30000"]);
  });

  it("does not tick once stop is already set", async () => {
    let slept = false;
    let ticked = false;
    await runJobsTickLoop({
      tickSeconds: 60,
      now: () => NOW,
      jitterMs: () => 0,
      shouldStop: () => true,
      sleep: async () => {
        slept = true;
      },
      tick: async () => {
        ticked = true;
      },
    });
    expect(slept).toBe(false);
    expect(ticked).toBe(false);
  });
});

describe("executeJobsTick", () => {
  it("prints usage for --help", async () => {
    const { io, logs } = harness();
    expect(await executeJobsTick({ argv: ["--help"], env: {}, io })).toBe(0);
    expect(logs.join("\n")).toContain("--healthcheck");
  });

  it("does nothing when JOBS_ENABLED is off", async () => {
    const { io, logs } = harness();
    expect(await executeJobsTick({ argv: ["--once", "--dry-run"], env: { JOBS_ENABLED: "0" }, io })).toBe(0);
    expect(logs.join("\n")).toContain("disabled");
  });

  it("stops a disabled loop without ticking", async () => {
    let stopped = false;
    let ticked = false;
    const { io } = harness({
      sleep: async () => {
        stopped = true;
      },
      shouldStop: () => stopped,
      runTick: async () => {
        ticked = true;
        return report();
      },
    });
    expect(await executeJobsTick({ argv: ["--loop"], env: {}, io })).toBe(0);
    expect(ticked).toBe(false);
  });

  it("passes concurrency and dry-run through to one tick", async () => {
    const calls: { limit: number; dryRun: boolean }[] = [];
    const { io, logs } = harness({
      runTick: async (input) => {
        calls.push({ limit: input.limit, dryRun: input.dryRun });
        return report({ dryRun: input.dryRun, due: ["job-1"], lastTickAt: null });
      },
    });
    expect(
      await executeJobsTick({
        argv: ["--once"],
        env: { JOBS_ENABLED: "1", JOB_CONCURRENCY: "4", JOB_DRY_RUN: "1" },
        io,
      }),
    ).toBe(0);
    expect(calls).toEqual([{ limit: 4, dryRun: true }]);
    expect(logs.join("\n")).toContain("dry-run");
    expect(logs.join("\n")).toContain("due=1");
  });

  it("returns the failure of a tick instead of throwing", async () => {
    const { io, logs } = harness({
      runTick: async () => {
        throw new Error("database is locked");
      },
    });
    expect(await executeJobsTick({ argv: ["--once"], env: { JOBS_ENABLED: "1" }, io })).toBe(1);
    expect(logs.join("\n")).toContain("database is locked");
  });

  it("exits 0 for a fresh tick and non-zero when it is missing or stale", async () => {
    const fresh = harness({ readLastTickAt: () => new Date(NOW.getTime() - 1_000) });
    expect(await executeJobsTick({ argv: ["--healthcheck"], env: { JOBS_ENABLED: "0" }, io: fresh.io })).toBe(0);

    const missing = harness({ readLastTickAt: () => null });
    expect(await executeJobsTick({ argv: ["--healthcheck"], env: {}, io: missing.io })).toBe(1);

    const stale = harness({ readLastTickAt: () => new Date(NOW.getTime() - 121_000) });
    expect(await executeJobsTick({ argv: ["--healthcheck"], env: { JOB_TICK_SECONDS: "60" }, io: stale.io })).toBe(1);

    const broken = harness({
      readLastTickAt: () => {
        throw new Error("no such table: jobs_meta");
      },
    });
    expect(await executeJobsTick({ argv: ["--healthcheck"], env: {}, io: broken.io })).toBe(1);
    expect(broken.logs.join("\n")).toContain("jobs_meta");
  });
});

describe("formatJobsTickReport", () => {
  it("names a dry run and a failed attempt", () => {
    const line = formatJobsTickReport(
      report({
        dryRun: false,
        due: ["abcdefghij"],
        runs: [
          {
            jobId: "abcdefghij",
            runId: "run-1",
            status: "error",
            paneId: null,
            error: "Target pane is not live.",
            state: "active",
          },
        ],
        lastTickAt: "2026-10-11T12:00:00.000Z",
      }),
    );
    expect(line).toContain("due=1");
    expect(line).toContain("abcdefgh:error (Target pane is not live.)");
    expect(line).toContain("lastTickAt=2026-10-11T12:00:00.000Z");
  });
});

describe("jobs-tick script", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("does not migrate and does not schedule with setInterval", () => {
    const script = readFileSync(join(root, "scripts/jobs-tick.ts"), "utf8");
    const runner = readFileSync(join(root, "src/application/jobs/jobs-tick.ts"), "utf8");
    for (const source of [script, runner]) {
      expect(source).not.toContain("setInterval(");
      expect(source).not.toContain("migrateNexusDatabase");
      expect(source).not.toContain("migrate-databases");
    }
    expect(script).toContain("runDueJobs");
  });

  it("exits non-zero when last_tick_at is missing or stale, and zero when it is fresh", () => {
    const scratch = migratedScratch();
    const missing = runScript(["--healthcheck"], { DATA_DIR: scratch.dir });
    expect(missing.status).not.toBe(0);
    expect(missing.status).not.toBeNull();
    expect(readFileSync(scratch.file).equals(scratch.bytes)).toBe(true);

    writeMeta(scratch.file, null);
    const blank = runScript(["--healthcheck"], { DATA_DIR: scratch.dir });
    expect(blank.status).not.toBe(0);

    writeMeta(scratch.file, new Date(Date.now() - 10 * 60 * 1000).toISOString());
    const stale = runScript(["--healthcheck"], { DATA_DIR: scratch.dir, JOB_TICK_SECONDS: "60" });
    expect(stale.status).not.toBe(0);
    expect(stale.output).toContain("stale");

    writeMeta(scratch.file, new Date().toISOString());
    const fresh = runScript(["--healthcheck"], { DATA_DIR: scratch.dir, JOB_TICK_SECONDS: "60" });
    expect(fresh.status).toBe(0);
    expect(fresh.output).toContain("fresh");
  });

  it("does not create the jobs tables when the database has no schema", () => {
    const scratch = emptyScratch();
    const result = runScript(["--healthcheck"], { DATA_DIR: scratch.dir });
    expect(result.status).not.toBe(0);
    expect(tableNames(scratch.file)).toEqual([]);
    expect(readFileSync(scratch.file).equals(scratch.bytes)).toBe(true);
    expect(readdirSync(scratch.dir).sort()).toEqual(["nexus.db"]);
  });

  it("writes nothing for --once --dry-run", () => {
    const scratch = migratedScratch();
    insertDueJob(scratch.file);
    const before = dump(scratch.file);
    const result = runScript(["--once", "--dry-run"], { DATA_DIR: scratch.dir, JOBS_ENABLED: "1" });
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("dry-run");
    expect(result.output).toContain("due=1");
    expect(dump(scratch.file)).toEqual(before);
  });

  it("writes nothing when JOB_DRY_RUN is set", () => {
    const scratch = migratedScratch();
    insertDueJob(scratch.file);
    const before = dump(scratch.file);
    const result = runScript(["--once"], { DATA_DIR: scratch.dir, JOBS_ENABLED: "1", JOB_DRY_RUN: "1" });
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("dry-run");
    expect(dump(scratch.file)).toEqual(before);
  });

  it("makes --once a no-op when JOBS_ENABLED is off", () => {
    const scratch = migratedScratch();
    insertDueJob(scratch.file);
    const before = dump(scratch.file);
    const bytes = readFileSync(scratch.file);
    const files = readdirSync(scratch.dir).sort();
    const result = runScript(["--once"], { DATA_DIR: scratch.dir, JOBS_ENABLED: "0" });
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("disabled");
    expect(result.output).not.toContain("due=");
    expect(dump(scratch.file)).toEqual(before);
    expect(readFileSync(scratch.file).equals(bytes)).toBe(true);
    expect(readdirSync(scratch.dir).sort()).toEqual(files);
  });

  it("records last_tick_at on an enabled tick with nothing due", () => {
    const scratch = migratedScratch();
    const result = runScript(["--once"], { DATA_DIR: scratch.dir, JOBS_ENABLED: "1" });
    expect(result.status, result.output).toBe(0);
    const meta = dump(scratch.file).meta as { last_tick_at: string | null }[];
    expect(meta).toHaveLength(1);
    const last = meta[0]?.last_tick_at;
    expect(last).toBeTruthy();
    expect(Date.now() - new Date(last ?? "").getTime()).toBeLessThan(60_000);
    expect(dump(scratch.file).runs).toEqual([]);

    const health = runScript(["--healthcheck"], { DATA_DIR: scratch.dir, JOB_TICK_SECONDS: "60" });
    expect(health.status, health.output).toBe(0);
  });

  function migratedScratch(): { dir: string; file: string; bytes: Buffer } {
    const dir = mkdtempSync(join(tmpdir(), "nexus-jobs-tick-"));
    dirs.push(dir);
    const file = join(dir, "nexus.db");
    const sqlite = new Database(file);
    migrateNexusDatabase(drizzle(sqlite) as NexusDb);
    sqlite.close();
    return { dir, file, bytes: readFileSync(file) };
  }

  function emptyScratch(): { dir: string; file: string; bytes: Buffer } {
    const dir = mkdtempSync(join(tmpdir(), "nexus-jobs-tick-"));
    dirs.push(dir);
    const file = join(dir, "nexus.db");
    const sqlite = new Database(file);
    sqlite.close();
    return { dir, file, bytes: readFileSync(file) };
  }
});

function runScript(args: string[], env: Record<string, string>) {
  const result = spawnSync(join(root, "node_modules/.bin/tsx"), ["scripts/jobs-tick.ts", ...args], {
    cwd: root,
    env: {
      ...process.env,
      HERDR_SOCKET: "/tmp/nexus-jobs-tick-missing.sock",
      JOBS_ENABLED: "0",
      JOB_DRY_RUN: "0",
      JOB_CONCURRENCY: "1",
      JOB_TICK_SECONDS: "60",
      ...env,
    },
    encoding: "utf8",
    timeout: 20_000,
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    error: result.error,
  };
}

function writeMeta(file: string, lastTickAt: string | null) {
  const sqlite = new Database(file);
  sqlite.prepare("delete from jobs_meta").run();
  sqlite.prepare("insert into jobs_meta (id, last_tick_at) values (1, ?)").run(lastTickAt);
  sqlite.close();
}

function insertDueJob(file: string) {
  const sqlite = new Database(file);
  sqlite
    .prepare(
      "insert into jobs (id, name, prompt, next_run_at, created_at, updated_at) values ('job-due', 'scratch', 'scratch fixture', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')",
    )
    .run();
  sqlite.close();
}

function dump(file: string) {
  const sqlite = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const tables = (
      sqlite.prepare("select name from sqlite_master where type = 'table' order by name").all() as { name: string }[]
    ).map((row) => row.name);
    return {
      tables,
      jobs: sqlite.prepare("select * from jobs order by id").all(),
      runs: sqlite.prepare("select * from job_runs order by id").all(),
      meta: sqlite.prepare("select * from jobs_meta").all(),
    };
  } finally {
    sqlite.close();
  }
}

function tableNames(file: string): string[] {
  const sqlite = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return (
      sqlite.prepare("select name from sqlite_master where type = 'table' order by name").all() as { name: string }[]
    ).map((row) => row.name);
  } finally {
    sqlite.close();
  }
}
