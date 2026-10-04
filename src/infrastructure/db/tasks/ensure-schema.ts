import { sql } from "drizzle-orm";

import { db as sharedDb, type TasksDb } from "@/infrastructure/db/tasks/db";

/**
 * Ensures the tasks SQLite schema exists. Drizzle-kit migrations are the
 * source of truth; this bootstrap covers fresh databases in dev and tests.
 */
export async function ensureTasksSchema(db: TasksDb = sharedDb): Promise<void> {
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'backlog',
      agent_id TEXT,
      agent_name TEXT,
      project_id TEXT,
      needs_human INTEGER NOT NULL DEFAULT 0,
      blocked_reason TEXT,
      herdr_pane_id TEXT,
      herdr_tab_id TEXT,
      herdr_workspace_id TEXT,
      due_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await db.run(sql`CREATE INDEX IF NOT EXISTS tasks_status_updated_idx ON tasks (status, updated_at)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS tasks_agent_idx ON tasks (agent_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS tasks_needs_human_idx ON tasks (needs_human)`);
}
