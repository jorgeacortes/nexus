import { beforeEach, describe, expect, it } from "vitest";

import { DispatchLeaseHeldError } from "@/domain/dispatch/dispatch";
import type { NexusDb } from "@/infrastructure/db/nexus/db";
import { DrizzleDispatchRepository } from "@/infrastructure/repositories/dispatch/drizzle-dispatch.repository";
import { createTestDb } from "@/test-support/db";

const NOW = new Date("2026-10-05T18:00:00.000Z");
const TTL = new Date("2026-10-05T18:05:00.000Z");

describe("DrizzleDispatchRepository", () => {
  let db: NexusDb;
  let repo: DrizzleDispatchRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new DrizzleDispatchRepository(db);
  });

  const acquire = (taskId = "t1", owner = "host:1") =>
    repo.acquireLease({ taskId, leaseOwner: owner, now: NOW, leaseUntil: TTL });

  it("takes a lease and records placement and start", async () => {
    const lease = await acquire();
    expect(lease.outcome).toBeNull();
    expect(lease.endedAt).toBeNull();
    expect(lease.leaseOwner).toBe("host:1");

    const placed = await repo.recordPlacement(lease.id, { workspaceId: "wR", tabId: "wR:t1", paneId: "wR:p1" });
    expect(placed).toMatchObject({ workspaceId: "wR", tabId: "wR:t1", paneId: "wR:p1" });

    const started = await repo.recordStart(lease.id, {
      agentName: "smoke-46e044bf",
      harness: "pi",
      startedAt: NOW,
    });
    expect(started.agentName).toBe("smoke-46e044bf");
    expect(started.harness).toBe("pi");
    expect(started.startedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("refuses a second lease while one is held, and allows it after the row ends", async () => {
    const lease = await acquire();
    await expect(acquire("t1", "host:2")).rejects.toBeInstanceOf(DispatchLeaseHeldError);

    await repo.finish(lease.id, "failed", NOW);
    await expect(acquire("t1", "host:2")).resolves.toMatchObject({ outcome: null });
    expect(await repo.findOpenByTaskId("t1")).not.toBeNull();
  });

  it("refuses a second lease after the agent started, even past the lease TTL", async () => {
    const lease = await acquire();
    await repo.recordStart(lease.id, { agentName: "x", harness: "pi", startedAt: NOW });

    await expect(acquire("t1", "host:2")).rejects.toThrow(/live dispatch/);
  });

  it("supersedes a stale, unstarted attempt and expires it", async () => {
    const stale = await acquire("t1", "host:1");

    const replacement = await repo.acquireLease({
      taskId: "t1",
      leaseOwner: "host:2",
      now: new Date("2026-10-05T18:10:00.000Z"),
      leaseUntil: new Date("2026-10-05T18:15:00.000Z"),
    });

    expect(replacement.id).not.toBe(stale.id);
    const expired = await repo.findById(stale.id);
    expect(expired?.outcome).toBe("expired");
    expect(expired?.endedAt?.toISOString()).toBe("2026-10-05T18:10:00.000Z");
    expect(await repo.findOpenByTaskId("t1")).toMatchObject({ id: replacement.id });
  });

  it("keeps one open dispatch per task but many ended rows, as history", async () => {
    const first = await acquire();
    await repo.finish(first.id, "failed", NOW);
    const second = await acquire("t1", "host:2");
    await repo.finish(second.id, "closed", NOW);

    const history = await repo.findByTaskId("t1");
    expect(history.map((row) => row.outcome)).toEqual(["failed", "closed"]);
    expect(await repo.findOpenByTaskId("t1")).toBeNull();
  });
});
