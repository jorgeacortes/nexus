import type { RunDueJobsReport } from "@/application/jobs/run-due-jobs.usecase";

/**
 * Process policy for `scripts/jobs-tick.ts`. The script owns the database and
 * the Herdr socket; this module decides whether a tick runs, how long the loop
 * waits, and whether `jobs_meta.last_tick_at` is fresh. It never migrates.
 */

export const TICK_JITTER_MAX_MS = 5_000;

export const JOBS_TICK_USAGE = `usage: tsx scripts/jobs-tick.ts [--once | --loop | --healthcheck] [--dry-run]

--once          run a single tick and exit (the default)
--loop          sleep to the next interval boundary plus jitter, tick, repeat
--dry-run       report due jobs and write nothing
--healthcheck   exit 0 when jobs_meta.last_tick_at is fresh

A tick runs only when JOBS_ENABLED is 1, true, yes, or on. The default is off.
`;

export type JobsTickMode = "once" | "loop" | "healthcheck" | "help";

export type JobsTickArgs = { ok: true; mode: JobsTickMode; dryRun: boolean } | { ok: false; error: string };

export type JobsTickConfig = {
  enabled: boolean;
  concurrency: number;
  tickSeconds: number;
  dryRun: boolean;
};

export type JobsTickEnvResult = { ok: true; config: JobsTickConfig } | { ok: false; error: string };

export type JobsTickRunInput = {
  now: Date;
  limit: number;
  dryRun: boolean;
};

/** Clock and ports the process supplies. Tests pass fakes; the script passes the real ones. */
export type JobsTickIo = {
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  jitterMs: () => number;
  shouldStop: () => boolean;
  readLastTickAt: () => Date | null;
  runTick: (input: JobsTickRunInput) => Promise<RunDueJobsReport>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/** `setTimeout` fires immediately above this delay, so the loop slices longer waits. */
const MAX_TIMEOUT_MS = 2_147_483_647;

export function parseJobsTickArgs(argv: readonly string[]): JobsTickArgs {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { ok: true, mode: "help", dryRun: false };
  }

  let mode: Exclude<JobsTickMode, "help"> | null = null;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--once" || arg === "--loop" || arg === "--healthcheck") {
      const next = arg.slice(2) as Exclude<JobsTickMode, "help">;
      if (mode !== null && mode !== next) {
        return { ok: false, error: `jobs-tick: --${mode} and ${arg} cannot be combined.\n${JOBS_TICK_USAGE}` };
      }
      mode = next;
      continue;
    }
    return { ok: false, error: `jobs-tick: unknown argument ${arg}.\n${JOBS_TICK_USAGE}` };
  }

  if (mode === "healthcheck" && dryRun) {
    return { ok: false, error: `jobs-tick: --healthcheck does not take --dry-run.\n${JOBS_TICK_USAGE}` };
  }
  return { ok: true, mode: mode ?? "once", dryRun };
}

export function readJobsTickEnv(env: NodeJS.Dict<string>): JobsTickEnvResult {
  const concurrency = positiveInt(env.JOB_CONCURRENCY, 1, "JOB_CONCURRENCY");
  if (!concurrency.ok) return concurrency;
  const tickSeconds = positiveInt(env.JOB_TICK_SECONDS, 60, "JOB_TICK_SECONDS");
  if (!tickSeconds.ok) return tickSeconds;
  return {
    ok: true,
    config: {
      enabled: isTruthy(env.JOBS_ENABLED),
      concurrency: concurrency.value,
      tickSeconds: tickSeconds.value,
      dryRun: isTruthy(env.JOB_DRY_RUN),
    },
  };
}

/** A tick is fresh when it is less than two intervals old. A missing timestamp is stale. */
export function lastTickFreshForMs(tickSeconds: number): number {
  return tickSeconds * 2 * 1000;
}

export function isLastTickFresh(lastTickAt: Date | null, now: Date, tickSeconds: number): boolean {
  if (!lastTickAt || Number.isNaN(lastTickAt.getTime()) || Number.isNaN(now.getTime())) return false;
  const ageMs = now.getTime() - lastTickAt.getTime();
  if (ageMs < 0) return true;
  return ageMs < lastTickFreshForMs(tickSeconds);
}

/**
 * Milliseconds until the next interval boundary, plus jitter. An exact boundary
 * waits a full interval so a tick that finishes on the boundary does not run again.
 * `tickSeconds` of 60 is the Unix minute.
 */
export function msUntilNextTick(nowMs: number, tickSeconds: number, jitterMs: number): number {
  const intervalMs = tickSeconds * 1000;
  const remainder = nowMs % intervalMs;
  const untilBoundary = remainder === 0 ? intervalMs : intervalMs - remainder;
  return untilBoundary + Math.max(0, jitterMs);
}

export function randomJitterMs(random: () => number = Math.random): number {
  const unit = Math.min(1, Math.max(0, random()));
  return Math.min(TICK_JITTER_MAX_MS, Math.floor(unit * (TICK_JITTER_MAX_MS + 1)));
}

