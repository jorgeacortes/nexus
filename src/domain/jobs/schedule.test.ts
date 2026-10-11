import { describe, expect, it } from "vitest";

import { nextRunAt, ScheduleError } from "@/domain/jobs/schedule";

describe("nextRunAt", () => {
  it("advances a cron expression to the next matching instant", () => {
    // Sunday 2026-10-11 07:00 UTC. Weekdays at 08:00 UTC → Monday 08:00.
    const after = new Date("2026-10-11T07:00:00.000Z");
    const next = nextRunAt({ schedule: "0 8 * * 1-5", intervalSeconds: null, timezone: "UTC" }, after);
    expect(next.toISOString()).toBe("2026-10-12T08:00:00.000Z");

    // An instant that already matches is not due again; the following slot is.
    const again = nextRunAt({ schedule: "0 8 * * 1-5", intervalSeconds: 60, timezone: "UTC" }, next);
    expect(again.toISOString()).toBe("2026-10-13T08:00:00.000Z");
  });

  it("adds a fixed interval and ignores the timezone", () => {
    const after = new Date("2026-10-11T12:00:00.000Z");
    const next = nextRunAt({ schedule: null, intervalSeconds: 90, timezone: "Europe/Madrid" }, after);
    expect(next.toISOString()).toBe("2026-10-11T12:01:30.000Z");
  });

  it("keeps the wall clock across a DST boundary", () => {
    // Europe/Madrid falls back on 2026-10-25: 03:00 CEST → 02:00 CET, so 02:30
    // happens twice. Croner runs the overlap once, at the first occurrence
    // (still CEST, UTC+2). The next day the same wall time is CET (UTC+1).
    const beforeOverlap = new Date("2026-10-25T00:00:00.000Z"); // 02:00 CEST
    const first = nextRunAt(
      { schedule: "30 2 * * *", intervalSeconds: null, timezone: "Europe/Madrid" },
      beforeOverlap,
    );
    expect(first.toISOString()).toBe("2026-10-25T00:30:00.000Z"); // 02:30 CEST

    const nextDay = nextRunAt({ schedule: "30 2 * * *", intervalSeconds: null, timezone: "Europe/Madrid" }, first);
    expect(nextDay.toISOString()).toBe("2026-10-26T01:30:00.000Z"); // 02:30 CET

    // The spring-forward gap on 2026-03-29 skips 02:00–03:00. 02:30 does not
    // exist; croner places that slot at 03:30 CEST. 03:00 itself is the first
    // valid instant after the jump (01:00 UTC).
    const beforeGap = new Date("2026-03-29T00:30:00.000Z"); // 01:30 CET
    const missing = nextRunAt({ schedule: "30 2 * * *", intervalSeconds: null, timezone: "Europe/Madrid" }, beforeGap);
    expect(missing.toISOString()).toBe("2026-03-29T01:30:00.000Z"); // 03:30 CEST

    const three = nextRunAt({ schedule: "0 3 * * *", intervalSeconds: null, timezone: "Europe/Madrid" }, beforeGap);
    expect(three.toISOString()).toBe("2026-03-29T01:00:00.000Z"); // 03:00 CEST
  });

  it("throws when the expression cannot be parsed", () => {
    const after = new Date("2026-10-11T12:00:00.000Z");
    expect(() => nextRunAt({ schedule: "not a cron", intervalSeconds: null, timezone: "UTC" }, after)).toThrow(
      ScheduleError,
    );
    expect(() => nextRunAt({ schedule: "not a cron", intervalSeconds: null, timezone: "UTC" }, after)).toThrow(
      /invalid configuration/,
    );
  });
});
