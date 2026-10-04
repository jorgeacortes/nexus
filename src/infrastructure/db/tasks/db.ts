import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";

import { ensureDataDir, sqlitePath } from "@/infrastructure/db/data-dir";
import * as schema from "@/infrastructure/db/tasks/schema";

export type TasksDb = BetterSQLite3Database<typeof schema>;

export function createTasksDb(options: { path?: string; env?: NodeJS.Dict<string> } = {}): TasksDb {
  const path = options.path ?? sqlitePath("nexus.db", options.env ?? process.env);
  if (path !== ":memory:") {
    ensureDataDir(options.env ?? process.env);
  }
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

export const db = createTasksDb();