export function formatJobsTickReport(report: RunDueJobsReport): string {
  const head = report.dryRun ? "jobs tick: dry-run" : "jobs tick:";
  const runs = report.runs
    .map((run) => {
      const id = run.jobId.slice(0, 8);
      return run.error ? `${id}:${run.status} (${run.error})` : `${id}:${run.status}`;
    })
    .join(", ");
  const listed = runs === "" ? "" : ` [${runs}]`;
  const counts = `due=${report.due.length} reaped=${report.reaped.length} lost=${report.lost.length} runs=${report.runs.length}`;
  return `${head} ${counts}${listed} lastTickAt=${report.lastTickAt ?? "null"}`;
}

export async function runJobsTickLoop(options: {
  tickSeconds: number;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  jitterMs: () => number;
  shouldStop: () => boolean;
  tick: () => Promise<void>;
}): Promise<void> {
  while (!options.shouldStop()) {
    const wait = msUntilNextTick(options.now().getTime(), options.tickSeconds, options.jitterMs());
    await options.sleep(wait);
    if (options.shouldStop()) return;
    await options.tick();
  }
}

export async function executeJobsTick(input: {
  argv: readonly string[];
  env: NodeJS.Dict<string>;
  io: JobsTickIo;
}): Promise<number> {
  const args = parseJobsTickArgs(input.argv);
  if (!args.ok) {
    input.io.stderr(args.error);
    return 1;
  }
  if (args.mode === "help") {
    input.io.stdout(JOBS_TICK_USAGE.trimEnd());
    return 0;
  }

  const parsed = readJobsTickEnv(input.env);
  if (!parsed.ok) {
    input.io.stderr(parsed.error);
    return 1;
  }
  const config = parsed.config;
  const dryRun = args.dryRun || config.dryRun;

  if (args.mode === "healthcheck") {
    return healthcheck(input.io, config.tickSeconds);
  }

  if (!config.enabled) {
    if (args.mode === "once") {
      input.io.stdout("jobs tick: disabled (JOBS_ENABLED is off); nothing to do");
      return 0;
    }
    input.io.stdout("jobs tick: disabled (JOBS_ENABLED is off); looping without dispatching");
    await runJobsTickLoop({
      tickSeconds: config.tickSeconds,
      now: input.io.now,
      sleep: input.io.sleep,
      jitterMs: input.io.jitterMs,
      shouldStop: input.io.shouldStop,
      tick: async () => {},
    });
    return 0;
  }

  const tick = async () => {
    const report = await input.io.runTick({ now: input.io.now(), limit: config.concurrency, dryRun });
    input.io.stdout(formatJobsTickReport(report));
  };

  try {
    if (args.mode === "once") {
      await tick();
      return 0;
    }
    await runJobsTickLoop({
      tickSeconds: config.tickSeconds,
      now: input.io.now,
      sleep: input.io.sleep,
      jitterMs: input.io.jitterMs,
      shouldStop: input.io.shouldStop,
      tick,
    });
    return 0;
  } catch (error) {
    input.io.stderr(error instanceof Error && error.message !== "" ? error.message : "jobs tick failed");
    return 1;
  }
}

/** Sleep that wakes on abort. Longer than `setTimeout` allows is sliced so it cannot fire early. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return Promise.resolve();
  const slice = Math.min(ms, MAX_TIMEOUT_MS);
  return new Promise<void>((resolve) => {
    const timer = setTimeout(finish, slice);
    const onAbort = () => finish();
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }).then(() => {
    if (signal.aborted || ms <= slice) return Promise.resolve();
    return abortableSleep(ms - slice, signal);
  });
}

function healthcheck(io: JobsTickIo, tickSeconds: number): number {
  let lastTickAt: Date | null;
  try {
    lastTickAt = io.readLastTickAt();
  } catch (error) {
    const message = error instanceof Error && error.message !== "" ? error.message : "jobs meta unreadable";
    io.stderr(`jobs health: ${message}`);
    return 1;
  }
  if (isLastTickFresh(lastTickAt, io.now(), tickSeconds)) {
    io.stdout(`jobs health: fresh ${lastTickAt?.toISOString() ?? ""}`.trimEnd());
    return 0;
  }
  io.stdout(`jobs health: stale ${lastTickAt ? lastTickAt.toISOString() : "missing"}`);
  return 1;
}

function isTruthy(value: string | undefined): boolean {
  if (value === undefined) return false;
  return TRUTHY.has(value.trim().toLowerCase());
}

function positiveInt(
  value: string | undefined,
  fallback: number,
  name: string,
): { ok: true; value: number } | { ok: false; error: string } {
  if (value === undefined || value.trim() === "") return { ok: true, value: fallback };
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, error: `${name} must be a positive integer (got ${trimmed}).` };
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return { ok: false, error: `${name} must be a positive integer (got ${trimmed}).` };
  }
  return { ok: true, value: parsed };
}
