import type { Job } from "@/domain/jobs/job";

/**
 * How a failed attempt is rescheduled.
 *
 * `retryCount` is the number of failures already recorded. A failure at
 * `retryCount >= maxRetries` dead-letters (the count stays put, so a dead job
 * shows the cap it hit). Otherwise the count advances and the next attempt
 * waits `2^retryCount` seconds: 2s, then 4s, then 8s.
 */
export type FailurePlan =
  | { outcome: "retry"; retryCount: number; nextRunAt: Date }
  | { outcome: "dead"; retryCount: number };

/** Cap the shift so a huge retry count cannot produce an invalid date. */
const MAX_BACKOFF_SHIFT = 16;

/** Lease length when a job sets no positive `timeoutSeconds`. */
export const DEFAULT_LEASE_SECONDS = 60;

/** How long one attempt may run: `timeoutSeconds` when it is positive, otherwise the default lease. */
export function runTimeoutMs(job: Pick<Job, "timeoutSeconds">): number {
  const seconds = job.timeoutSeconds !== null && job.timeoutSeconds > 0 ? job.timeoutSeconds : DEFAULT_LEASE_SECONDS;
  return seconds * 1000;
}

export function leaseDeadline(job: Pick<Job, "timeoutSeconds">, now: Date): Date {
  return new Date(now.getTime() + runTimeoutMs(job));
}

/** `2^n` seconds after `now`, where `n` is the retry count this failure records. */
export function retryBackoff(retryCount: number, now: Date): Date {
  const shift = Math.min(Math.max(Math.floor(retryCount), 0), MAX_BACKOFF_SHIFT);
  return new Date(now.getTime() + 2 ** shift * 1000);
}

export function planDispatchFailure(job: Pick<Job, "retryCount" | "maxRetries">, now: Date): FailurePlan {
  if (job.retryCount >= job.maxRetries) {
    return { outcome: "dead", retryCount: job.retryCount };
  }
  const retryCount = job.retryCount + 1;
  return { outcome: "retry", retryCount, nextRunAt: retryBackoff(retryCount, now) };
}
