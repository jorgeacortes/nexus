import { and, eq, isNull } from "drizzle-orm";

import { type Dispatch, DispatchLeaseHeldError, type DispatchOutcome, isLeaseHeld } from "@/domain/dispatch/dispatch";
import type {
  AcquireLeaseInput,
  DispatchRepository,
  RecordPlacementInput,
  RecordSeenInput,
  RecordStartInput,
} from "@/domain/dispatch/dispatch.repository";
import { type Harness, isHarness } from "@/domain/tasks/task";
import type { NexusDb } from "@/infrastructure/db/nexus/db";
import { dispatches } from "@/infrastructure/db/nexus/schema";

type DispatchRow = typeof dispatches.$inferSelect;

function toDomain(row: DispatchRow): Dispatch {
  return {
    id: row.id,
    taskId: row.taskId,
    workspaceId: row.workspaceId,
    tabId: row.tabId,
    paneId: row.paneId,
    agentName: row.agentName,
    harness: toHarness(row.harness),
    leaseOwner: row.leaseOwner,
    leaseUntil: new Date(row.leaseUntil),
    startedAt: row.startedAt ? new Date(row.startedAt) : null,
    endedAt: row.endedAt ? new Date(row.endedAt) : null,
    outcome: toOutcome(row.outcome),
    lastSeenStatus: row.lastSeenStatus,
    lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt) : null,
    createdAt: new Date(row.createdAt),
  };
}

function toHarness(value: string | null): Harness | null {
  return isHarness(value) ? value : null;
}

function toOutcome(value: string | null): DispatchOutcome | null {
  return value === "failed" || value === "expired" || value === "closed" || value === "lost" ? value : null;
}

/** True when an insert lost the open-task race to another writer. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

export class DrizzleDispatchRepository implements DispatchRepository {
  constructor(private readonly db: NexusDb) {}

  async acquireLease(input: AcquireLeaseInput): Promise<Dispatch> {
    // Synchronous transaction: `better-sqlite3` is synchronous, so the read,
    // the stale takeover and the insert cannot interleave with another writer.
    try {
      const row = this.db.transaction((): DispatchRow => {
        const open = this.selectOpen(input.taskId);
        if (open) {
          const held = toDomain(open);
          if (isLeaseHeld(held, input.now)) {
            throw new DispatchLeaseHeldError(input.taskId, held);
          }
          // A crashed attempt that never started an agent: end it so the partial
          // unique index frees the task. This is a ledger write, never a teardown.
          this.db
            .update(dispatches)
            .set({ outcome: "expired", endedAt: input.now.toISOString() })
            .where(eq(dispatches.id, open.id))
            .run();
        }
        const row: DispatchRow = {
          id: crypto.randomUUID(),
          taskId: input.taskId,
          workspaceId: null,
          tabId: null,
          paneId: null,
          agentName: null,
          harness: null,
          leaseOwner: input.leaseOwner,
          leaseUntil: input.leaseUntil.toISOString(),
          startedAt: null,
          endedAt: null,
          outcome: null,
          lastSeenStatus: null,
          lastSeenAt: null,
          createdAt: input.now.toISOString(),
        };
        this.db.insert(dispatches).values(row).run();
        return row;
      });
      return toDomain(row);
    } catch (error) {
      // A writer that slipped past the check hits the partial unique index.
      if (isUniqueViolation(error)) {
        const held = this.selectOpen(input.taskId);
        if (held) throw new DispatchLeaseHeldError(input.taskId, toDomain(held));
      }
      throw error;
    }
  }

  async recordPlacement(id: string, input: RecordPlacementInput): Promise<Dispatch> {
    this.db
      .update(dispatches)
      .set({ workspaceId: input.workspaceId, tabId: input.tabId, paneId: input.paneId })
      .where(eq(dispatches.id, id))
      .run();
    return this.require(id);
  }

  async recordStart(id: string, input: RecordStartInput): Promise<Dispatch> {
    this.db
      .update(dispatches)
      .set({ agentName: input.agentName, harness: input.harness, startedAt: input.startedAt.toISOString() })
      .where(eq(dispatches.id, id))
      .run();
    return this.require(id);
  }

  async finish(id: string, outcome: DispatchOutcome, endedAt: Date): Promise<Dispatch> {
    this.db.update(dispatches).set({ outcome, endedAt: endedAt.toISOString() }).where(eq(dispatches.id, id)).run();
    return this.require(id);
  }

  async finishOpenForTask(taskId: string, endedAt: Date): Promise<Dispatch | null> {
    const open = this.selectOpen(taskId);
    if (!open) return null;
    return this.finish(open.id, "closed", endedAt);
  }

  async finishOpenForTab(tabId: string, endedAt: Date): Promise<Dispatch[]> {
    const open = this.db
      .select()
      .from(dispatches)
      .where(and(eq(dispatches.tabId, tabId), isNull(dispatches.endedAt)))
      .all();
    if (open.length === 0) return [];
    this.db
      .update(dispatches)
      .set({ outcome: "closed", endedAt: endedAt.toISOString() })
      .where(and(eq(dispatches.tabId, tabId), isNull(dispatches.endedAt)))
      .run();
    return Promise.all(open.map((row) => this.require(row.id)));
  }

  async recordSeen(id: string, input: RecordSeenInput): Promise<void> {
    this.db
      .update(dispatches)
      .set({ lastSeenStatus: input.status, lastSeenAt: input.seenAt.toISOString() })
      .where(eq(dispatches.id, id))
      .run();
  }

  async listOpen(): Promise<Dispatch[]> {
    return this.db
      .select()
      .from(dispatches)
      .where(isNull(dispatches.endedAt))
      .orderBy(dispatches.createdAt)
      .all()
      .map(toDomain);
  }

  async findById(id: string): Promise<Dispatch | null> {
    const row = this.db.select().from(dispatches).where(eq(dispatches.id, id)).get();
    return row ? toDomain(row) : null;
  }

  async findOpenByTaskId(taskId: string): Promise<Dispatch | null> {
    const row = this.selectOpen(taskId);
    return row ? toDomain(row) : null;
  }

  async findOpenByTabId(tabId: string): Promise<Dispatch[]> {
    return this.db
      .select()
      .from(dispatches)
      .where(and(eq(dispatches.tabId, tabId), isNull(dispatches.endedAt)))
      .orderBy(dispatches.createdAt)
      .all()
      .map(toDomain);
  }

  async findByTaskId(taskId: string): Promise<Dispatch[]> {
    return this.db
      .select()
      .from(dispatches)
      .where(eq(dispatches.taskId, taskId))
      .orderBy(dispatches.createdAt)
      .all()
      .map(toDomain);
  }

  private selectOpen(taskId: string): DispatchRow | undefined {
    return this.db
      .select()
      .from(dispatches)
      .where(and(eq(dispatches.taskId, taskId), isNull(dispatches.endedAt)))
      .get();
  }

  private async require(id: string): Promise<Dispatch> {
    const found = await this.findById(id);
    if (!found) throw new Error(`Dispatch ${id} not found`);
    return found;
  }
}
