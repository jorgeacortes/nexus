import Database from "better-sqlite3";
import {
  abortableSleep,
  executeJobsTick,
  type JobsTickIo,
  type JobsTickRunInput,
  randomJitterMs,
} from "@/application/jobs/jobs-tick";
import type { RunDueJobsReport } from "@/application/jobs/run-due-jobs.usecase";
import { sqlitePath } from "@/infrastructure/db/data-dir";

/**
 * One tick of stored jobs, or a loop of them.
 *
 * This process does not migrate. The nexus service owns DDL; a tick against a
 * database without the jobs tables fails instead of creating them. `JOBS_ENABLED`
 * defaults off, so a bare start does not dispatch.
 *
 * `--loop` sleeps to the next interval boundary plus jitter, then awaits one
 * tick, so a slow tick cannot overlap the next one.
 */

const controller = new AbortController();
process.on("SIGTERM", () => controller.abort());
process.on("SIGINT", () => controller.abort());

executeJobsTick({
  argv: process.argv.slice(2),
  env: process.env,
  io: scriptIo(process.env, controller.signal),
})
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error && error.message !== "" ? error.message : "jobs tick failed");
    process.exit(1);
  });

function scriptIo(env: NodeJS.Dict<string>, signal: AbortSignal): JobsTickIo {
  return {
    now: () => new Date(),
    jitterMs: () => randomJitterMs(),
    shouldStop: () => signal.aborted,
    sleep: (ms) => abortableSleep(ms, signal),
    readLastTickAt: () => readLastTickAt(sqlitePath("nexus.db", env)),
    runTick: (input) => runDueTick(input),
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
  };
}

/**
 * Read-only lookup of the singleton tick timestamp. Opening a WAL database still
 * creates `-shm`/`-wal` beside the file, so the caller has to be the same user
 * that owns `./data` (the compose service starts as that uid).
 */
function readLastTickAt(path: string): Date | null {
  const sqlite = new Database(path, { readonly: true, fileMustExist: true });
  try {
    sqlite.pragma("busy_timeout = 5000");
    const row = sqlite.prepare("select last_tick_at from jobs_meta where id = 1").get() as
      | { last_tick_at: string | null }
      | undefined;
    if (!row?.last_tick_at) return null;
    const parsed = new Date(row.last_tick_at);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } finally {
    sqlite.close();
  }
}

async function runDueTick(input: JobsTickRunInput): Promise<RunDueJobsReport> {
  const { db } = await import("@/infrastructure/db/nexus/db");
  const { DrizzleJobRepository } = await import("@/infrastructure/repositories/jobs/drizzle-job.repository");
  const { DrizzleProjectRepository } = await import(
    "@/infrastructure/repositories/projects/drizzle-project.repository"
  );
  const { runDueJobs } = await import("@/application/jobs/run-due-jobs.usecase");

  const jobs = new DrizzleJobRepository(db);
  const projects = new DrizzleProjectRepository(db);
  const herdr = input.dryRun ? null : lazyHerdr();
  return runDueJobs(
    {
      jobs,
      projects: {
        find: async (projectId) => {
          const project = await projects.findById(projectId);
          return project ? { name: project.name, folderPath: project.folderPath } : null;
        },
      },
      agentPrompt: herdr ?? {
        prompt: async () => {
          throw new Error("dry-run must not prompt a pane");
        },
      },
      liveAgents: herdr ?? {
        list: async () => {
          throw new Error("dry-run must not read live agents");
        },
      },
    },
    { now: input.now, limit: input.limit, dryRun: input.dryRun },
  );
}

/** Herdr is imported on the first live call, so a dry run and an empty tick never open the socket. */
function lazyHerdr(): { prompt: (paneId: string, text: string) => Promise<void>; list: () => Promise<LiveAgent[]> } {
  let pending: ReturnType<typeof loadHerdr> | null = null;
  const client = () => {
    pending ??= loadHerdr();
    return pending;
  };
  return {
    prompt: async (paneId, text) => (await client()).prompt(paneId, text),
    list: async () => (await client()).list(),
  };
}

type LiveAgent = {
  paneId: string;
  agentKind: string;
  status: string;
  cwd: string;
  model: string | null;
  effort: string | null;
};

async function loadHerdr(): Promise<{
  prompt: (paneId: string, text: string) => Promise<void>;
  list: () => Promise<LiveAgent[]>;
}> {
  const { HerdrClient } = await import("@/infrastructure/herdr/herdr-client");
  const herdr = new HerdrClient();
  return {
    prompt: (paneId, text) => herdr.prompt(paneId, text),
    list: async () =>
      (await herdr.snapshot()).agents.map((agent) => ({
        paneId: agent.paneId,
        agentKind: agent.agent,
        status: agent.agentStatus,
        cwd: agent.cwd,
        model: agent.model,
        effort: agent.effort,
      })),
  };
}
