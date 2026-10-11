/**
 * When a stored job is next due.
 *
 * A cron `schedule` is interpreted by croner in the job's IANA timezone (UTC
 * when the job names none), so the same wall-clock hour is a different UTC
 * instant on either side of a DST transition. A positive `intervalSeconds`
 * is added to `after` and ignores the timezone. The result is always strictly
 * after `after`. An unparseable expression throws.
 */

import { Cron } from "croner";

export type ScheduleInput = {
  schedule: string | null;
  intervalSeconds: number | null;
  timezone: string | null;
};

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleError";
  }
}

/**
 * The next instant this spec is due.
 *
 * A non-blank `schedule` wins over `intervalSeconds`: the expression is the
 * schedule, and a stray interval does not override it.
 */
export function nextRunAt(input: ScheduleInput, after: Date): Date {
  if (Number.isNaN(after.getTime())) {
    throw new ScheduleError("after is not a valid date.");
  }

  const expression = input.schedule?.trim() ?? "";
  if (expression.length > 0) {
    return nextCronRun(expression, input.timezone, after);
  }

  const interval = input.intervalSeconds;
  if (typeof interval === "number" && Number.isInteger(interval) && interval > 0) {
    return new Date(after.getTime() + interval * 1000);
  }

  throw new ScheduleError("A job needs a cron schedule or a positive whole-second interval.");
}

function nextCronRun(expression: string, timezone: string | null, after: Date): Date {
  const zone = timezone?.trim() || "UTC";
  try {
    const cron = new Cron(expression, { timezone: zone, paused: true });
    const next = cron.nextRun(after);
    if (next === null || next.getTime() <= after.getTime()) {
      throw new ScheduleError(`Schedule "${expression}" has no run after ${after.toISOString()}.`);
    }
    return next;
  } catch (error) {
    if (error instanceof ScheduleError) throw error;
    const detail = error instanceof Error ? error.message : "unreadable schedule";
    throw new ScheduleError(detail);
  }
}
