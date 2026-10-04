import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";

import { ensureTasksSchema } from "@/infrastructure/db/tasks/ensure-schema";
import * as schema from "@/infrastructure/db/tasks/schema";

describe("tasks schema", () => {
  it("creates the tasks table on a fresh in-memory database", async () => {
    const sqlite = new Database(":memory:");
    const db = drizzle(sqlite, { schema });
    await ensureTasksSchema(db);
    const rows = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'").all();
    expect(rows).toHaveLength(1);
  });
});
