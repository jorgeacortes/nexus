import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";

import { ensureDataDir, sqlitePath } from "@/infrastructure/db/data-dir";
import * as schema from "@/infrastructure/db/nexus/schema";

export type NexusDb = BetterSQLite3Database<typeof schema>;

/** How long a connection waits on a lock before giving up (build-time page-data workers open at once). */
const BUSY_TIMEOUT_MS = 5000;

/** Opens a SQLite file with the pragmas the app relies on. Exported for tests. */
export function openNexusSqlite(path: string): InstanceType<typeof Database> {
  const sqlite = new Database(path);
  sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  sqlite.pragma("foreign_keys = ON");
  try {
    sqlite.pragma("journal_mode = WAL");
  } catch {
    // Another connection holds the lock, or the switch is already in flight.
  }
  return sqlite;
}

export function createNexusDb(options: { path?: string; env?: NodeJS.Dict<string> } = {}): NexusDb {
  const path = options.path ?? sqlitePath("nexus.db", options.env ?? process.env);
  if (path !== ":memory:") {
    ensureDataDir(options.env ?? process.env);
  }
  return drizzle(openNexusSqlite(path), { schema });
}

/**
 * The process-wide client. Schema changes run via `pnpm db:migrate` before the
 * process starts; importing this module opens the file but never migrates it.
 */
export const db = createNexusDb();
