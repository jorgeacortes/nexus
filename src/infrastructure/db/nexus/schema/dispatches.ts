import { sql } from "drizzle-orm";
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * The dispatcher's ledger: one row per dispatch attempt. A row is **open** until
 * `ended_at` is set, and an open row holds the task's dispatch lease — the
 * partial unique index below is what makes "one live dispatch per task" a
 * database fact rather than a check two racing callers could lose.
 *
 * `task_id` is a loose pointer (tasks are deleted independently); the dispatch
 * history deliberately outlives the row it names.
 */
export const dispatches = sqliteTable(
  "dispatches",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    workspaceId: text("workspace_id"),
    tabId: text("tab_id"),
    paneId: text("pane_id"),
    agentName: text("agent_name"),
    harness: text("harness"),
    leaseOwner: text("lease_owner").notNull(),
    leaseUntil: text("lease_until").notNull(),
    startedAt: text("started_at"),
    endedAt: text("ended_at"),
    outcome: text("outcome"),
    // The last live status `detectLostAgents` observed for this row's pane, so a
    // later run can name it when the pane is gone. Null until the first sighting.
    lastSeenStatus: text("last_seen_status"),
    lastSeenAt: text("last_seen_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("dispatches_task_idx").on(table.taskId),
    uniqueIndex("dispatches_open_task_idx").on(table.taskId).where(sql`${table.endedAt} is null`),
  ],
);
